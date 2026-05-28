// services/Actions/ActionService.ts

import { createDraft, finishDraft, setAutoFreeze } from "immer";
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
import { CampaignLoadingService } from "../CampaignLoadingService";
import { TerrainStorageService } from "../TerrainStorageService";
import { ActorPoseService } from "../ActorPoseService";

// Immer freezes producer output by default, which would break code paths
// outside the action pipeline that still mutate the campaign in place
// (e.g. migrations on load, structuredClone-then-edit in applyPlayerStateUpdate).
// Disable freezing globally so Immer is purely a structural-sharing tool here:
// new references only appear on paths that were actually mutated.
setAutoFreeze(false);

const PING_INTERVAL_MS = 3000;
const PEER_RECONCILE_INTERVAL_MS = 2000;

export class ActionService {
	private context: Context;
	private room: Room;
	private stateSync: StateSync;
	public imageService: ImageService;
	public actorPoseService: ActorPoseService;

	private onFirstUpdateCallback?: () => void;

	// Trystero channel functions
	private sendActionRequest!: (data: any) => void;
	private sendUserUpdate!: (data: any, peerId?: string) => void;
	private sendUserRequest!: (data: any, peerId?: string) => void;

	// Peer state is split into transport presence and app-level metadata.
	// `connectedPeerIds` mirrors Trystero's active peer map. `peerUsers` is
	// optional display metadata populated by handshake/userUpdate traffic.
	public connectedPeerIds: Set<string> = new Set();
	public peerUsers: Map<string, User> = new Map();
	public peerPings: Map<string, number> = new Map();
	private pingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
	private peerReconcileInterval?: ReturnType<typeof setInterval>;
	private lastBroadcastUserJson = "";

