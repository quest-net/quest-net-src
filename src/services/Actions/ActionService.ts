// services/Actions/ActionService.ts

import { Context } from "../../domains/Context/Context";
import { canPerformAction, ACTION_REGISTRY, normalizeActionParams } from "./ActionRegistry";
import type { Campaign } from "../../domains/Campaign/Campaign";
import { CampaignUtils } from "../../domains/Campaign/CampaignUtils";
import { ActorUtils } from "../../domains/Actor/ActorUtils";
import { StateSync } from "../StateSync";
import { CampaignMutationRecorder } from "../CampaignMutationRecorder";
import { ImageService } from "../ImageService";
import { Room, type ActionSend } from "../../domains/Room/Room";
import { bumpPresence } from "../../domains/Context/contextStore";
import { snapshot } from "valtio";
import { RoomService } from "../../domains/Room/RoomService";
import { LogUtils } from "../../domains/Log/LogUtils";
import { User } from "../../domains/User/User";
import { CampaignLoadingService } from "../CampaignLoadingService";
import { TerrainStorageService } from "../TerrainStorageService";
import { TerrainTransferService } from "../TerrainTransferService";
import { ActorPoseService } from "../ActorPoseService";
import { ScriptEngine } from "../Scripting/ScriptEngine";

const PING_INTERVAL_MS = 3000;
// A ping that doesn't pong within this window counts as a failure. room.ping()
// never times out on its own — a silently-dead data channel leaves it pending
// forever — so this bound is what surfaces a dead connection. Kept under
// PING_INTERVAL_MS so at most one ping is outstanding per tick.
const PING_TIMEOUT_MS = 2500;
// Consecutive ping failures before we treat the peer as gone and force-close
// its connection (~3 ticks of silence).
const MAX_PING_FAILURES = 3;
const PEER_RECONCILE_INTERVAL_MS = 2000;

export class ActionService {
	private context: Context;
	private room: Room;
	private stateSync: StateSync;
	// DM-only: records campaign mutation ops for operation-based deltas.
	private mutationRecorder?: CampaignMutationRecorder;
	public imageService: ImageService;
	public actorPoseService: ActorPoseService;
	public terrainTransferService: TerrainTransferService;

	private onFirstUpdateCallback?: () => void;

	// Trystero channel send functions. Target a specific peer via the
	// `{ target }` option; omit it to broadcast to every peer.
	private sendActionRequest!: ActionSend;
	private sendUserUpdate!: ActionSend;
	private sendUserRequest!: ActionSend;

	// Peer state is split into transport presence and app-level metadata.
	// `connectedPeerIds` mirrors Trystero's active peer map. `peerUsers` is
	// optional display metadata populated by handshake/userUpdate traffic.
	public connectedPeerIds: Set<string> = new Set();
	public peerUsers: Map<string, User> = new Map();
	public peerPings: Map<string, number> = new Map();
	private pingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
	private pingFailures: Map<string, number> = new Map();
	private peerReconcileInterval?: ReturnType<typeof setInterval>;
	private lastBroadcastUserJson = "";

	// Serializes campaign mutations so async action handlers cannot interleave
	// campaign writes while awaiting terrain/IDB work. Always resolved (never
	// rejects) so a failed action can't wedge the queue.
	private mutationChain: Promise<unknown> = Promise.resolve();

