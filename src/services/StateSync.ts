// services/StateSync.ts

import { Campaign } from "../domains/Campaign/Campaign";
import { Room, type ActionSend } from "../domains/Room/Room";
import { applyPatch } from "fast-json-patch";
import type { Operation } from "fast-json-patch";
import { sanitizeCampaignForPlayers } from "./StateSyncSanitize";
import type { CampaignMutationRecorder } from "./CampaignMutationRecorder";
import {
	compressStateUpdateForTransport,
	decompressStateUpdateIfNeeded,
	STATE_UPDATE_DELTA_COMPRESSION_PATCH_THRESHOLD,
	STATE_UPDATE_DELTA_COMPRESSION_BYTE_THRESHOLD,
} from "../utils/StateUpdateCompression";

export interface StateUpdate {
	type: "full" | "delta";
	timestamp: number;
	data?: Campaign; // For 'full' updates
	patches?: Operation[]; // For 'delta' updates
	baseVersion?: number; // Version number for patch tracking
}

export class StateSync {
	private room: Room;
	private sendState!: ActionSend;
	private onUpdateCallback?: (campaign: Campaign) => void;
	private actionExecute: (actionKey: string, params: any) => void;
	private sendQueue: Promise<void> = Promise.resolve();

	// Operation-based deltas (DM only): the recorder buffers Valtio mutation ops
	// and translates them to JSON Patch at broadcast time, so we never diff two
	// full campaign clones. Undefined on players (who only receive).
	private recorder?: CampaignMutationRecorder;

	// State tracking. `hasBaseline` is true once players have received at least
	// one full state to apply deltas onto. `currentState` is the receiver-side
	// baseline (players only). Version counters gate delta ordering.
	private hasBaseline = false;
	private currentState: Campaign | null = null;
	private version = 0;
	private updateCount = 0;

	// Configuration
	// Periodic full-state fallback: send a full sync every N delta updates.
	// In practice this never fires at normal TTRPG action rates (~dozens of
	// actions per minute) — it would take hours to accumulate 10,000 deltas,
	// and the counter resets on every peer join and explicit /REQUEST_FULL_SYNC.
	// The version-mismatch detection path is the real desync recovery mechanism.
	// Kept high intentionally; do not lower without profiling wire cost.
	private fullStateInterval = 10000;

	constructor(
		room: Room,
		actionExecute: (actionKey: string, params: any) => void = () => { },
		recorder?: CampaignMutationRecorder
	) {
		this.room = room;
		this.actionExecute = actionExecute;
		this.recorder = recorder;
		this.setupChannel();
	}

	/**
	 * Sets up the Trystero channel for state updates.
	 * Note: Trystero allows up to 32 bytes for action names.
	 */
	private setupChannel() {
		const stateSync = this.room.makeAction<any>("stateSync");

		this.sendState = stateSync.send;

		// Listen for incoming state updates. We only need the data and the
		// transport metadata (compression flags) from the message context.
		stateSync.onMessage = (data, { metadata }) => {
			void this.handleIncomingStateTransport(data, metadata);
		};
	}

	private triggerFullSyncRequest(): void {
		this.actionExecute("log:create", {
			action: "/REQUEST_FULL_SYNC",
			category: "system",
			level: "verbose",
			visibility: ["dm"], // Ensure only the DM sees this command log
		});
	}

	/**
	 * Broadcasts the campaign state to all peers (DM only).
	 * @param force - If true, ensures a broadcast is sent even with no changes
	 *   (sends a full sync to reset an optimistic player).
	 */
	broadcast(campaign: Campaign, force = false): void {
		this.updateCount++;

		// First broadcast (no baseline yet) or periodic fallback: send full state
		// to recover from any desync. Only full sends sanitize the whole campaign;
		// deltas are built from recorded ops, not a sanitized clone.
		const shouldSendFull =
			!this.hasBaseline ||
			this.updateCount % this.fullStateInterval === 0;

		if (shouldSendFull) {
			this.sendFull(sanitizeCampaignForPlayers(campaign));
		} else {
			this.broadcastDelta(campaign, force);
		}
	}

	/**
	 * Broadcasts a full state update. Sanitizes the campaign before sending.
	 * Called externally by ActionService (new peer joins, force syncs).
	 */
	broadcastFull(campaign: Campaign): void {
		this.sendFull(sanitizeCampaignForPlayers(campaign));
	}

	/**
	 * Internal: queues a full-state send for an already-sanitized campaign.
	 * Keeps broadcast() and broadcastFull() from each sanitizing independently.
	 */
	private sendFull(sanitized: Campaign): void {
		const update: StateUpdate = {
			type: "full",
			timestamp: Date.now(),
			data: sanitized,
		};

		this.queueStateSend(update);

		// The full snapshot carries every buffered mutation, so drop the recorder
		// buffer -- replaying those ops as a delta on top would double-apply.
		this.recorder?.discard();

		// Players now have a baseline to apply deltas onto. Reset counters.
		this.hasBaseline = true;
		this.version = 0;
		this.updateCount = 0;
	}