	constructor(context: Context, room: Room) {
		this.context = context;
		this.room = room;
		this.stateSync = new StateSync(room, this.execute.bind(this));
		this.imageService = new ImageService(
			room,
			context.User.Role === "dm",
			this.execute.bind(this)
		);
		this.actorPoseService = new ActorPoseService(context, room, {
			getPeerUser: (peerId) => this.peerUsers.get(peerId),
		});
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
	 * Handshake runs before Trystero marks the peer active, so transport
	 * presence is reconciled separately through onPeerJoin/getPeers().
	 */
	recordPeerUser(peerId: string, user: User) {
		const didChangeUser = this.setPeerUser(peerId, user);
		const didChangeConnection = this.isPeerActive(peerId)
			? this.addConnectedPeer(peerId)
			: false;

		if (didChangeUser || didChangeConnection) {
			triggerContextUpdate();
		}
	}

	/**
	 * Drops all local state for a peer that is no longer transport-active.
	 */
	private forgetPeer(peerId: string) {
		const hadConnection = this.connectedPeerIds.delete(peerId);
		const hadUser = this.peerUsers.delete(peerId);
		this.stopPinging(peerId);
		this.actorPoseService.clearForPeer(peerId);
		if (hadConnection || hadUser) {
			triggerContextUpdate();
		}
	}

	/**
	 * Re-broadcasts the local User to peers if it has changed since the
	 * last broadcast. Safe to call from multiple components — only the
	 * actual changes are sent.
	 */
	broadcastSelf(peerId?: string): void {
		if (!this.sendUserUpdate) return;
		const json = JSON.stringify(this.context.User);
		if (peerId) {
			this.sendUserUpdate(this.context.User, peerId);
			return;
		}
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
				const didChangeUser = this.setPeerUser(peerId, data as unknown as User);
				const didChangeConnection = this.isPeerActive(peerId)
					? this.addConnectedPeer(peerId)
					: false;

				if (didChangeUser || didChangeConnection) {
					triggerContextUpdate();
				}
			}
		});

		const [sendUserRequest, getUserRequest] = this.room.makeAction("userReq");
		this.sendUserRequest = sendUserRequest;
		getUserRequest((_data, peerId) => {
			this.broadcastSelf(peerId);
		});
	}

	private setupStateSync() {
		if (this.context.User.Role === "player") {
			// Players listen for state updates and apply them to context.
			// State arrives sanitized by the DM, so campaign.Id has been
			// replaced with the public RoomCode — that's the key we use to
			// match against the player's CampaignInfo entries.
			this.stateSync.onUpdate((campaign) => {
				void this.applyPlayerStateUpdate(campaign).catch((error) => {
					console.error("[ActionService] Error applying player state:", error);
				});
			});
		}
	}

	private async applyPlayerStateUpdate(campaign: Campaign): Promise<void> {
		// ISOLATION: clone so the UI can mutate optimistically without
		// polluting StateSync's internal baseline.
		const isolatedCampaign = structuredClone(campaign);
		await TerrainStorageService.prepareCampaignAfterLoad(isolatedCampaign);
		const refreshedInfo =
			CampaignLoadingService.buildPlayerInfo(isolatedCampaign);

		// Keep the captured context in lockstep with React state. The mutator
		// below lands the new ActiveCampaign on the live React state, but
		// action handlers invoked via runDomainAction read from this.context.
		// Without this direct assignment, a player who joins a campaign for
		// the first time while another campaign was previously active ends up
		// with a stale this.context.ActiveCampaign === null, and every
		// subsequent action throws "No active campaign for identifier: ...".
		// (Inner-reference fields like Campaigns[] propagate automatically
		// through the shallow spread, so only top-level reassignments need
		// this extra step.)
		this.context.ActiveCampaign = isolatedCampaign;

		// Use the mutator form of triggerContextUpdate so that reassigning the
		// top-level ActiveCampaign field lands on the live React state rather
		// than the stale context object we captured at construction.
		const applyUpdate = () => {
			if (this.onFirstUpdateCallback) {
				this.onFirstUpdateCallback();
				this.onFirstUpdateCallback = undefined;
			}
		};

		triggerContextUpdate((ctx) => {
			ctx.ActiveCampaign = isolatedCampaign;

			const idx = ctx.Campaigns.findIndex(
				(c) => c.Id === refreshedInfo.Id
			);
			if (idx !== -1) {
				ctx.Campaigns[idx] = refreshedInfo;
			} else {
				ctx.Campaigns.push(refreshedInfo);
			}
		});

		this.actorPoseService.clearLiveActorPoses();

		// Resolve the first-update promise after the React update has been
		// queued so CampaignView's setState({ status: "ready" }) batches with
		// our setContext.
		applyUpdate();
	}

	private setupPeerHandlers() {
		this.room.onPeerJoin((peerId) => {
			const didChangeConnection = this.addConnectedPeer(peerId);

			if (this.context.User.Role === "dm") {
				const campaign = CampaignActions.getActiveCampaign(this.context);
				const isSecret = this.context.SecretModes?.[campaign.Id];
				if (!isSecret) {
					// Force full state for new peer
					void TerrainStorageService.packInactiveTerrains(campaign).then(() => {
						this.stateSync.broadcastFull(campaign);
					});
				}
			}

			if (didChangeConnection) {
				triggerContextUpdate();
			}
		});

		this.room.onPeerLeave((peerId) => {
			this.forgetPeer(peerId);
		});

		this.peerReconcileInterval = setInterval(
			() => this.reconcilePeerConnections(),
			PEER_RECONCILE_INTERVAL_MS
		);
		this.reconcilePeerConnections();
	}

	private setPeerUser(peerId: string, user: User): boolean {
		const previous = this.peerUsers.get(peerId);
		this.peerUsers.set(peerId, user);
		return JSON.stringify(previous) !== JSON.stringify(user);
	}

	private isPeerActive(peerId: string): boolean {
		return Object.prototype.hasOwnProperty.call(this.room.getPeers(), peerId);
	}

	private addConnectedPeer(peerId: string): boolean {
		const wasConnected = this.connectedPeerIds.has(peerId);
		this.connectedPeerIds.add(peerId);

		if (!this.pingIntervals.has(peerId)) {
			this.startPinging(peerId);
		}

		if (!wasConnected) {
			this.broadcastSelf(peerId);
		}
		if (!this.peerUsers.has(peerId)) {
			this.requestPeerUser(peerId);
		}

		return !wasConnected;
	}

	private requestPeerUser(peerId: string) {
		if (!this.sendUserRequest) return;
		this.sendUserRequest({ userId: this.context.User.Id }, peerId);
	}

	private reconcilePeerConnections() {
		const activePeerIds = new Set(Object.keys(this.room.getPeers()));
		let didChange = false;

		for (const peerId of activePeerIds) {
			// addConnectedPeer already calls requestPeerUser when peerUsers is
			// missing — no need to repeat the check here.
			didChange = this.addConnectedPeer(peerId) || didChange;
		}

		for (const peerId of Array.from(this.connectedPeerIds)) {
			if (!activePeerIds.has(peerId)) {
				this.connectedPeerIds.delete(peerId);
				this.peerUsers.delete(peerId);
				this.stopPinging(peerId);
				this.actorPoseService.clearForPeer(peerId);
				didChange = true;
			}
		}

		if (didChange) {
			triggerContextUpdate();
		}
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
		void this.executeAndWait(actionKey, params).catch((error) => {
			console.error(`[ActionService] Error executing ${actionKey}:`, error);
		});
	}

	executeAndWait(actionKey: string, params: any): Promise<void> {
		return this.executeAsync(actionKey, params);
	}

	private async executeAsync(actionKey: string, params: any): Promise<void> {
		// Permission check
		if (!canPerformAction(this.context.User, actionKey)) {
			console.warn(
				`User ${this.context.User.Id} cannot perform action: ${actionKey}`
			);
			return;
		}

		// Route based on role
		if (this.context.User.Role === "dm") {
			await this.executeDM(actionKey, params);
		} else {
			await this.executePlayer(actionKey, params);
		}
	}

	/**
	 * Runs a producer against an Immer draft of the active campaign and
	 * commits the result back into context. Handlers that read
	 * context.ActiveCampaign during the producer see the draft, so existing
	 * in-place mutations (e.g. `actor.Position = {...}`) are captured by
	 * Immer and translated into a structurally shared new campaign:
	 * unmutated paths keep their references, mutated ones get new ones.
	 *
	 * This replaces the old bumpMapRefs hack, which created new Characters /
	 * Entities / SharedInventories arrays on every action regardless of what
	 * actually changed. The Immer path produces new arrays ONLY where the
	 * handler touched them, so memo deps invalidate more precisely.
	 *
	 * On error the previous campaign is restored so a partial draft doesn't
	 * leak into context.
	 */
	private async mutateCampaign(
		producer: (draft: Campaign) => Promise<void> | void
	): Promise<Campaign> {
		const previous = CampaignActions.getActiveCampaign(this.context);
		const draft = createDraft(previous) as Campaign;
		this.context.ActiveCampaign = draft;
		try {
			await producer(draft);
			const next = finishDraft(draft) as Campaign;
			this.commitActiveCampaign(next);
			return next;
		} catch (error) {
			this.commitActiveCampaign(previous);
			throw error;
		}
	}

	/**
	 * Writes a new ActiveCampaign reference to BOTH this.context (the object
	 * ActionService captured at construction) AND the live React state. They
	 * are different objects after the first triggerContextUpdate -- the
	 * ContextProvider's `{...current}` spread creates a fresh top-level
	 * Context, so this.context becomes a captured-but-stale wrapper around
	 * the same inner fields.
	 *
	 * When the campaign reference was preserved across actions (the
	 * pre-Immer in-place-mutation regime), this divergence didn't matter:
	 * both Context objects' ActiveCampaign field pointed at the same
	 * physical campaign. With Immer, each action produces a NEW campaign
	 * object, so the two Contexts must be reconciled explicitly or React
	 * state stays one revision behind and the UI silently ignores the
	 * latest action.
	 *
	 * This is the same pattern used by applyPlayerStateUpdate.
	 */
	private commitActiveCampaign(campaign: Campaign): void {
		this.context.ActiveCampaign = campaign;
		triggerContextUpdate((ctx) => {
			ctx.ActiveCampaign = campaign;
		});
	}

	/**
	 * DM executes action directly and broadcasts result
	 */
	private async executeDM(actionKey: string, params: any): Promise<void> {
		const campaign = await this.mutateCampaign(async (draft) => {
			// Execute the domain action against the draft (handlers reach
			// the draft via context.ActiveCampaign, swapped in by mutateCampaign).
			await this.runDomainAction(actionKey, params);
			// Pack inactive terrains inside the producer so its mutations
			// also flow through Immer's structural sharing.
			await TerrainStorageService.packInactiveTerrains(draft);
		});

		const isSecret = this.context.SecretModes?.[campaign.Id];
		if (!isSecret) {
			this.stateSync.broadcast(campaign);
		}

		this.actorPoseService.clearForAuthoritativeAction(actionKey, params);
	}

	/**
	 * Player sends action request to DM
	 */
	private async executePlayer(actionKey: string, params: any): Promise<void> {

		// Check for connection before allowing any action
		if (!RoomActions.hasConnectedPeers(this.room)) {
			console.warn("[ActionService] No peers connected. Action blocked.");
			return;
		}

		// OPTIMISTIC UPDATE: Run locally first
		try {
			this.context.IsOptimistic = true;
			await this.mutateCampaign(async (draft) => {
				await this.runDomainAction(actionKey, params);
				await TerrainStorageService.packInactiveTerrains(draft);
			});
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
		void this.handlePlayerRequestAsync(data, peerId);
	}

	private async handlePlayerRequestAsync(data: any, peerId?: string): Promise<void> {
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

		try {
			// Execute the domain action as the requesting player so
			// domain-level player validations run in the same context as
			// optimistic local execution.
			await this.mutateCampaign(async (draft) => {
				const originalUser = this.context.User;
				try {
					this.context.User = requestingUser;
					await this.runDomainAction(data.actionKey, data.params);
				} finally {
					this.context.User = originalUser;
				}
				await TerrainStorageService.packInactiveTerrains(draft);
			});
		} catch (error) {
			console.error("[ActionService] Error executing player request:", error);
			// We continue to broadcast below to force a reset if needed
		}

		// Broadcast updated campaign to all players. Re-read because the
		// mutateCampaign above may have thrown, in which case we want to
		// broadcast the pre-mutation state to reset the player's optimistic
		// update.
		const campaign = CampaignActions.getActiveCampaign(this.context);

		if (LogActions.isCommand(data.params, "/REQUEST_FULL_SYNC")) {
			this.stateSync.broadcastFull(campaign);
		} else {
			// FORCE SYNC: Always broadcast, even if no changes (reverts optimistic state)
			this.stateSync.broadcast(campaign, true);
		}
		this.actorPoseService.clearForAuthoritativeAction(
			data?.actionKey,
			data?.params
		);
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

	/**
	 * Executes a domain action by looking up its handler in the registry
	 */
	private async runDomainAction(actionKey: string, params: any): Promise<void> {
		const action = ACTION_REGISTRY[actionKey];

		if (!action) {
			console.warn(`[ActionService] No action found: ${actionKey}`);
			return;
		}

		try {
			await action.handler(params, this.context);
		} catch (error) {
			console.error(`[ActionService] Error executing ${actionKey}:`, error);
			throw error;
		}
	}

	/**
	 * Forces a full sync broadcast to all players (used when turning off secret mode)
	 */
	public forceSync(): void {
		void this.forceSyncAsync();
	}

	private async forceSyncAsync(): Promise<void> {
		if (this.context.User.Role === "dm") {
			const campaign = await this.mutateCampaign(async (draft) => {
				await TerrainStorageService.packInactiveTerrains(draft);
			});
			this.stateSync.broadcastFull(campaign);
		}
	}

	cleanup(): void {
		if (this.peerReconcileInterval) {
			clearInterval(this.peerReconcileInterval);
			this.peerReconcileInterval = undefined;
		}
		this.actorPoseService.cleanup();
		this.pingIntervals.forEach(clearInterval);
		this.pingIntervals.clear();
		this.peerPings.clear();
		this.peerUsers.clear();
		this.connectedPeerIds.clear();
		if (this.room) {
			RoomActions.leave(this.room);
		}
	}

}
