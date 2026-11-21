// src/utils/VoxelTerrainIndex.ts
//
// Single runtime representation of a voxel terrain. Decodes the encoded voxel
// bytes once per revision and exposes the queries used by collision, geometry
// building, movement, actor placement, and the editor:
//   - hasVoxel(x, y, z)               -- collision / face culling / AO
//   - allSurfaces / allSurfaceHeights -- per-tactical-tile walkable surfaces
//   - maxSurfaceHeight                -- global ceiling for framing / spawning
//
// Cache strategy: keyed on revision (= shape + content hash of the payload), not
// on terrain object identity. fast-json-patch replaces the terrain reference on
// every delta sync, so WeakMap<VoxelTerrain, ...> caching misses constantly. A
// small LRU keyed on the value-equal revision survives state sync correctly.
// The revision embeds the short content hash rather than the whole payload, so
// keying never depends on the multi-megabyte voxel buffer.

import {
	ACTOR_BODY_HEIGHT_TILES,
	DEFAULT_TERRAIN_RESOLUTION,
	type EditableVoxelTerrain,
	type Voxel,
	type VoxelTerrain,
} from "../../../domains/VoxelTerrain/VoxelTerrain";
import { isPassableMaterial, isSeeThroughMaterial } from "../materials/terrainMaterialRules";
import { decodeVoxels, hashVoxels } from "./VoxelDataUtils";
import {
	getMaterializedContentHash,
	resolveTerrainVoxels,
} from "./terrainPayloadStore";

// ---------------------------------------------------------------------------
// Coordinate primitives. They live here (rather than in VoxelTerrainUtils) so
// the index can build itself without a circular dependency.
// ---------------------------------------------------------------------------

export function getVoxelTerrainResolution(terrain: VoxelTerrain): number {
	return Math.max(
		DEFAULT_TERRAIN_RESOLUTION,
		terrain.Resolution ?? DEFAULT_TERRAIN_RESOLUTION
	);
}

export function getVoxelSize(terrain: VoxelTerrain): number {
	return 1 / getVoxelTerrainResolution(terrain);
}

export function voxelTopToTacticalHeight(voxelY: number, resolution: number): number {
	return (voxelY + 1) / resolution;
}

