// services/StateSync.ts

import { Campaign } from "../domains/Campaign/Campaign";
import { Room } from "../domains/Room/Room";
import { compare, applyPatch } from "fast-json-patch";
import type { Operation } from "fast-json-patch";
import { sanitizeCampaignForPlayers } from "./StateSyncSanitize";
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
	private sendState!: (
		data: any,
		targetPeers?: string | string[] | null,
		metadata?: any
	) => void;
	private onUpdateCallback?: (campaign: Campaign) => void;
	private actionExecute: (actionKey: string, params: any) => void;
	private sendQueue: Promise<void> = Promise.resolve();

	// State tracking for differential updates. The DM keeps the last sanitized
	// campaign sent to players, then compares it with the next sanitized campaign
	// to build JSON Patch deltas.
	private lastBroadcastState: Campaign | null = null;
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
		actionExecute: (actionKey: string, params: any) => void = () => { }
	) {
		this.room = room;
		this.actionExecute = actionExecute;
		this.setupChannel();
	}

	/**
	 * Sets up the Trystero channel for state updates
	 * Note: Trystero has 12-byte limit for action names
	 */
	private setupChannel() {
		const [send, receive] = this.room.makeAction("stateSync");

		this.sendState = send;

		// Listen for incoming state updates
		// Trystero's receive expects (data, peerId, metadata) but we only need data
		receive((data: any, _peerId: string, metadata: any) => {
			void this.handleIncomingStateTransport(data, metadata);
		});
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

		const sanitized = sanitizeCampaignForPlayers(campaign);

		// First broadcast (no baseline yet) or periodic fallback: send full state
		// to recover from any desync.
		const shouldSendFull =
			!this.lastBroadcastState ||
			this.updateCount % this.fullStateInterval === 0;

		if (shouldSendFull) {
			this.sendFull(sanitized);
		} else {
			this.broadcastDelta(sanitized, force);
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

		// `sanitized` is a fresh StateSync-owned clone that nothing mutates after
		// this point, so adopt it as the diff baseline directly.
		this.lastBroadcastState = sanitized;

		// Reset counters on full state.
		this.version = 0;
		this.updateCount = 0;
	}

	/**
	 * Broadcasts a differential update.
	 */
	private broadcastDelta(campaign: Campaign, force = false): void {
		if (!this.lastBroadcastState) {
			this.sendFull(campaign);
			return;
		}

		const patches = compare(this.lastBroadcastState, campaign);

		if (patches.length === 0) {
			if (force) {
				// Forced with no changes: full sync resets an optimistic player.
				this.sendFull(campaign);
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
		this.lastBroadcastState = campaign;
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
				this.sendState(transportUpdate.data, null, transportUpdate.metadata);
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

		// Apply patches to current state
		const result = applyPatch(this.currentState, update.patches, true, false);

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