	constructor(context: Context, room: Room) {
		this.context = context;
		this.room = room;
		// The DM authors deltas, so only the DM records mutation ops. `context` is
		// the live contextStore proxy, so the recorder sees every campaign write.
		this.mutationRecorder =
			context.User.Role === "dm"
				? new CampaignMutationRecorder(context)
				: undefined;
		this.stateSync = new StateSync(
			room,
			this.execute.bind(this),
			this.mutationRecorder
		);
		this.imageService = new ImageService(
			room,
			context.User.Role === "dm",
			() => this.getDmPeerId(),
			this.execute.bind(this)
		);
		this.actorPoseService = new ActorPoseService(context, room);
		this.terrainTransferService = new TerrainTransferService(
			room,
			context.User.Role === "dm",
			() => this.getDmPeerId(),
			() => this.context.ActiveCampaign
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
	 * Handshake runs before Trystero marks the peer active, so transport
	 * presence is reconciled separately through onPeerJoin/getPeers().
	 */
	recordPeerUser(peerId: string, user: User) {
		const didChangeUser = this.setPeerUser(peerId, user);
		const didChangeConnection = this.isPeerActive(peerId)
			? this.addConnectedPeer(peerId)
			: false;

		if (didChangeUser || didChangeConnection) {
			// Presence-only re-render (transient, separate non-persisted store).
			bumpPresence();
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
			// Presence-only re-render (transient, separate non-persisted store).
			bumpPresence();
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
			this.sendUserUpdate(this.context.User, { target: peerId });
			return;
		}
		if (json === this.lastBroadcastUserJson) return;
		this.lastBroadcastUserJson = json;
		this.sendUserUpdate(this.context.User);
	}

	/**
	 * Resolves the connected DM's peerId by scanning recorded peer Users.
	 * Players target on-demand image and terrain requests at the DM (the sole
	 * authority that serves them). Returns undefined until the DM's User
	 * payload has been recorded via the handshake / userUpdate.
	 */
	getDmPeerId(): string | undefined {
		for (const [peerId, user] of this.peerUsers) {
			if (user.Role === "dm") return peerId;
		}
		return undefined;
	}

	private setupChannels() {
		// Channel for action requests: Player → DM
		// Note: Trystero allows up to 32 bytes per action name.
		const actionReq = this.room.makeAction<any>("actionReq");
		this.sendActionRequest = actionReq.send;

		if (this.context.User.Role === "dm") {
			// DM listens for action requests from players
			actionReq.onMessage = (data, { peerId }) =>
				this.handlePlayerRequest(data, peerId);
		}

		// Runtime user updates (e.g., character selection mid-session).
		// Initial user exchange is handled by the joinRoom handshake.
		const userUpdate = this.room.makeAction<any>("userUpdate");
		this.sendUserUpdate = userUpdate.send;
		userUpdate.onMessage = (data, { peerId }) => {
			if (data && typeof data === "object") {
				const didChangeUser = this.setPeerUser(peerId, data as unknown as User);
				const didChangeConnection = this.isPeerActive(peerId)
					? this.addConnectedPeer(peerId)
					: false;

				if (didChangeUser || didChangeConnection) {
					// Presence-only re-render (transient, separate non-persisted store).
					bumpPresence();
				}
			}
		};

		const userReq = this.room.makeAction<any>("userReq");
		this.sendUserRequest = userReq.send;
		userReq.onMessage = (_data, { peerId }) => {
			this.broadcastSelf(peerId);
		};
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
		// polluting StateSync's internal baseline. Prepare the plain clone
		// before it lands on the proxy so terrain hydration doesn't pay the
		// proxy-tracking cost.
		const isolatedCampaign = structuredClone(campaign);
		await TerrainStorageService.prepareCampaignAfterLoad(isolatedCampaign);
		const refreshedInfo =
			CampaignLoadingService.buildPlayerInfo(isolatedCampaign);

		// Land the new authoritative campaign + refreshed metadata directly on
		// the proxy store (this.context). Valtio re-renders the components that
		// read these fields — no manual trigger, and no captured-reference
		// staleness, because the proxy is the single source of truth.
		this.context.ActiveCampaign = isolatedCampaign;

		const idx = this.context.Campaigns.findIndex(
			(c) => c.Id === refreshedInfo.Id
		);
		if (idx !== -1) {
			this.context.Campaigns[idx] = refreshedInfo;
		} else {
			this.context.Campaigns.push(refreshedInfo);
		}

		// Live actor poses are deliberately NOT cleared here. Poses self-expire
		// (ACTOR_POSE_TIMEOUT_MS) and are pruned on peer loss; wiping them all on
		// every incoming broadcast made walking tokens lurch back toward their
		// last committed tile whenever ANY action landed.

		// Promote CampaignView to "ready" on the first state we receive.
		if (this.onFirstUpdateCallback) {
			this.onFirstUpdateCallback();
			this.onFirstUpdateCallback = undefined;
		}
	}

	private setupPeerHandlers() {
		this.room.onPeerJoin = (peerId) => {
			const didChangeConnection = this.addConnectedPeer(peerId);

			if (this.context.User.Role === "dm") {
				void this.broadcastFullAfterPendingMutations().catch((error) => {
					console.error("[ActionService] Error broadcasting full state:", error);
				});
			}

			if (didChangeConnection) {
				// Presence-only re-render (transient, separate non-persisted store).
				bumpPresence();
			}
		};

		this.room.onPeerLeave = (peerId) => {
			this.forgetPeer(peerId);
		};

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
		this.sendUserRequest({ userId: this.context.User.Id }, { target: peerId });
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
			// Presence-only re-render (transient, separate non-persisted store).
			bumpPresence();
		}
	}

	private startPinging(peerId: string) {
		this.stopPinging(peerId);
		let pinging = false;
		const tick = async () => {
			// Skip if a ping is still outstanding so failures are counted once
			// per tick and we never stack pings on a slow/dead link.
			if (pinging) return;
			pinging = true;
			try {
				const ms = await this.pingWithTimeout(peerId);
				this.peerPings.set(peerId, ms);
				this.pingFailures.delete(peerId);
				// Presence-only re-render (transient, separate non-persisted store).
				bumpPresence();
			} catch {
				// Count consecutive failures; a sustained run means the
				// connection is dead even if Trystero hasn't noticed.
				const failures = (this.pingFailures.get(peerId) ?? 0) + 1;
				this.pingFailures.set(peerId, failures);
				if (failures >= MAX_PING_FAILURES) {
					this.evictDeadPeer(peerId);
				}
			} finally {
				pinging = false;
			}
		};
		tick();
		this.pingIntervals.set(peerId, setInterval(tick, PING_INTERVAL_MS));
	}

	/**
	 * Pings a peer, rejecting if no pong arrives within PING_TIMEOUT_MS.
	 * room.ping() stays pending forever on a silently-dead data channel, so we
	 * bound it here to turn that silence into a detectable failure.
	 */
	private async pingWithTimeout(peerId: string): Promise<number> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<number>((_, reject) => {
			timer = setTimeout(
				() => reject(new Error("ping timeout")),
				PING_TIMEOUT_MS
			);
		});
		try {
			return await Promise.race([this.room.ping(peerId), timeout]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	/**
	 * Treats a peer that has stopped responding to pings as gone. Trystero only
	 * drops a peer when its RTCPeerConnection fires a close event, which never
	 * happens for a silently-dead connection (tab killed, sleep, NAT drop) — so
	 * the peer would otherwise linger in getPeers() forever, keeping peer count
	 * above 0 and blocking peerless reconnects. Force-closing the connection
	 * makes Trystero notice and reap it (firing onPeerLeave -> forgetPeer).
	 */
	private evictDeadPeer(peerId: string): void {
		console.warn(
			`[ActionService] Peer ${peerId} unresponsive after ${MAX_PING_FAILURES} pings; closing its connection.`
		);
		try {
			this.room.getPeers()[peerId]?.close();
		} catch (error) {
			console.error(`[ActionService] Error closing dead peer ${peerId}:`, error);
		}
		// Drop local state now in case the close event is slow or never fires.
		this.forgetPeer(peerId);
	}

	private stopPinging(peerId: string) {
		const interval = this.pingIntervals.get(peerId);
		if (interval) {
			clearInterval(interval);
			this.pingIntervals.delete(peerId);
		}
		this.peerPings.delete(peerId);
		this.pingFailures.delete(peerId);
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
	 * Runs a campaign action under the mutation queue, then publishes fresh
	 * references for memoized UI paths and packs inactive terrain payloads. This
	 * intentionally uses the real campaign object, not an Immer draft: several
	 * action handlers await terrain hydration / IndexedDB work, and drafts are
	 * revoked after finalization, making them unsafe to expose through context.
	 */
	private mutateCampaign(
		producer: () => Promise<void> | void
	): Promise<Campaign> {
		const run = this.mutationChain.then(() => this.runMutateCampaign(producer));
		this.mutationChain = run.then(
			() => undefined,
			() => undefined
		);
		return run;
	}

	private async runMutateCampaign(
		producer: () => Promise<void> | void
	): Promise<Campaign> {
		await producer();
		const campaign = CampaignUtils.getActiveCampaign(this.context);
		await TerrainStorageService.packInactiveTerrains(campaign);
		this.commitActiveCampaign(campaign);
		return campaign;
	}

	private async broadcastFullAfterPendingMutations(): Promise<void> {
		await this.mutationChain;
		const campaign = CampaignUtils.getActiveCampaign(this.context);
		const isSecret = this.context.SecretModes?.[campaign.Id];
		if (isSecret) return;
		// Pack inactive terrains on the live proxy first, then broadcast a plain
		// snapshot so no proxy leaks into StateSync's diffing/transport.
		await TerrainStorageService.packInactiveTerrains(campaign);
		this.stateSync.broadcastFull(this.snapshotActiveCampaign());
	}

	/**
	 * Pins the active campaign onto the proxy store. Domain actions mutate the
	 * campaign in place (which Valtio already tracks); this also covers the rare
	 * action that REPLACES context.ActiveCampaign wholesale. `this.context` is
	 * the proxy itself, so there is no longer a stale captured-reference problem
	 * to reconcile — and persistence is handled by ContextProvider's
	 * subscription, not here.
	 */
	private commitActiveCampaign(campaign: Campaign): void {
		this.context.ActiveCampaign = campaign;
	}

	/**
	 * A plain, deeply-immutable copy of the active campaign for StateSync /
	 * network use. Snapshotting at this boundary guarantees no live Valtio proxy
	 * leaks into JSON-patch diffing, compression, or the wire.
	 */
	private snapshotActiveCampaign(): Campaign {
		const active = this.context.ActiveCampaign;
		if (!active) {
			throw new Error("[ActionService] No active campaign to broadcast");
		}
		return snapshot(active) as unknown as Campaign;
	}

	/**
	 * DM executes action directly and broadcasts result
	 */
	private async executeDM(actionKey: string, params: any): Promise<void> {
		const campaign = await this.mutateCampaign(async () => {
			// Before-phase: let "before" scripts rewrite params or veto the action. On
			// veto we skip the handler and reactions; the unchanged campaign is still
			// broadcast below, which reverts any player optimistic update.
			const before = await ScriptEngine.beforeAction(actionKey, params, this.context);
			if (before.cancelled) return;
			params = before.params;
			// Snapshot script hosts before the action (so onRemove cleanup still binds).
			const scriptSnapshot = ScriptEngine.beginAction(actionKey, this.context);
			await this.runDomainAction(actionKey, params);
			// Authoritative reactions: run scripts triggered by this action (and the
			// whole cascade) inside the same mutation, so it commits/broadcasts once.
			await ScriptEngine.onAction(
				actionKey,
				params,
				undefined,
				this.context,
				scriptSnapshot
			);
		});

		const isSecret = this.context.SecretModes?.[campaign.Id];
		if (!isSecret) {
			this.stateSync.broadcast(this.snapshotActiveCampaign());
		}

		this.actorPoseService.clearForAuthoritativeAction(actionKey, params);
	}

	/**
	 * Player sends action request to DM
	 */
	private async executePlayer(actionKey: string, params: any): Promise<void> {

		// Check for connection before allowing any action
		if (!RoomService.hasConnectedPeers(this.room)) {
			console.warn("[ActionService] No peers connected. Action blocked.");
			return;
		}

		// OPTIMISTIC UPDATE: Run locally first
		try {
			this.context.IsOptimistic = true;
			await this.mutateCampaign(async () => {
				await this.runDomainAction(actionKey, params);
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
		const activeCampaign = CampaignUtils.getActiveCampaign(this.context);
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

		// Authoritative ownership re-check. The DM already holds each player's
		// selected characters (peerUsers, via requestingUser), so it validates the
		// request against its own records here rather than running the action under
		// the player's identity. The action itself then runs as the DM — we never
		// write the player's identity onto the reactive store (doing so across the
		// action's awaits would leak into the DM's UI and kick it out of
		// first-person / hijack its map selection).
		if (
			!ActorUtils.playerMayTarget(
				requestingUser,
				data?.actionKey,
				data?.params ?? {},
				this.context
			)
		) {
			console.warn(
				`Player ${requestingUser.Id} cannot target ${data?.params?.actorId} with ${data?.actionKey}`
			);
			return;
		}

		try {
			await this.mutateCampaign(async () => {
				// Before-phase: "before" scripts may rewrite the request's params or
				// veto it. On veto we skip the handler/reactions; the broadcast below
				// still fires and resets the player's optimistic update.
				const before = await ScriptEngine.beforeAction(
					data.actionKey,
					data.params,
					this.context
				);
				if (before.cancelled) return;
				data.params = before.params;
				// Snapshot script hosts before the action (so onRemove cleanup still binds).
				const scriptSnapshot = ScriptEngine.beginAction(data.actionKey, this.context);
				await this.runDomainAction(data.actionKey, data.params);
				// Reactions run as the DM (authoritative), atomic with the request.
				await ScriptEngine.onAction(
					data.actionKey,
					data.params,
					undefined,
					this.context,
					scriptSnapshot
				);
			});
		} catch (error) {
			console.error("[ActionService] Error executing player request:", error);
			// We continue to broadcast below to force a reset if needed
		}

		// Broadcast updated campaign to all players. Snapshot the current proxy
		// state (post-attempt) — if the mutateCampaign above threw, this is the
		// pre-mutation state, which is exactly what resets the player's
		// optimistic update.
		const campaign = this.snapshotActiveCampaign();

		if (LogUtils.isCommand(data.params, "/REQUEST_FULL_SYNC")) {
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
			// Hand the handler a fresh, mutable, plain copy of params so a frozen
			// snapshot slice (DM-local dispatch) can't leak into the store proxy.
			await action.handler(normalizeActionParams(params), this.context);
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
			// Empty producer: mutateCampaign still serializes against in-flight
			// actions and packs inactive terrains before we broadcast.
			await this.mutateCampaign(async () => {});
			this.stateSync.broadcastFull(this.snapshotActiveCampaign());
		}
	}

	cleanup(): void {
		if (this.peerReconcileInterval) {
			clearInterval(this.peerReconcileInterval);
			this.peerReconcileInterval = undefined;
		}
		this.mutationRecorder?.dispose();
		this.actorPoseService.cleanup();
		this.terrainTransferService.cleanup();
		this.pingIntervals.forEach(clearInterval);
		this.pingIntervals.clear();
		this.pingFailures.clear();
		this.peerPings.clear();
		this.peerUsers.clear();
		this.connectedPeerIds.clear();
		if (this.room) {
			RoomService.leave(this.room);
		}
	}

}
