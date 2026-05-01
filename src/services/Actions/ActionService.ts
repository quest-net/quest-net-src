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
import { User } from "../../domains/User/User";
import { calculateMovementRange } from "../../components/Map/MapUtilities";
import type { Position } from "../../domains/Actor/Actor";

const PING_INTERVAL_MS = 3000;

export class ActionService {
	private context: Context;
	private room: Room;
	private stateSync: StateSync;
	public imageService: ImageService;

	private onFirstUpdateCallback?: () => void;

	// Trystero channel functions
	private sendActionRequest!: (data: any) => void;
	private sendUserUpdate!: (data: any, peerId?: string) => void;

	// Peer state — populated via the joinRoom handshake (initial sync) and
	// the `userUpdate` action (runtime updates). Owned here so all consumers
	// (hooks, components) read the same source of truth.
	public peerUsers: Map<string, User> = new Map();
	public peerPings: Map<string, number> = new Map();
	private pingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
	private lastBroadcastUserJson = "";

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
	 * Registers a callback that will be executed only once,
	 * upon receiving the first state update.
	 */
	onFirstUpdate(callback: () => void) {
		this.onFirstUpdateCallback = callback;
	}

	/**
	 * Records a peer's User payload (called from the room handshake).
	 * Starts the ping cadence for that peer and triggers a re-render.
	 */
	recordPeerUser(peerId: string, user: User) {
		this.peerUsers.set(peerId, user);
		this.startPinging(peerId);
		triggerContextUpdate();
	}

	/**
	 * Drops a peer's User payload and stops pinging them.
	 */
	private forgetPeerUser(peerId: string) {
		const had = this.peerUsers.delete(peerId);
		this.stopPinging(peerId);
		if (had) {
			triggerContextUpdate();
		}
	}

	/**
	 * Re-broadcasts the local User to peers if it has changed since the
	 * last broadcast. Safe to call from multiple components — only the
	 * actual changes are sent.
	 */
	broadcastSelf(): void {
		if (!this.sendUserUpdate) return;
		const json = JSON.stringify(this.context.User);
		if (json === this.lastBroadcastUserJson) return;
		this.lastBroadcastUserJson = json;
		this.sendUserUpdate(this.context.User);
	}

	private setupChannels() {
		// Channel for action requests: Player → DM
		// Note: Trystero 0.23+ allows up to 32 bytes per action name.
		const [sendReq, receiveReq] = this.room.makeAction("actionReq");
		this.sendActionRequest = sendReq;

		if (this.context.User.Role === "dm") {
			// DM listens for action requests from players
			receiveReq((data, peerId) => this.handlePlayerRequest(data, peerId));
		}

		// Runtime user updates (e.g., character selection mid-session).
		// Initial user exchange is handled by the joinRoom handshake.
		const [sendUserUpdate, getUserUpdate] = this.room.makeAction("userUpdate");
		this.sendUserUpdate = sendUserUpdate;
		getUserUpdate((data, peerId) => {
			if (data && typeof data === "object") {
				this.peerUsers.set(peerId, data as unknown as User);
				triggerContextUpdate();
			}
		});
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
		this.room.onPeerJoin(() => {
			if (this.context.User.Role === "dm") {
				const campaign = CampaignActions.getActiveCampaign(this.context);
				const isSecret = this.context.SecretModes?.[campaign.Id];
				if (!isSecret) {
					// Force full state for new peer
					this.stateSync.broadcastFull(campaign);
				}
			}
		});

		this.room.onPeerLeave((peerId) => {
			this.forgetPeerUser(peerId);
		});
	}

	private startPinging(peerId: string) {
		this.stopPinging(peerId);
		const tick = async () => {
			try {
				const ms = await this.room.ping(peerId);
				this.peerPings.set(peerId, ms);
				triggerContextUpdate();
			} catch {
				// Transient ping failures are expected on flaky links — ignore.
			}
		};
		tick();
		this.pingIntervals.set(peerId, setInterval(tick, PING_INTERVAL_MS));
	}

