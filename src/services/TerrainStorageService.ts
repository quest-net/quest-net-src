import type { Campaign } from "../domains/Campaign/Campaign";
import type {
	EditableVoxelTerrain,
	VoxelTerrain,
} from "../domains/VoxelTerrain/VoxelTerrain";
import {
	IndexedDBUtilities,
	VOXEL_TERRAINS_STORE_NAME,
} from "../utils/IndexedDBUtilities";
import { getRandomVoxelTerrainColor } from "../utils/terrain/editor/VoxelTerrainEditorUtils";
import { hashVoxels } from "../utils/terrain/data/VoxelDataUtils";
import { toPlain } from "../utils/toPlain";
import {
	dropTerrainVoxels,
	getMaterializedContentHash,
	getTerrainVoxels,
	hasTerrainPayload,
	isTerrainHydrated,
	resetPayloadStoreForCampaign,
	setTerrainVoxels,
} from "../utils/terrain/data/terrainPayloadStore";

interface StoredVoxelTerrainRecord {
	Key: string;
	CampaignId: string;
	TerrainId: string;
	// Raw SVO bytes. Records written by builds before the base64->bytes switch
	// held a base64 string; the 2.10.0 migration rewrites those to bytes, so the
	// runtime always sees Uint8Array here.
	Voxels: Uint8Array;
	ContentHash?: string;
	SavedAt: number;
}

/** A voxel payload plus its content identity, as exchanged over the wire / IDB. */
export interface TerrainPayload {
	voxels: Uint8Array;
	contentHash: string;
}

/**
 * Fetches a terrain payload from a peer (player -> DM). Installed by
 * ActionService once the terrain transfer channel is up. The DM has no provider
 * (it is the authority; a payload it lacks is genuinely missing).
 */
export type TerrainNetworkProvider = (
	terrainId: string,
	expectedHash: string | undefined
) => Promise<TerrainPayload | null>;

/**
 * Brief grace hook consulted on a ContentHash mismatch before falling back to a
 * full network fetch. Installed by TerrainTransferService (players only).
 * Resolves when a matching delta for `expectedHash` has been applied, or after a
 * short grace window elapses. Returning before the delta arrives is fine --
 * hydrate then proceeds to the (always-correct) full fetch. See
 * docs/terrain-delta-updates-plan.md, "Ordering".
 */
export type TerrainDeltaWaiter = (
	terrainId: string,
	expectedHash: string
) => Promise<void>;

/** A terrain edit's before/after payloads, handed to the delta broadcaster. */
export interface TerrainEditDelta {
	terrainId: string;
	oldBytes: Uint8Array;
	baseHash: string | undefined;
	newBytes: Uint8Array;
	newHash: string;
}

/**
 * Broadcasts the changed voxels of a terrain edit to peers (DM only). Installed
 * by TerrainTransferService, which owns the `terrainDelta` channel and the delta
 * codec. TerrainStorageService stays networking-free and only forwards the edit
 * through this hook, mirroring `setNetworkProvider`.
 */
export type TerrainDeltaBroadcaster = (edit: TerrainEditDelta) => void;

/**
 * Durable + network layer for terrain voxel payloads. The in-memory
 * materialized buffer lives in `terrainPayloadStore`; this service backs it with
 * IndexedDB (the per-client source of truth for payloads) and, for players, an
 * on-demand peer fetch. The canonical campaign object never carries voxels --
 * only metadata + a `ContentHash` (see docs/terrain-payload-state-coupling.md).
 */
export class TerrainStorageService {
	private static networkProvider: TerrainNetworkProvider | null = null;
	private static deltaWaiter: TerrainDeltaWaiter | null = null;
	private static deltaBroadcaster: TerrainDeltaBroadcaster | null = null;

	static setNetworkProvider(provider: TerrainNetworkProvider | null): void {
		this.networkProvider = provider;
	}

	static setDeltaWaiter(waiter: TerrainDeltaWaiter | null): void {
		this.deltaWaiter = waiter;
	}

	static setDeltaBroadcaster(broadcaster: TerrainDeltaBroadcaster | null): void {
		this.deltaBroadcaster = broadcaster;
	}