	/**
	 * Broadcasts a differential update built from recorded mutation ops. Only
	 * reached with a baseline already established (broadcast() gates on that).
	 */
	private broadcastDelta(campaign: Campaign, force = false): void {
		// `null` means the ops can't be expressed as a delta (campaign root
		// replaced wholesale, or no recorder on this instance) -- full-send.
		const patches = this.recorder?.flush(campaign) ?? null;
		if (patches === null) {
			this.sendFull(sanitizeCampaignForPlayers(campaign));
			return;
		}

		if (patches.length === 0) {
			if (force) {
				// Forced with no changes: full sync resets an optimistic player.
				this.sendFull(sanitizeCampaignForPlayers(campaign));
			}
			return;
		}

		const update: StateUpdate = {
			type: "delta",
			timestamp: Date.now(),
			patches,
			baseVersion: this.version,
		};

		this.queueStateSend(update);
		this.version++;
	}

	private queueStateSend(update: StateUpdate): void {
		this.sendQueue = this.sendQueue
			.catch((error) => {
				console.error("[StateSync] State send queue error:", error);
			})
			.then(async () => {
				const transportUpdate = await compressStateUpdateForTransport(update, {
					compressFullUpdates: true,
					deltaPatchThreshold:
						STATE_UPDATE_DELTA_COMPRESSION_PATCH_THRESHOLD,
					deltaByteThreshold:
						STATE_UPDATE_DELTA_COMPRESSION_BYTE_THRESHOLD,
				});
				this.sendState(transportUpdate.data, {
					metadata: transportUpdate.metadata,
				});
			});
	}

	/**
	 * Registers a callback to be called when state updates are received
	 */
	onUpdate(callback: (campaign: Campaign) => void): void {
		this.onUpdateCallback = callback;
	}

	/**
	 * Handles incoming state updates from DM
	 */
	private async handleIncomingStateTransport(
		data: unknown,
		metadata?: unknown
	): Promise<void> {
		try {
			const update = await decompressStateUpdateIfNeeded<StateUpdate>(
				data as StateUpdate | ArrayBuffer,
				metadata
			);
			this.handleIncomingState(update);
		} catch (error) {
			console.error("[StateSync] Error reading state update:", error);
			// On error, we'll wait for the next full state broadcast
		}
	}

	private handleIncomingState(update: StateUpdate): void {
		try {
			switch (update.type) {
				case "full":
					this.handleFullUpdate(update);
					break;

				case "delta":
					this.handleDeltaUpdate(update);
					break;

				default:
					console.warn("Unknown update type:", (update as any).type);
			}
		} catch (error) {
			console.error("[StateSync] Error applying update:", error);
			// On error, we'll wait for the next full state broadcast
		}
	}

	/**
	 * Handles full state updates
	 */
	private handleFullUpdate(update: StateUpdate): void {
		if (!update.data) {
			console.warn("[StateSync] Full update missing data");
			return;
		}

		this.currentState = update.data;
		this.version = 0;
		if (this.onUpdateCallback) {
			this.onUpdateCallback(update.data);
		}
	}

	/**
	 * Handles differential updates
	 */
	private handleDeltaUpdate(update: StateUpdate): void {
		if (!update.patches || update.patches.length === 0) {
			console.warn("[StateSync] Delta update missing patches");
			return;
		}

		if (!this.currentState) {
			console.warn(
				"[StateSync] No current state to apply patches to, waiting for full state"
			);
			return;
		}

		if (update.baseVersion !== this.version) {
			console.warn(
				`[StateSync] Version mismatch. Expected ${this.version}, got ${update.baseVersion}.`
			);
			this.triggerFullSyncRequest();
			return;
		}

		// Apply patches to current state. mutateDocument=true lets fast-json-patch
		// mutate the private baseline in place (no internal deep clone): we own
		// `currentState` exclusively and applyPlayerStateUpdate structuredClones
		// the result before it reaches the proxy, so the baseline never aliases
		// the UI. Tradeoff: a mid-patch validation failure can leave the baseline
		// half-applied -- the version-mismatch -> full-sync path heals that.
		const result = applyPatch(this.currentState, update.patches, true, true);

		if (result.newDocument) {
			this.currentState = result.newDocument;
			this.version = (update.baseVersion ?? 0) + 1;

			if (this.onUpdateCallback) {
				this.onUpdateCallback(result.newDocument);
			}
		} else {
			console.error("[StateSync] Failed to apply patches");
		}
	}
}