	private stopPinging(peerId: string) {
		const interval = this.pingIntervals.get(peerId);
		if (interval) {
			clearInterval(interval);
			this.pingIntervals.delete(peerId);
		}
		this.peerPings.delete(peerId);
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

		const isSecret = this.context.SecretModes?.[campaign.Id];
		if (!isSecret) {
			this.stateSync.broadcast(campaign);
		}

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
			this.context.IsOptimistic = true;
			this.runDomainAction(actionKey, params);
			const campaign = CampaignActions.getActiveCampaign(this.context);
			this.bumpMapRefs(campaign);
			triggerContextUpdate();
		} catch (error) {
			console.warn("[ActionService] Optimistic update failed (ignoring):", error);
			// Ignore error, let the server handle it
		} finally {
			this.context.IsOptimistic = false;
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
	private handlePlayerRequest(data: any, peerId?: string) {
		// While the DM is in secret mode, drop player requests on the floor.
		// Applying them would corrupt the prep state (e.g. a move request
		// scoped to the player's stale terrain). The full sync that fires when
		// secret mode is turned off reconciles the player's optimistic state.
		const activeCampaign = CampaignActions.getActiveCampaign(this.context);
		if (this.context.SecretModes?.[activeCampaign.Id]) {
			return;
		}

		const requestingUser = this.getRequestingPlayer(peerId, data?.playerId);
		if (!canPerformAction(requestingUser, data?.actionKey)) {
			console.warn(
				`Player ${requestingUser.Id} cannot perform action: ${data?.actionKey}`
			);
			return;
		}

		if (!this.canPlayerRequestAction(data?.actionKey, data?.params, requestingUser)) {
			return;
		}

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

	private getRequestingPlayer(peerId?: string, playerId?: string): User {
		const peerUser = peerId ? this.peerUsers.get(peerId) : undefined;
		return {
			Id: peerUser?.Id ?? playerId ?? "unknown-player",
			Name: peerUser?.Name ?? "Player",
			Role: "player",
			SelectedCharacters: peerUser?.SelectedCharacters ?? {},
		};
	}

	private canPlayerRequestAction(
		actionKey: string,
		params: any,
		requestingUser: User
	): boolean {
		if (actionKey !== "character:move") return true;

		const campaign = CampaignActions.getActiveCampaign(this.context);
		const restrictMovement =
			campaign.Settings.MovementSettings?.restrictPlayerMovementToRange ?? false;
		if (!restrictMovement) return true;

		const characterId = params?.characterId;
		const position = params?.position as Position | undefined;
		if (!characterId || !position) return false;

		if (requestingUser.SelectedCharacters?.[campaign.RoomCode] !== characterId) {
			return false;
		}

		const character = campaign.GameState.Characters.find(
			(c) => c.Id === characterId
		);
		if (!character) return false;

		if (
			!Number.isFinite(position.x) ||
			!Number.isFinite(position.y) ||
			!Number.isFinite(position.h)
		) {
			return false;
		}

		const targetX = Math.round(position.x);
		const targetY = Math.round(position.y);
		return this.isPlayerMoveInAllowedRange(characterId, targetX, targetY);
	}

	private isPlayerMoveInAllowedRange(
		characterId: string,
		targetX: number,
		targetY: number
	): boolean {
		const campaign = CampaignActions.getActiveCampaign(this.context);
		const terrain = campaign.Terrains.find(
			(t) => t.Id === campaign.GameState.TerrainId
		);
		if (!terrain) return false;

		if (
			targetX < 0 ||
			targetY < 0 ||
			targetX >= terrain.Width ||
			targetY >= terrain.Length
		) {
			return false;
		}

		const character = campaign.GameState.Characters.find(
			(c) => c.Id === characterId
		);
		if (!character) return false;

		const { heightCostLookup, flyingIgnoresHeight } =
			campaign.Settings.MovementSettings;
		const moveSpeed = character.MoveSpeed ?? 5;
		const canFly = character.CanFly ?? false;
		const current = character.Position;

		let budget = moveSpeed;
		if (campaign.GameState.CombatState?.isActive) {
			const turnStart = character.TurnStartPosition;
			if (!turnStart) return false;

			const { costs: startCosts } = calculateMovementRange(
				turnStart.x,
				turnStart.y,
				turnStart.h,
				moveSpeed,
				canFly,
				terrain.Width,
				terrain.Length,
				terrain.HeightMap,
				heightCostLookup,
				flyingIgnoresHeight
			);

			const spentCost = startCosts.get(`${current.x},${current.y}`);
			if (spentCost === undefined) return false;

			budget = moveSpeed - spentCost;
			if (budget <= 0) return false;
		}

		const { tiles } = calculateMovementRange(
			current.x,
			current.y,
			current.h,
			budget,
			canFly,
			terrain.Width,
			terrain.Length,
			terrain.HeightMap,
			heightCostLookup,
			flyingIgnoresHeight
		);

		return tiles.some((tile) => tile.x === targetX && tile.y === targetY);
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

	/**
	 * Forces a full sync broadcast to all players (used when turning off secret mode)
	 */
	public forceSync(): void {
		if (this.context.User.Role === "dm") {
			const campaign = CampaignActions.getActiveCampaign(this.context);
			this.bumpMapRefs(campaign);
			this.stateSync.broadcastFull(campaign);
		}
	}

	cleanup(): void {
		console.log("[ActionService] Cleaning up...");
		this.pingIntervals.forEach(clearInterval);
		this.pingIntervals.clear();
		this.peerPings.clear();
		this.peerUsers.clear();
		if (this.room) {
			RoomActions.leave(this.room);
		}
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
		// Also bump SharedInventories to ensure UI and StateSync catch mutations
		if (campaign.Settings.SharedInventories) {
			campaign.Settings.SharedInventories = [...campaign.Settings.SharedInventories];
		}
	}
}
