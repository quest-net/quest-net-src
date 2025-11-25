// services/Actions/ActionService.ts

import { Context } from "../../domains/Context/Context";
import { canPerformAction, ACTION_REGISTRY } from "./ActionRegistry";
import type { Campaign } from "../../domains/Campaign/Campaign";
import { CampaignActions } from "../../domains/Campaign/CampaignActions";
import { StateSync } from "../StateSync";
import { ImageService } from "../ImageService";
import { Room } from "../../domains/Room/Room";
import { triggerContextUpdate } from "../../domains/Context/ContextProvider";
import { RoomActions } from "../../domains/Room/RoomActions";
import { LogActions } from "../../domains/Log/LogActions";

export class ActionService {
	private context: Context;
	private room: Room;
	private stateSync: StateSync;
	public imageService: ImageService;
	private onPeerJoinCallback?: (peerId: string) => void;
	private onPeerLeaveCallback?: (peerId: string) => void;

	private onFirstUpdateCallback?: () => void;

	// Trystero channel functions
	private sendActionRequest!: (data: any) => void;

	constructor(context: Context, room: Room) {
		console.log("[ActionService] Initializing...");
		this.context = context;
		this.room = room;
		this.stateSync = new StateSync(room, this.execute.bind(this));
		this.imageService = new ImageService(
			room,
			context.User.Role === "dm",
			this.execute.bind(this)
		);
		this.setupChannels();
		this.setupStateSync();
		this.setupPeerHandlers();
	}

	/**
	 * Allows external code to register additional peer join handlers
	 */
	setOnPeerJoin(callback: (peerId: string) => void) {
		this.onPeerJoinCallback = callback;
	}
	setOnPeerLeave(callback: (peerId: string) => void) {
		this.onPeerLeaveCallback = callback;
	}
	/**
	 * Registers a callback that will be executed only once,
	 * upon receiving the first state update.
	 */
	onFirstUpdate(callback: () => void) {
		this.onFirstUpdateCallback = callback;
	}

	private setupChannels() {
		// Create channel for action requests: Player → DM
		// Note: Trystero has 12-byte limit for action names
		const [sendReq, receiveReq] = this.room.makeAction("actionReq");

		this.sendActionRequest = sendReq;

		// Set up listeners based on role
		if (this.context.User.Role === "dm") {
			// DM listens for action requests from players
			receiveReq(this.handlePlayerRequest.bind(this));
		}
	}

	private setupStateSync() {
		if (this.context.User.Role === "player") {
			// Players listen for state updates and apply them to context
			this.stateSync.onUpdate((campaign) => {

				// Find existing campaign by ID (which is the room code for players)
				const index = this.context.Campaigns.findIndex(
					(c) => c.Id === campaign.Id
				);

				// ISOLATION: We clone the campaign so that the UI can mutate it optimistically
				// without polluting the StateSync's internal baseline.
				const isolatedCampaign = structuredClone(campaign);

				if (index !== -1) {
					this.context.Campaigns[index] = isolatedCampaign;
				} else {
					this.context.Campaigns.push(isolatedCampaign);
				}
				// If a one-time callback is registered, execute and clear it.
				if (this.onFirstUpdateCallback) {
					this.onFirstUpdateCallback();
					this.onFirstUpdateCallback = undefined; // Ensure it only fires once
				}
				triggerContextUpdate();
			});
		}
	}

	private setupPeerHandlers() {
		this.room.onPeerJoin((peerId) => {
			if (this.context.User.Role === "dm") {
				const campaign = CampaignActions.getActiveCampaign(this.context);
				// Force full state for new peer
				this.stateSync.broadcastFull(campaign);
			}

			if (this.onPeerJoinCallback) {
				this.onPeerJoinCallback(peerId);
			}
		});

		this.room.onPeerLeave((peerId) => {
			if (this.onPeerLeaveCallback) {
				this.onPeerLeaveCallback(peerId);
			}
		});
	}

	/**
	 * Main entry point for executing actions
	 */
	execute(actionKey: string, params: any): void {
		// Permission check
		if (!canPerformAction(this.context.User, actionKey)) {
			console.warn(
				`User ${this.context.User.Id} cannot perform action: ${actionKey}`
			);
			return;
		}

		// Route based on role
		if (this.context.User.Role === "dm") {
			this.executeDM(actionKey, params);
		} else {
			this.executePlayer(actionKey, params);
		}
	}

	/**
	 * DM executes action directly and broadcasts result
	 */
	private executeDM(actionKey: string, params: any): void {

		// Execute the domain action (modifies Context/Campaign)
		this.runDomainAction(actionKey, params);

		// Broadcast updated campaign to all players
		const campaign = CampaignActions.getActiveCampaign(this.context);

		this.bumpMapRefs(campaign);

		this.stateSync.broadcast(campaign);

		triggerContextUpdate();
	}

	/**
	 * Player sends action request to DM
	 */
	private executePlayer(actionKey: string, params: any): void {

		// Check for connection before allowing any action
		if (!RoomActions.hasConnectedPeers(this.room)) {
			console.warn("[ActionService] No peers connected. Action blocked.");
			return;
		}

		// OPTIMISTIC UPDATE: Run locally first
		try {
			this.runDomainAction(actionKey, params);
			const campaign = CampaignActions.getActiveCampaign(this.context);
			this.bumpMapRefs(campaign);
			triggerContextUpdate();
		} catch (error) {
			console.warn("[ActionService] Optimistic update failed (ignoring):", error);
			// Ignore error, let the server handle it
		}

		// Send request to DM (fire and forget)
		this.sendActionRequest({
			actionKey,
			params,
			playerId: this.context.User.Id,
		});
	}

	/**
	 * DM receives and processes player action requests
	 */
	private handlePlayerRequest(data: any) {

		try {
			// Execute the domain action
			this.runDomainAction(data.actionKey, data.params);
		} catch (error) {
			console.error("[ActionService] Error executing player request:", error);
			// We continue to broadcast below to force a reset if needed
		}

		// Broadcast updated campaign to all players
		const campaign = CampaignActions.getActiveCampaign(this.context);

		this.bumpMapRefs(campaign);

		if (LogActions.isCommand(data.params, "/REQUEST_FULL_SYNC")) {
			this.stateSync.broadcastFull(campaign);
		} else {
			// FORCE SYNC: Always broadcast, even if no changes (reverts optimistic state)
			this.stateSync.broadcast(campaign, true);
		}
		triggerContextUpdate();
	}

	/**
	 * Executes a domain action by looking up its handler in the registry
	 */
	private runDomainAction(actionKey: string, params: any): void {
		const action = ACTION_REGISTRY[actionKey];

		if (!action) {
			console.warn(`[ActionService] No action found: ${actionKey}`);
			return;
		}

		try {
			action.handler(params, this.context);
		} catch (error) {
			console.error(`[ActionService] Error executing ${actionKey}:`, error);
			throw error;
		}
	}

	cleanup(): void {
		console.log("[ActionService] Cleaning up...");
		if (this.room) {
			RoomActions.leave(this.room);
		}
		// Unset any callbacks to prevent memory leaks
		this.onPeerJoinCallback = undefined;
		this.onPeerLeaveCallback = undefined;
	}

	/** 
   * Make new references for collections the Map memoizes against.
   * This avoids stale useMemo caches when domain code mutates in place.
   */
	private bumpMapRefs(campaign: Campaign): void {
		campaign.GameState = {
			...campaign.GameState,
			Characters: [...campaign.GameState.Characters],
			Entities: [...campaign.GameState.Entities],
		};
	}
}