	/**
	 * Forwards a terrain edit's before/after payloads to the installed delta
	 * broadcaster (DM only; no-op otherwise). The broadcaster computes and sends
	 * the changed voxels so players can reconstruct the new payload locally
	 * instead of re-fetching it whole.
	 */
	static broadcastTerrainDelta(edit: TerrainEditDelta): void {
		this.deltaBroadcaster?.(edit);
	}

	// Local IDB key. Purely client-local now -- it never travels in synced state,
	// so the Campaign.Id prefix is no longer a leaked secret.
	static buildStorageKey(campaign: Campaign, terrainId: string): string {
		return `${campaign.Id}:${terrainId}`;
	}

	static isHydrated(terrain: VoxelTerrain | null | undefined): boolean {
		return isTerrainHydrated(terrain);
	}

	/**
	 * Materializes `voxels` for a terrain and stamps the small, synced metadata
	 * (ContentHash / PreviewColor) onto the canonical object. Author-time entry
	 * point used by terrain create/edit, stamp import, and migration. Returns the
	 * new ContentHash.
	 */
	static materialize(terrain: VoxelTerrain, voxels: Uint8Array): string {
		const contentHash = setTerrainVoxels(terrain.Id, voxels);
		terrain.ContentHash = contentHash;
		terrain.PreviewColor = getRandomVoxelTerrainColor(voxels);
		return contentHash;
	}

	private static async readRecord(
		key: string
	): Promise<StoredVoxelTerrainRecord | null> {
		const db = await IndexedDBUtilities.getDB();
		return new Promise<StoredVoxelTerrainRecord | null>((resolve, reject) => {
			const transaction = db.transaction([VOXEL_TERRAINS_STORE_NAME], "readonly");
			const store = transaction.objectStore(VOXEL_TERRAINS_STORE_NAME);
			const request = store.get(key);
			request.onsuccess = () => resolve(request.result ?? null);
			request.onerror = () => {
				console.error(
					`[TerrainStorageService] Failed to read terrain record: ${key}`,
					request.error
				);
				reject(request.error);
			};
		});
	}

