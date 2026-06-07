// services/TerrainTransferService.ts
//
// Peer transfer of terrain voxel payloads. Terrain payloads are not part of
// state sync (only the ContentHash metadata is), so this service is how a client
// gets the actual voxels it needs. It owns two complementary Trystero channels:
//
//   terrainFetch  (request/response) -- the FULL-payload fallback. A player that
//     needs a terrain it does not have cached requests it from the DM, which
//     responds with the whole SVO. Always correct; the per-request timeout and
//     chunking of the (possibly multi-megabyte) payload are Trystero's job.
//
//   terrainDelta  (broadcast) -- a BANDWIDTH optimization over the above. On a
//     terrain edit the DM broadcasts only the changed voxels; players holding the
//     matching base payload reconstruct the new SVO locally instead of re-pulling
//     the whole thing. Purely additive: a missing / inapplicable / hash-mismatched
//     delta falls through to the terrainFetch full fetch, so it is never a
//     correctness risk. See docs/terrain-delta-updates-plan.md.
//
// Both halves install hooks on the networking-free TerrainStorageService
// (setNetworkProvider / setDeltaBroadcaster / setDeltaWaiter); the storage layer
// stays dependency-light and never imports the room.

import type { Room, ActionRequest, ActionSend } from "../domains/Room/Room";
import type { Campaign } from "../domains/Campaign/Campaign";
import { triggerContextUpdate } from "../domains/Context/ContextProvider";
import {
	TerrainStorageService,
	type TerrainEditDelta,
	type TerrainPayload,
} from "./TerrainStorageService";
import { hashVoxels } from "../utils/terrain/data/VoxelDataUtils";
import {
	getMaterializedContentHash,
	getTerrainVoxels,
} from "../utils/terrain/data/terrainPayloadStore";
import {
	applyVoxelDelta,
	computeVoxelDelta,
	decodeDelta,
	encodeDelta,
} from "../utils/terrain/data/VoxelTerrainDeltaUtils";

const TERRAIN_REQUEST_TIMEOUT_MS = 30000;

// How long hydrate holds a full fetch waiting for an in-flight delta to land.
// Long enough to cover cross-channel jitter between the delta broadcast and the
// ContentHash state-sync patch; short enough to be imperceptible if no delta is
// coming (then we full-fetch as before).
const DELTA_GRACE_MS = 300;

/** Wire envelope broadcast on the `terrainDelta` channel (DM -> players). */
interface TerrainDeltaMessage {
	terrainId: string;
	/** ContentHash the delta was computed against; the player must hold this base. */
	baseHash: string;
	/** ContentHash of the payload the delta reconstructs; re-hash check target. */
	newHash: string;
	/** Compact base64 delta (see VoxelTerrainDeltaUtils.encodeDelta). */
	delta: string;
}

interface DeltaWaiterEntry {
	settle: () => void;
}

export class TerrainTransferService {
	private room: Room;
	private isDM: boolean;
	private getCampaign: () => Campaign | null;
	private getDmPeerId: () => string | undefined;

	private requestTerrainData!: ActionRequest; // terrainId -> TerrainPayload
	private sendDelta!: ActionSend; // TerrainDeltaMessage broadcast

	// Dedup concurrent player requests for the same terrainId.
	private pending = new Map<string, Promise<TerrainPayload | null>>();

	// --- Delta apply state (players) ---------------------------------------
	// Last delta-reconstructed hash per terrain, so a hydrate that runs just
	// after a delta applies can short-circuit without waiting.
	private appliedHashes = new Map<string, string>();
	// Pending hydrate waiters keyed by `${terrainId}::${expectedHash}`.
	private waiters = new Map<string, Set<DeltaWaiterEntry>>();
	// Serializes delta application so chained edits (H0->H1->H2 arriving back to
	// back) apply strictly in order; Trystero delivers messages in order, but the
	// async handlers would otherwise interleave and a later delta could read a
	// base its predecessor hasn't committed yet.
	private applyChain: Promise<unknown> = Promise.resolve();

