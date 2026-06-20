// src/utils/terrain/data/terrainPayloadStore.ts
//
// Per-client, in-memory voxel payload buffer. This is the "is this terrain
// materialized on THIS client" half of the terrain model (see
// docs/terrain-payload-state-coupling.md). The canonical, synced VoxelTerrain
// carries only metadata + a ContentHash; the actual voxel SVO payload lives
// here (and, durably, in IndexedDB via TerrainStorageService).
//
// This module is intentionally dependency-light (only the voxel hash + the
// VoxelTerrain type) so the hot render/index path can import the synchronous
// `getTerrainVoxels` / `resolveTerrainVoxels` accessors without dragging in the
// IndexedDB/network machinery of TerrainStorageService -- and without forming an
// import cycle (VoxelTerrainIndex -> store -> VoxelTerrainUtils -> ...).

import type {
	EditableVoxelTerrain,
	VoxelTerrain,
} from "../../../domains/VoxelTerrain/VoxelTerrain";
import { hashVoxels } from "./VoxelDataUtils";

interface PayloadEntry {
	voxels: Uint8Array;
	contentHash: string;
}

// Shared empty payload: an un-hydrated terrain reads as zero bytes, exactly how
// it behaved when `Voxels` lived on the object as an empty string.
const EMPTY_VOXELS = new Uint8Array(0);

// terrainId -> materialized payload. Only one campaign is active per client at a
// time, so keying on the bare terrainId is safe; `resetForCampaign` clears the
// buffer when the active campaign changes so ids can't bleed across campaigns.
const memory = new Map<string, PayloadEntry>();
let activeCampaignKey: string | null = null;

/**
 * Synchronous accessor for a committed terrain's voxels. Returns zero bytes when
 * the terrain is not materialized on this client -- which is exactly how an
 * un-hydrated terrain behaved when `Voxels` lived on the object (empty), so
 * routing the index/geometry read paths through this is behavior-preserving.
 */
export function getTerrainVoxels(terrainId: string): Uint8Array {
	return memory.get(terrainId)?.voxels ?? EMPTY_VOXELS;
}

/** The ContentHash of the payload currently materialized for `terrainId`. */
export function getMaterializedContentHash(terrainId: string): string | undefined {
	return memory.get(terrainId)?.contentHash;
}

export function hasTerrainPayload(terrainId: string): boolean {
	return memory.has(terrainId);
}

/**
 * Materializes `voxels` for `terrainId`. Computes the ContentHash when one is
 * not supplied (e.g. fresh author-time edits); callers that already know the
 * hash (hydration from IDB / network) pass it to avoid a redundant hash.
 */
export function setTerrainVoxels(
	terrainId: string,
	voxels: Uint8Array,
	contentHash: string = hashVoxels(voxels)
): string {
	memory.set(terrainId, { voxels, contentHash });
	return contentHash;
}

export function dropTerrainVoxels(terrainId: string): void {
	memory.delete(terrainId);
}

/**
 * Whether the materialized payload matches what the canonical terrain currently
 * expects. A mismatch (DM edited the terrain -> new ContentHash) reports
 * not-hydrated so the caller re-fetches. Terrains with no ContentHash (legacy /
 * empty) count as hydrated as soon as any payload is buffered for them.
 */
export function isTerrainHydrated(
	terrain: VoxelTerrain | null | undefined
): boolean {
	if (!terrain) return false;
	const entry = memory.get(terrain.Id);
	if (!entry) return false;
	if (!terrain.ContentHash) return true;
	return entry.contentHash === terrain.ContentHash;
}

/**
 * Resolves the voxels to use for `terrain`. Transient editor/stamp/preview
 * pipelines pass an EditableVoxelTerrain carrying uncommitted `Voxels` inline;
 * everything else passes a canonical VoxelTerrain and reads the materialized
 * buffer. This is the single bridge that lets the live map and the editor share
 * the same index/geometry code while keeping `Voxels` off the synced object.
 */
export function resolveTerrainVoxels(
	terrain: VoxelTerrain | EditableVoxelTerrain
): Uint8Array {
	const inline = (terrain as Partial<EditableVoxelTerrain>).Voxels;
	return inline instanceof Uint8Array ? inline : getTerrainVoxels(terrain.Id);
}

/**
 * Clears the buffer when the active campaign changes. No-op when the key is
 * unchanged, so a player applying a delta for the same campaign keeps its
 * hydrated terrains. `campaignKey` is the per-client campaign identity
 * (Campaign.Id for the DM, RoomCode for players -- both land on Campaign.Id).
 *
 * Returns true when the campaign actually changed (and the buffer was cleared),
 * so callers can reset other per-campaign local state in lockstep.
 */
export function resetPayloadStoreForCampaign(campaignKey: string): boolean {
	if (activeCampaignKey === campaignKey) return false;
	activeCampaignKey = campaignKey;
	memory.clear();
	return true;
}
