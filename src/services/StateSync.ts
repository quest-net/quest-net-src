// services/StateSync.ts

import { Campaign } from "../domains/Campaign/Campaign";
import { Room } from "../domains/Room/Room";
import { applyPatch, Operation } from "fast-json-patch";
import type { Patch } from "immer";
import {
	sanitizeCampaignForPlayers,
	sanitizeImmerPatchesForPlayers,
} from "./StateSyncSanitize";
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

	// State tracking for differential updates.
	// `hasBaseline` records whether players have received an initial full sync;
	// until they have, the first broadcast must be full. We no longer keep a
	// cloned baseline campaign for diffing -- Immer hands us the patches.
	private hasBaseline = false;
	private currentState: Campaign | null = null;
	private version = 0;
	private updateCount = 0;

	// DEV-only correctness oracle: the last sanitized campaign players should
	// hold. After building a delta we apply it to this baseline and assert the
	// result deep-equals a fresh full sanitize -- catching any leaked secret or
	// malformed (e.g. array-index) patch before it reaches a player. Never
	// populated in production builds.
	private devOracleBaseline: Campaign | null = null;

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
	 *
	 * @param campaign - the DM's PRIVATE campaign (unsanitized). Patches were
	 *   computed against it, so we sanitize using campaign.Id / campaign.RoomCode.
	 * @param patches - Immer patches describing exactly what this action changed.
	 * @param force - If true, ensures a broadcast is sent even with no changes
	 *   (sends a full sync to reset an optimistic player).
	 */
	broadcast(campaign: Campaign, patches: Patch[], force = false): void {
		this.updateCount++;

		// First broadcast (no baseline yet) or periodic fallback: send full state
		// to recover from any desync.
		const shouldSendFull =
			!this.hasBaseline || this.updateCount % this.fullStateInterval === 0;

		if (shouldSendFull) {
			this.sendFull(sanitizeCampaignForPlayers(campaign));
		} else {
			this.broadcastDelta(campaign, patches, force);
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

		// Players now hold a baseline; subsequent broadcasts can be deltas.
		this.hasBaseline = true;

		// Reset counters on full state.
		this.version = 0;
		this.updateCount = 0;

		if (import.meta.env.DEV) {
			// `sanitized` is a fresh StateSync-owned clone that nothing mutates
			// after this point, so adopt it as the oracle baseline directly.
			this.devOracleBaseline = sanitized;
		}
	}

	/**
	 * Broadcasts a differential update built from Immer patches.
	 *
	 * @param campaign - the DM's PRIVATE campaign (for sanitization context).
	 * @param immerPatches - the change set Immer recorded for this mutation.
	 */
	private broadcastDelta(
		campaign: Campaign,
		immerPatches: Patch[],
		force = false
	): void {
		if (immerPatches.length === 0) {
			if (force) {
				// Forced with no changes: full sync resets an optimistic player.
				this.sendFull(sanitizeCampaignForPlayers(campaign));
			}
			return;
		}

		// Sanitize + convert the Immer patches into player-safe JSON Patch ops.
		// No structuredClone of the campaign and no full-tree compare: this is
		// O(changed-paths) instead of O(campaign-size).
		const patches = sanitizeImmerPatchesForPlayers(
			immerPatches,
			campaign.Id,
			campaign.RoomCode
		);

		if (import.meta.env.DEV) {
			this.assertSanitizedPatchesMatch(campaign, patches);
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

	/**
	 * DEV-only oracle: apply the sanitized patches to the baseline players hold
	 * and assert the result deep-equals a fresh full sanitize of the next
	 * campaign. Catches leaked secrets and malformed/array-index patches before
	 * they reach a player. Also advances the baseline for the next check.
	 */
	private assertSanitizedPatchesMatch(
		campaign: Campaign,
		patches: Operation[]
	): void {
		const expected = sanitizeCampaignForPlayers(campaign);
		try {
			if (!this.devOracleBaseline) {
				this.devOracleBaseline = expected;
				return;
			}
			const applied = applyPatch(
				structuredClone(this.devOracleBaseline),
				patches,
				true,
				false
			).newDocument;
			if (JSON.stringify(applied) !== JSON.stringify(expected)) {
				console.error(
					"[StateSync] DEV oracle: sanitized patch result diverged from full sanitize.",
					{ patches }
				);
			}
		} catch (error) {
			console.error(
				"[StateSync] DEV oracle: failed to apply sanitized patches.",
				error,
				{ patches }
			);
		} finally {
			// Advance to the canonical expected state regardless of mismatch so a
			// single divergence doesn't cascade into every subsequent check.
			this.devOracleBaseline = expected;
		}
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