	constructor(
		room: Room,
		isDM: boolean,
		getDmPeerId: () => string | undefined,
		getCampaign: () => Campaign | null
	) {
		this.room = room;
		this.isDM = isDM;
		this.getDmPeerId = getDmPeerId;
		this.getCampaign = getCampaign;
		this.setupChannels();

		if (isDM) {
			// DM authors edits -> broadcasts deltas.
			TerrainStorageService.setDeltaBroadcaster((edit) => this.broadcastDelta(edit));
		} else {
			// Players resolve missing/changed terrain payloads through this service:
			// first a brief delta grace window, then the full fetch.
			TerrainStorageService.setNetworkProvider((terrainId, expectedHash) =>
				this.requestTerrain(terrainId, expectedHash)
			);
			TerrainStorageService.setDeltaWaiter((terrainId, expectedHash) =>
				this.waitForDelta(terrainId, expectedHash)
			);
		}
	}

	private setupChannels(): void {
		const terrainFetch = this.room.makeAction<any, any>("terrainFetch", {
			kind: "request",
			onRequest: this.isDM
				? (terrainId) => this.serveTerrain(terrainId as string)
				: undefined,
		});
		this.requestTerrainData = terrainFetch.request;

		const terrainDelta = this.room.makeAction<any>("terrainDelta");
		this.sendDelta = terrainDelta.send;
		if (!this.isDM) {
			terrainDelta.onMessage = (data) => {
				this.enqueueDelta(data as TerrainDeltaMessage);
			};
		}
	}

	// --- Full-payload fetch (terrainFetch) ---------------------------------

	/** Player: request a terrain payload from the DM (deduped per terrainId). */
	private requestTerrain(
		terrainId: string,
		_expectedHash: string | undefined
	): Promise<TerrainPayload | null> {
		const existing = this.pending.get(terrainId);
		if (existing) return existing;

		const promise = this.fetchTerrain(terrainId);
		this.pending.set(terrainId, promise);
		promise.finally(() => this.pending.delete(terrainId));
		return promise;
	}

	private async fetchTerrain(terrainId: string): Promise<TerrainPayload | null> {
		const dmPeerId = this.getDmPeerId();
		if (!dmPeerId) {
			console.warn(
				`[TerrainTransferService] No DM peer to request terrain ${terrainId}`
			);
			return null;
		}

		try {
			const payload = (await this.requestTerrainData(terrainId, {
				target: dmPeerId,
				timeoutMs: TERRAIN_REQUEST_TIMEOUT_MS,
			})) as TerrainPayload | null;
			return {
				voxels: payload?.voxels ?? "",
				contentHash: payload?.contentHash ?? "",
			};
		} catch (error) {
			console.warn(
				`[TerrainTransferService] Failed to fetch terrain ${terrainId}:`,
				error
			);
			return null;
		}
	}

	/** DM: serve a requested terrain payload. Throws if it cannot be served. */
	private async serveTerrain(terrainId: string): Promise<TerrainPayload> {
		const campaign = this.getCampaign();
		if (!campaign) {
			throw new Error("No active campaign to serve terrain from");
		}
		const payload = await TerrainStorageService.getPayloadForServing(
			campaign,
			terrainId
		);
		if (!payload) {
			throw new Error(`No payload to serve for terrain ${terrainId}`);
		}
		return payload;
	}

	// --- Delta broadcast (DM) ----------------------------------------------

	/**
	 * DM: compute the old->new delta and broadcast it. No-op whenever a delta is
	 * not worth sending (no base, nothing changed, or not a net win) -- players
	 * then full-fetch.
	 */
	private broadcastDelta(edit: TerrainEditDelta): void {
		const { terrainId, oldB64, newB64, baseHash, newHash } = edit;
		if (!oldB64 || !newB64) return;
		if (!baseHash || baseHash === newHash) return;

		let delta;
		try {
			delta = computeVoxelDelta(oldB64, newB64);
		} catch (error) {
			console.warn(`[TerrainTransferService] Delta compute failed for ${terrainId}:`, error);
			return;
		}
		if (!delta) return;

		let encoded: string;
		try {
			encoded = encodeDelta(delta);
		} catch (error) {
			console.warn(`[TerrainTransferService] Delta encode failed for ${terrainId}:`, error);
			return;
		}

		const message: TerrainDeltaMessage = { terrainId, baseHash, newHash, delta: encoded };
		void this.sendDelta(message);
	}

	// --- Delta apply + grace window (players) ------------------------------

	private static waiterKey(terrainId: string, hash: string): string {
		return `${terrainId}::${hash}`;
	}

