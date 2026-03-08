// services/StateSync.ts

import { Campaign } from "../domains/Campaign/Campaign";
import { Room } from "../domains/Room/Room";
import { compare, applyPatch, Operation } from "fast-json-patch";

export interface StateUpdate {
	type: "full" | "delta";
	timestamp: number;
	data?: Campaign; // For 'full' updates
	patches?: Operation[]; // For 'delta' updates
	baseVersion?: number; // Version number for patch tracking
}

export class StateSync {
	private room: Room;
	private sendState!: (data: any, targetPeers?: string | string[] | null) => void;
	private onUpdateCallback?: (campaign: Campaign) => void;
	private actionExecute: (actionKey: string, params: any) => void;

	// State tracking for differential updates
	private lastBroadcastState: Campaign | null = null;
	private currentState: Campaign | null = null;
	private version = 0;
	private updateCount = 0;

	// Configuration
	private fullStateInterval = 10000; // Send full state every N updates as fallback

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
		receive((data: any) => {
			this.handleIncomingState(data as StateUpdate);
		});
	}

	/**
	 * Sanitizes campaign for player consumption
	 * Replaces the DM's secret Campaign ID with the public RoomCode
	 */
	private sanitizeForPlayers(campaign: Campaign): Campaign {
		const sanitized = structuredClone(campaign);
		// Replace secret Campaign ID with room code so players can identify it
		sanitized.Id = campaign.RoomCode;
		return sanitized;
	}

	private triggerFullSyncRequest(): void {
		console.log(
			"[StateSync] Requesting full state sync from DM via log command."
		);
		this.actionExecute("log:create", {
			action: "/REQUEST_FULL_SYNC",
			category: "system",
			level: "verbose",
			visibility: ["dm"], // Ensure only the DM sees this command log
		});
	}

	/**
	 * Broadcasts the campaign state to all peers (DM only)
	 * @param force - If true, ensures a broadcast is sent even if no changes occurred (sends Full Sync)
	 */
	broadcast(campaign: Campaign, force = false): void {
		this.updateCount++;

		// Sanitize campaign before broadcasting to hide DM's secret ID
		const sanitizedCampaign = this.sanitizeForPlayers(campaign);

		// Periodically send full state to recover from any desync
		const shouldSendFull =
			!this.lastBroadcastState ||
			this.updateCount % this.fullStateInterval === 0;

		if (shouldSendFull) {
			console.log("[StateSync] Sending periodic/initial Full Sync");
			this.broadcastFull(sanitizedCampaign);
		} else {
			this.broadcastDelta(sanitizedCampaign, force);
		}

		// Store sanitized version for next comparison
		this.lastBroadcastState = structuredClone(sanitizedCampaign);
	}

	/**
	 * Broadcasts a full state update
	 */
	broadcastFull(campaign: Campaign): void {
		const sanitized = this.sanitizeForPlayers(campaign);

		const update: StateUpdate = {
			type: "full",
			timestamp: Date.now(),
			data: sanitized,
		};


		this.sendState(update);

		// Store sanitized version for next comparison
		this.lastBroadcastState = structuredClone(sanitized);

		// Reset version counter on full state
		this.version = 0;
		this.updateCount = 0;
	}

	/**
	 * Broadcasts a differential update
	 */
	private broadcastDelta(campaign: Campaign, force = false): void {
		if (!this.lastBroadcastState) {
			// Fallback to full state if we don't have a previous state
			this.broadcastFull(campaign);
			return;
		}

		// Generate patches
		const patches = compare(this.lastBroadcastState, campaign);

		if (patches.length === 0) {
			if (force) {
				console.log("[StateSync] Force broadcast with no changes -> Sending Full Sync");
				// If forced and no changes, send full state to ensure sync
				this.broadcastFull(campaign);
			}
			return;
		}

		console.log(`[StateSync] Broadcasting Delta. Version: ${this.version} -> ${this.version + 1}. Patches: ${patches.length}`);

		const update: StateUpdate = {
			type: "delta",
			timestamp: Date.now(),
			patches,
			baseVersion: this.version,
		};

		this.sendState(update);

		this.version++;
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
	private handleIncomingState(update: StateUpdate): void {
		try {
			switch (update.type) {
				case "full":
					console.log("[StateSync] Received Full Update");
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
			console.log(`[StateSync] Applied Delta. New Version: ${this.version}`);

			if (this.onUpdateCallback) {
				this.onUpdateCallback(result.newDocument);
			}
		} else {
			console.error("[StateSync] Failed to apply patches");
		}
	}
}