export function voxelTopToRulesHeight(voxelY: number, resolution: number): number {
	return Math.floor(voxelTopToTacticalHeight(voxelY, resolution));
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

export interface VoxelTerrainIndex {
	readonly revision: string;
	// Tactical units.
	readonly width: number;
	readonly length: number;
	readonly height: number;
	readonly resolution: number;
	// Voxel units (= tactical * resolution).
	readonly voxelWidth: number;
	readonly voxelHeight: number;
	readonly voxelLength: number;
	// Size of one voxel in tactical units (= 1 / resolution).
	readonly voxelSize: number;
	readonly maxSurfaceHeight: number;
	// Per-tactical-tile walkable surfaces ("footing": headroom for a full body
	// over at least half the tile -- see buildVoxelTerrainIndex). Keys: `${tileX},${tileY}`.
	// `allSurfaces`       -- rules-height integers (Math.floor of exact).
	// `allSurfaceHeights` -- exact sub-tactical heights of those footings, for rendering.
	readonly allSurfaces: ReadonlyMap<string, readonly number[]>;
	readonly allSurfaceHeights: ReadonlyMap<string, readonly number[]>;
	/** Whether (vx, vy, vz) is inside the voxel grid. The single bounds authority. */
	inVoxelBounds(vx: number, vy: number, vz: number): boolean;
	hasVoxel(vx: number, vy: number, vz: number): boolean;
	/** hasVoxel minus see-through materials (glass, bars): what blocks line of sight. */
	blocksSight(vx: number, vy: number, vz: number): boolean;
}

/**
 * World-space center of voxel (vx, vy, vz). This is the single source of truth for
 * the voxel->world transform used by raycastTerrainDDA (hit-face math) and by
 * gameplay see-through picking (testing a candidate voxel against the
 * hero-occlusion cutout). Returns a plain object to keep this module THREE-free.
 */
export function voxelCenterToWorld(
	index: Pick<VoxelTerrainIndex, "resolution" | "width" | "length">,
	vx: number,
	vy: number,
	vz: number
): { x: number; y: number; z: number } {
	const res = index.resolution;
	const halfVoxel = 0.5 / res;
	return {
		x: vx / res - index.width / 2 + halfVoxel,
		y: (vy + 0.5) / res - 0.5,
		z: vz / res - index.length / 2 + halfVoxel,
	};
}

const REVISION_NONE = "none";

/**
 * Content-identity token for the payload that backs `terrain`. For a committed
 * terrain this is the O(1) materialized ContentHash; for an EditableVoxelTerrain
 * carrying inline voxels (editor / preview) it is hashed from those bytes. Falls
 * back to hashing the resolved bytes when nothing is materialized yet.
 */
function terrainPayloadToken(
	terrain: VoxelTerrain | EditableVoxelTerrain,
	voxels: Uint8Array
): string {
	const inline = (terrain as Partial<EditableVoxelTerrain>).Voxels;
	if (inline instanceof Uint8Array) return hashVoxels(inline);
	return getMaterializedContentHash(terrain.Id) ?? hashVoxels(voxels);
}

/**
 * Value-equal terrain identity. Use anywhere you'd memoize on the terrain.
 * `voxels` defaults to the resolved payload (per-client store, or inline voxels
 * for an EditableVoxelTerrain); callers that already hold the voxel bytes can
 * pass them to avoid a redundant lookup.
 */
export function createTerrainRevision(
	terrain: VoxelTerrain | null | undefined,
	voxels: Uint8Array = terrain ? resolveTerrainVoxels(terrain) : new Uint8Array(0)
): string {
	if (!terrain) return REVISION_NONE;
	return [
		terrain.Id,
		terrain.Width,
		terrain.Length,
		terrain.Height,
		getVoxelTerrainResolution(terrain),
		terrainPayloadToken(terrain, voxels),
	].join(":");
}

// Pack (x, y, z) into one numeric key for temporary coordinate sets/maps.
// Stored voxel coordinates are 0..255, but editor ghost geometry can probe
// neighbor keys at -1 or 256. Use wider lanes so those probes cannot alias
// valid edge voxels.
const VOXEL_KEY_AXIS_BITS = 10;
const VOXEL_KEY_AXIS_SIZE = 1 << VOXEL_KEY_AXIS_BITS;
const VOXEL_KEY_AXIS_MASK = VOXEL_KEY_AXIS_SIZE - 1;

export function packVoxelKey(x: number, y: number, z: number): number {
	return (
		x +
		y * VOXEL_KEY_AXIS_SIZE +
		z * VOXEL_KEY_AXIS_SIZE * VOXEL_KEY_AXIS_SIZE
	);
}

/** Inverse of packVoxelKey. */
export function unpackVoxelKey(key: number): { x: number; y: number; z: number } {
	return {
		x: key & VOXEL_KEY_AXIS_MASK,
		y: Math.floor(key / VOXEL_KEY_AXIS_SIZE) & VOXEL_KEY_AXIS_MASK,
		z: Math.floor(key / (VOXEL_KEY_AXIS_SIZE * VOXEL_KEY_AXIS_SIZE)) &
			VOXEL_KEY_AXIS_MASK,
	};
}

// Canonical string keys for the two coordinate shapes used across movement,
// adjacency, validation, and surface lookups. These are the ONLY spellings:
//   - tileKey(x, y)          -> `${x},${y}`        (per-tactical-tile, e.g. allSurfaces)
//   - tileHeightKey(x, y, h) -> `${x},${y},${h}`   (a tile at a specific rules height)
export function tileKey(tileX: number, tileY: number): string {
	return `${tileX},${tileY}`;
}

export function tileHeightKey(tileX: number, tileY: number, h: number): string {
	return `${tileX},${tileY},${h}`;
}

// The color grid is stored as 32^3 chunk blocks allocated on first write, so a
// thin surface over a wide footprint costs only its occupied chunks rather than
// a dense full-volume array (which is multi-hundred-MB at large sizes). 32 is a
// power of two so chunk/local coordinates are shift/mask, not divide/modulo.
const VOXEL_INDEX_CHUNK = 32;
const VOXEL_INDEX_CHUNK_VOLUME = VOXEL_INDEX_CHUNK * VOXEL_INDEX_CHUNK * VOXEL_INDEX_CHUNK;

/**
 * Builds an index without touching the cache. Use this in workers, or pass
 * `decodedVoxels` to skip a redundant decode when the caller already has the
 * voxel array on hand (e.g. the geometry builder needs colors too).
 */
export function buildVoxelTerrainIndex(
	terrain: VoxelTerrain,
	voxels: Uint8Array,
	decodedVoxels?: readonly Voxel[]
): VoxelTerrainIndex {
	const resolution = getVoxelTerrainResolution(terrain);
	const voxelWidth = terrain.Width * resolution;
	const voxelLength = terrain.Length * resolution;
	const voxelHeight = terrain.Height * resolution;
	const revision = createTerrainRevision(terrain, voxels);

	// Chunked occupancy/color grid. 0 means empty; occupied cells store
	// paletteIndex + 1 so all 0..255 palette values fit in Uint16. Blocks are
	// allocated lazily (see setColorAt), so empty regions cost nothing. Reads
	// stay O(1) with near-array speed -- a flat chunk array indexed by shift/mask
	// plus one null check -- which keeps the hot collision / raycast paths fast.
	const chunksX = Math.ceil(voxelWidth / VOXEL_INDEX_CHUNK);
	const chunksY = Math.ceil(voxelHeight / VOXEL_INDEX_CHUNK);
	const chunksZ = Math.ceil(voxelLength / VOXEL_INDEX_CHUNK);
	const colorChunks: (Uint16Array | null)[] = new Array(
		chunksX * chunksY * chunksZ
	).fill(null);
	let maxVoxelY = -1;

	// Callers guard with inVoxelBounds before these, so (vx,vy,vz) is always in
	// range here -- the chunk slot and local offset are therefore always valid.
	const chunkSlot = (vx: number, vy: number, vz: number): number =>
		(vx >> 5) + (vz >> 5) * chunksX + (vy >> 5) * chunksX * chunksZ;
	const chunkLocal = (vx: number, vy: number, vz: number): number =>
		(vx & 31) + (vz & 31) * VOXEL_INDEX_CHUNK +
		(vy & 31) * VOXEL_INDEX_CHUNK * VOXEL_INDEX_CHUNK;
	const colorAt = (vx: number, vy: number, vz: number): number => {
		const block = colorChunks[chunkSlot(vx, vy, vz)];
		return block ? block[chunkLocal(vx, vy, vz)] : 0;
	};
	const setColorAt = (vx: number, vy: number, vz: number, value: number): void => {
		const slot = chunkSlot(vx, vy, vz);
		let block = colorChunks[slot];
		if (!block) {
			block = new Uint16Array(VOXEL_INDEX_CHUNK_VOLUME);
			colorChunks[slot] = block;
		}
		block[chunkLocal(vx, vy, vz)] = value;
	};

	const inVoxelBounds = (vx: number, vy: number, vz: number): boolean =>
		vx >= 0 && vx < voxelWidth &&
		vy >= 0 && vy < voxelHeight &&
		vz >= 0 && vz < voxelLength;

	// Single decode pass: build occupancy + colors, track per-column maxima.
	const decoded = decodedVoxels ?? Array.from(decodeVoxels(voxels));
	for (const voxel of decoded) {
		if (!inVoxelBounds(voxel.x, voxel.y, voxel.z)) {
			continue;
		}

		setColorAt(voxel.x, voxel.y, voxel.z, (voxel.color & 0xff) + 1);

		if (voxel.y > maxVoxelY) maxVoxelY = voxel.y;
	}

	// Passable materials (e.g. water) are invisible to collision / raycast / FP
	// capsule, and never bury the solid voxel beneath them.
	const isSolidAt = (vx: number, vy: number, vz: number): boolean => {
		const color = colorAt(vx, vy, vz);
		return color !== 0 && !isPassableMaterial(color - 1);
	};

	// Walkable surfaces by tactical tile ("footing"). A solid voxel top is footing
	// when nothing solid sits in the ACTOR_BODY_HEIGHT_TILES of its sub-column
	// above it (air above the grid counts as clear). A rules height is standable
	// in a tile only when footing covers at least half of the tile's res*res
	// sub-columns, so posts, fence tops and crawlspaces are never somewhere to
	// stand. Collect both rules-height (floor) and exact heights so renderers can
	// step sub-tactically.
	const bodyVoxels = ACTOR_BODY_HEIGHT_TILES * resolution;
	const minFootingColumns = (resolution * resolution) / 2;
	const footings = new Map<string, Map<number, { columns: number; exact: Set<number> }>>();
	for (const voxel of decoded) {
		if (!inVoxelBounds(voxel.x, voxel.y, voxel.z)) continue;
		if (isPassableMaterial(voxel.color & 0xff)) continue;

		let clear = true;
		const clearTop = Math.min(voxel.y + bodyVoxels, voxelHeight - 1);
		for (let vy = voxel.y + 1; vy <= clearTop && clear; vy++) {
			if (isSolidAt(voxel.x, vy, voxel.z)) clear = false;
		}
		if (!clear) continue;

		const key = tileKey(
			Math.floor(voxel.x / resolution),
			Math.floor(voxel.z / resolution)
		);
		const rulesH = voxelTopToRulesHeight(voxel.y, resolution);
		let byRules = footings.get(key);
		if (!byRules) footings.set(key, (byRules = new Map()));
		let footing = byRules.get(rulesH);
		if (!footing) byRules.set(rulesH, (footing = { columns: 0, exact: new Set() }));
		footing.columns++;
		footing.exact.add(voxelTopToTacticalHeight(voxel.y, resolution));
	}

	const sortAsc = (a: number, b: number) => a - b;
	const allSurfaces = new Map<string, readonly number[]>();
	const allSurfaceHeights = new Map<string, readonly number[]>();
	for (const [key, byRules] of footings) {
		const rules: number[] = [];
		const exact: number[] = [];
		for (const [rulesH, footing] of byRules) {
			if (footing.columns < minFootingColumns) continue;
			rules.push(rulesH);
			exact.push(...footing.exact);
		}
		if (rules.length === 0) continue;
		allSurfaces.set(key, rules.sort(sortAsc));
		allSurfaceHeights.set(key, exact.sort(sortAsc));
	}

	const width = terrain.Width;
	const length = terrain.Length;

	return {
		revision,
		width,
		length,
		height: terrain.Height,
		resolution,
		voxelWidth,
		voxelHeight,
		voxelLength,
		voxelSize: 1 / resolution,
		maxSurfaceHeight: voxelTopToTacticalHeight(maxVoxelY, resolution),
		allSurfaces,
		allSurfaceHeights,
		inVoxelBounds,
		hasVoxel(vx, vy, vz) {
			return inVoxelBounds(vx, vy, vz) && isSolidAt(vx, vy, vz);
		},
		blocksSight(vx, vy, vz) {
			if (!inVoxelBounds(vx, vy, vz)) return false;
			const color = colorAt(vx, vy, vz);
			return (
				color !== 0 &&
				!isPassableMaterial(color - 1) &&
				!isSeeThroughMaterial(color - 1)
			);
		},
	};
}

// Revision-keyed LRU. The renderer meshes via WASM (not this index) and the
// editor mutates an EditGrid (not this index), so only the live gameplay terrain
// plus one transitional revision (e.g. mid state-sync swap) are ever needed.
// Insertion order is the LRU order (Map preserves it).
const INDEX_CACHE_LIMIT = 2;
const indexCache = new Map<string, VoxelTerrainIndex>();

/**
 * Cached entry point for the main thread. `voxels` defaults to the resolved
 * payload: the per-client materialized buffer for a committed terrain, or the
 * inline voxels of an EditableVoxelTerrain (editor / preview).
 */
export function getVoxelTerrainIndex(
	terrain: VoxelTerrain,
	voxels: Uint8Array = resolveTerrainVoxels(terrain)
): VoxelTerrainIndex {
	const revision = createTerrainRevision(terrain, voxels);
	const cached = indexCache.get(revision);
	if (cached) {
		// Refresh LRU position.
		indexCache.delete(revision);
		indexCache.set(revision, cached);
		return cached;
	}
	const index = buildVoxelTerrainIndex(terrain, voxels);
	indexCache.set(revision, index);
	while (indexCache.size > INDEX_CACHE_LIMIT) {
		const oldest = indexCache.keys().next().value;
		if (oldest === undefined) break;
		indexCache.delete(oldest);
	}
	return index;
}