	private static async writeRecord(
		campaign: Campaign,
		terrain: VoxelTerrain,
		voxels: Uint8Array,
		contentHash: string
	): Promise<void> {
		const key = this.buildStorageKey(campaign, terrain.Id);
		const db = await IndexedDBUtilities.getDB();
		const record: StoredVoxelTerrainRecord = {
			Key: key,
			CampaignId: campaign.Id,
			TerrainId: terrain.Id,
			Voxels: voxels,
			ContentHash: contentHash,
			SavedAt: Date.now(),
		};
		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction([VOXEL_TERRAINS_STORE_NAME], "readwrite");
			const store = transaction.objectStore(VOXEL_TERRAINS_STORE_NAME);
			const request = store.put(record);
			request.onsuccess = () => resolve();
			request.onerror = () => {
				console.error(
					`[TerrainStorageService] Failed to save terrain: ${terrain.Id}`,
					request.error
				);
				reject(request.error);
			};
		});
	}

	private static recordContentHash(record: StoredVoxelTerrainRecord): string {
		return record.ContentHash ?? hashVoxels(record.Voxels);
	}

	private static recordMatches(
		record: StoredVoxelTerrainRecord,
		terrain: VoxelTerrain
	): boolean {
		if (!terrain.ContentHash) return true;
		return this.recordContentHash(record) === terrain.ContentHash;
	}

	/**
	 * Persists the materialized payload for `terrain` to IndexedDB. No-op when the
	 * terrain is not currently materialized on this client.
	 */
	static async saveTerrain(
		campaign: Campaign,
		terrain: VoxelTerrain
	): Promise<void> {
		if (!hasTerrainPayload(terrain.Id)) return;
		const voxels = getTerrainVoxels(terrain.Id);
		const contentHash =
			getMaterializedContentHash(terrain.Id) ?? hashVoxels(voxels);
		await this.writeRecord(campaign, terrain, voxels, contentHash);
	}

	/** Reads a terrain's voxels from the materialized buffer or IndexedDB. */
	static async loadVoxels(
		campaign: Campaign,
		terrain: VoxelTerrain
	): Promise<Uint8Array | null> {
		if (isTerrainHydrated(terrain)) return getTerrainVoxels(terrain.Id);
		const record = await this.readRecord(this.buildStorageKey(campaign, terrain.Id));
		return record?.Voxels ?? null;
	}

	/**
	 * Materializes a terrain on this client: from IndexedDB when the cached
	 * payload matches the canonical ContentHash, otherwise (players) over the
	 * network. Returns the canonical terrain on success, or null when the payload
	 * could not be obtained. Does NOT mutate the terrain's geometry -- voxels land
	 * in the per-client buffer.
	 */
	static async hydrateTerrain(
		campaign: Campaign,
		terrainId: string
	): Promise<VoxelTerrain | null> {
		const terrain = campaign.VoxelTerrains.find((t) => t.Id === terrainId);
		if (!terrain) return null;
		if (isTerrainHydrated(terrain)) return terrain;

		const record = await this.readRecord(this.buildStorageKey(campaign, terrainId));
		if (record && this.recordMatches(record, terrain)) {
			setTerrainVoxels(terrainId, record.Voxels, this.recordContentHash(record));
			return terrain;
		}

		// Before paying for a full fetch, give an in-flight delta a brief window
		// to land (it races the ContentHash state-sync patch with no cross-channel
		// ordering). If the matching delta applies, the terrain materializes and we
		// avoid the multi-MB transfer entirely; otherwise we fall through below.
		if (this.deltaWaiter && terrain.ContentHash) {
			await this.deltaWaiter(terrainId, terrain.ContentHash);
			if (isTerrainHydrated(terrain)) return terrain;
			const refreshed = await this.readRecord(
				this.buildStorageKey(campaign, terrainId)
			);
			if (refreshed && this.recordMatches(refreshed, terrain)) {
				setTerrainVoxels(
					terrainId,
					refreshed.Voxels,
					this.recordContentHash(refreshed)
				);
				return terrain;
			}
		}

		if (this.networkProvider) {
			try {
				const fetched = await this.networkProvider(terrainId, terrain.ContentHash);
				if (fetched) {
					setTerrainVoxels(terrainId, fetched.voxels, fetched.contentHash);
					await this.writeRecord(
						campaign,
						terrain,
						fetched.voxels,
						fetched.contentHash
					);
					return terrain;
				}
			} catch (error) {
				console.error(
					`[TerrainStorageService] Network hydrate failed: ${terrainId}`,
					error
				);
			}
		}

		// Last resort: a stale local record is better than no terrain at all
		// (offline / DM unreachable). Eventual consistency repairs it later.
		if (record) {
			setTerrainVoxels(terrainId, record.Voxels, this.recordContentHash(record));
			return terrain;
		}

		console.warn(`[TerrainStorageService] Terrain payload unavailable: ${terrainId}`);
		return null;
	}

	/**
	 * Returns a terrain payload to serve to a requesting peer (DM side). Prefers
	 * the materialized buffer, falling back to IndexedDB.
	 */
	static async getPayloadForServing(
		campaign: Campaign,
		terrainId: string
	): Promise<TerrainPayload | null> {
		if (hasTerrainPayload(terrainId)) {
			const voxels = getTerrainVoxels(terrainId);
			return {
				voxels,
				contentHash: getMaterializedContentHash(terrainId) ?? hashVoxels(voxels),
			};
		}
		const terrain = campaign.VoxelTerrains.find((t) => t.Id === terrainId);
		if (!terrain) return null;
		const record = await this.readRecord(this.buildStorageKey(campaign, terrainId));
		if (!record) return null;
		return { voxels: record.Voxels, contentHash: this.recordContentHash(record) };
	}

	/**
	 * Reads a terrain's durably-stored payload from IndexedDB (NOT the in-memory
	 * buffer). Used as a delta base when a delta arrives for a terrain this client
	 * has cached on disk but not materialized in memory. Returns null when there
	 * is no stored record.
	 */
	static async readStoredPayload(
		campaign: Campaign,
		terrainId: string
	): Promise<TerrainPayload | null> {
		const record = await this.readRecord(this.buildStorageKey(campaign, terrainId));
		if (!record) return null;
		return { voxels: record.Voxels, contentHash: this.recordContentHash(record) };
	}

	/**
	 * Commits a delta-reconstructed payload (player side). Always refreshes the
	 * durable IndexedDB record so future loads cache-hit, and updates the
	 * in-memory buffer only when the terrain was already materialized -- so a
	 * delta for a non-rendered terrain warms the disk cache without growing the
	 * resident voxel set. No-op when the terrain is unknown to this campaign.
	 */
	static async commitDeltaPayload(
		campaign: Campaign,
		terrainId: string,
		voxels: Uint8Array,
		contentHash: string
	): Promise<void> {
		const terrain = campaign.VoxelTerrains.find((t) => t.Id === terrainId);
		if (!terrain) return;
		if (hasTerrainPayload(terrainId)) {
			setTerrainVoxels(terrainId, voxels, contentHash);
		}
		await this.writeRecord(campaign, terrain, voxels, contentHash);
	}

	/**
	 * Tactical hydration (DM-as-authority): materializes every terrain that has a
	 * player CHARACTER on it so cross-terrain moves can be validated synchronously.
	 */
	static async ensureCharacterTerrainsHydrated(
		campaign: Campaign
	): Promise<void> {
		const terrainIds = new Set<string>();
		for (const character of campaign.GameState?.Characters ?? []) {
			if (character.Position?.terrainId) {
				terrainIds.add(character.Position.terrainId);
			}
		}

		for (const terrainId of terrainIds) {
			const terrain = campaign.VoxelTerrains?.find((t) => t.Id === terrainId);
			if (terrain && !isTerrainHydrated(terrain)) {
				await this.hydrateTerrain(campaign, terrainId);
			}
		}
	}

	/** Loads a terrain's voxels inline for the editor (transient working copy). */
	static async loadTerrainForEditing(
		campaign: Campaign,
		terrain: VoxelTerrain
	): Promise<EditableVoxelTerrain | null> {
		const voxels =
			(await this.loadVoxels(campaign, terrain)) ??
			(this.networkProvider
				? (await this.hydrateTerrain(campaign, terrain.Id))
					? getTerrainVoxels(terrain.Id)
					: null
				: null);
		if (voxels === null) return null;
		return { ...terrain, Voxels: voxels };
	}

	// Terrains the local client is actively rendering.
	private static pinnedTerrainIds: Set<string> = new Set();

	static setPinnedTerrains(terrainIds: Iterable<string>): void {
		this.pinnedTerrainIds = new Set(terrainIds);
	}

	private static terrainsToKeepHydrated(campaign: Campaign): Set<string> {
		const keep = new Set<string>(this.pinnedTerrainIds);
		for (const character of campaign.GameState?.Characters ?? []) {
			if (character.Position?.terrainId) {
				keep.add(character.Position.terrainId);
			}
		}
		return keep;
	}

	static async prepareCampaignAfterLoad(campaign: Campaign): Promise<void> {
		const campaignChanged = resetPayloadStoreForCampaign(campaign.Id);

		// Pins are local UI state for the terrain THIS client was rendering. They
		// are module-level statics, so without this they survive a campaign switch
		// and leak a foreign terrain id into the keep-set below -- producing a
		// spurious "payload missing" warning and, worse, failing to pre-hydrate
		// the terrain the new campaign will actually render. Main re-pins the
		// rendered terrain on its next paint. Only clear on a real campaign change
		// so frequent same-campaign player state updates don't unpin mid-render.
		if (campaignChanged) {
			this.pinnedTerrainIds = new Set();
		}

		const keep = this.terrainsToKeepHydrated(campaign);
		for (const terrainId of keep) {
			const hydrated = await this.hydrateTerrain(campaign, terrainId);
			if (!hydrated) {
				console.warn(
					`[TerrainStorageService] Terrain payload missing: ${terrainId}`
				);
			}
		}

		await this.packInactiveTerrains(campaign);
	}

	static async prepareCampaignForStorage(campaign: Campaign): Promise<void> {
		for (const terrain of campaign.VoxelTerrains ?? []) {
			if (hasTerrainPayload(terrain.Id)) {
				await this.saveTerrain(campaign, terrain);
			}
		}
	}

	static async packInactiveTerrains(campaign: Campaign): Promise<void> {
		const keep = this.terrainsToKeepHydrated(campaign);
		for (const terrain of campaign.VoxelTerrains ?? []) {
			if (keep.has(terrain.Id)) continue;
			if (!hasTerrainPayload(terrain.Id)) continue;
			await this.saveTerrain(campaign, terrain);
			dropTerrainVoxels(terrain.Id);
		}
	}

	/**
	 * Returns a deep clone of the campaign with every terrain's voxels attached
	 * inline (EditableVoxelTerrain). Used for export, where a portable, self-
	 * contained payload is required.
	 */
	static async hydrateAllTerrains(campaign: Campaign): Promise<Campaign> {
		// campaign may be the live Valtio proxy; toPlain unwraps it (structuredClone
		// throws on proxies), then structuredClone gives a mutable deep copy.
		const clone = structuredClone(toPlain(campaign));
		for (const terrain of clone.VoxelTerrains ?? []) {
			const buffered = getTerrainVoxels(terrain.Id);
			const voxels =
				(buffered.byteLength > 0 ? buffered : await this.loadVoxels(campaign, terrain)) ??
				new Uint8Array(0);
			(terrain as EditableVoxelTerrain).Voxels = voxels;
		}
		return clone;
	}

	/**
	 * Collects every terrain's payload (from the buffer or IndexedDB) for export.
	 * Keyed by terrain Id; the campaign object itself stays payload-free.
	 */
	static async exportTerrainPayloads(
		campaign: Campaign
	): Promise<Record<string, TerrainPayload>> {
		const out: Record<string, TerrainPayload> = {};
		for (const terrain of campaign.VoxelTerrains ?? []) {
			const payload = await this.getPayloadForServing(campaign, terrain.Id);
			if (payload) out[terrain.Id] = payload;
		}
		return out;
	}

	/**
	 * Restores exported terrain payloads into IndexedDB under this (freshly
	 * id'd) campaign, so the imported terrains hydrate normally on next load.
	 */
	static async importTerrainPayloads(
		campaign: Campaign,
		payloads: Record<string, TerrainPayload>
	): Promise<void> {
		for (const terrain of campaign.VoxelTerrains ?? []) {
			const payload = payloads[terrain.Id];
			if (payload) {
				await this.writeRecord(
					campaign,
					terrain,
					payload.voxels,
					payload.contentHash
				);
			}
		}
	}

	static async deleteTerrain(
		campaign: Campaign,
		terrain: VoxelTerrain
	): Promise<void> {
		dropTerrainVoxels(terrain.Id);
		const key = this.buildStorageKey(campaign, terrain.Id);
		const db = await IndexedDBUtilities.getDB();

		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction([VOXEL_TERRAINS_STORE_NAME], "readwrite");
			const store = transaction.objectStore(VOXEL_TERRAINS_STORE_NAME);
			const request = store.delete(key);

			request.onsuccess = () => resolve();
			request.onerror = () => {
				console.error(
					`[TerrainStorageService] Failed to delete terrain: ${terrain.Id}`,
					request.error
				);
				reject(request.error);
			};
		});
	}

	static async deleteCampaignTerrains(campaignId: string): Promise<void> {
		const db = await IndexedDBUtilities.getDB();

		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction([VOXEL_TERRAINS_STORE_NAME], "readwrite");
			const store = transaction.objectStore(VOXEL_TERRAINS_STORE_NAME);
			const request = store.getAll();

			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
			request.onsuccess = () => {
				const records = (request.result ?? []) as StoredVoxelTerrainRecord[];
				for (const record of records) {
					if (record.CampaignId === campaignId) {
						store.delete(record.Key);
					}
				}
			};
			request.onerror = () => reject(request.error);
		});
	}
}