	/**
	 * Resolves once a delta producing `expectedHash` has been applied for
	 * `terrainId`, or after DELTA_GRACE_MS. Called by TerrainStorageService on a
	 * ContentHash mismatch, before it falls back to a full fetch.
	 */
	private waitForDelta(terrainId: string, expectedHash: string): Promise<void> {
		if (this.appliedHashes.get(terrainId) === expectedHash) {
			return Promise.resolve();
		}

		return new Promise<void>((resolve) => {
			const key = TerrainTransferService.waiterKey(terrainId, expectedHash);
			let settled = false;
			let timer: ReturnType<typeof setTimeout>;

			const entry: DeltaWaiterEntry = {
				settle: () => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					this.waiters.get(key)?.delete(entry);
					resolve();
				},
			};

			timer = setTimeout(entry.settle, DELTA_GRACE_MS);

			const set = this.waiters.get(key) ?? new Set<DeltaWaiterEntry>();
			set.add(entry);
			this.waiters.set(key, set);
		});
	}

	private markApplied(terrainId: string, newHash: string): void {
		this.appliedHashes.set(terrainId, newHash);
		const set = this.waiters.get(TerrainTransferService.waiterKey(terrainId, newHash));
		if (set) {
			for (const entry of Array.from(set)) entry.settle();
		}
	}

	/** Queues a received delta for strictly-ordered application. */
	private enqueueDelta(message: TerrainDeltaMessage): void {
		const run = this.applyChain.then(() => this.handleDelta(message));
		this.applyChain = run.then(
			() => undefined,
			(error) => {
				console.warn("[TerrainTransferService] Delta application error:", error);
			}
		);
	}

	/** Player: reconstruct, verify, and commit a broadcast delta. */
	private async handleDelta(message: TerrainDeltaMessage): Promise<void> {
		const { terrainId, baseHash, newHash, delta } = message ?? ({} as TerrainDeltaMessage);
		if (!terrainId || !baseHash || !newHash || typeof delta !== "string") return;

		const campaign = this.getCampaign();
		if (!campaign) return;
		const terrain = campaign.VoxelTerrains.find((t) => t.Id === terrainId);
		if (!terrain) return;

		// Already at the target (duplicate delta, or a full fetch beat us here).
		if (getMaterializedContentHash(terrainId) === newHash) {
			this.markApplied(terrainId, newHash);
			return;
		}

		// Find the base payload the delta was computed against. Prefer the live
		// materialized buffer; otherwise the durable IDB record (warm-cache path
		// for a terrain this client has on disk but not in memory).
		let base: string | null = null;
		if (getMaterializedContentHash(terrainId) === baseHash) {
			base = getTerrainVoxels(terrainId);
		} else {
			const stored = await TerrainStorageService.readStoredPayload(campaign, terrainId);
			if (stored && stored.contentHash === baseHash) base = stored.voxels;
		}
		// Base mismatch: this client is behind / never hydrated. Ignore the delta
		// and let the normal ContentHash-mismatch path issue a full fetch.
		if (base == null) return;

		let newB64: string;
		try {
			newB64 = applyVoxelDelta(base, decodeDelta(delta));
		} catch (error) {
			console.warn(`[TerrainTransferService] Delta apply failed for ${terrainId}:`, error);
			return;
		}

		// Correctness net: the reconstruction must hash to the broadcast newHash.
		// A mismatch means a stale base or codec problem -- bail and let the full
		// fetch correct it rather than caching wrong bytes.
		if (hashVoxels(newB64) !== newHash) {
			console.warn(
				`[TerrainTransferService] Delta hash mismatch for ${terrainId}; ignoring (full fetch will correct).`
			);
			return;
		}

		await TerrainStorageService.commitDeltaPayload(campaign, terrainId, newB64, newHash);
		this.markApplied(terrainId, newHash);

		// Re-render to re-mesh only once the ContentHash patch has caught up;
		// rendering while terrain.ContentHash still trails newHash would look like
		// a mismatch and could spuriously trigger a full fetch. When the patch
		// lands first (or together), it drives its own re-render.
		if (terrain.ContentHash === newHash) {
			triggerContextUpdate();
		}
	}

	cleanup(): void {
		// In-flight requests reject on their own when the room tears down
		// (peer disconnect) or their timeout fires; just drop the dedup map.
		this.pending.clear();
		if (this.isDM) {
			TerrainStorageService.setDeltaBroadcaster(null);
		} else {
			TerrainStorageService.setNetworkProvider(null);
			TerrainStorageService.setDeltaWaiter(null);
		}
		for (const set of this.waiters.values()) {
			for (const entry of Array.from(set)) entry.settle();
		}
		this.waiters.clear();
		this.appliedHashes.clear();
	}
}
