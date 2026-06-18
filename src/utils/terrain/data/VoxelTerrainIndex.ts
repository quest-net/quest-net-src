// src/utils/VoxelTerrainIndex.ts
//
// Single runtime representation of a voxel terrain. Decodes the encoded voxel
// string once per revision and exposes the queries used by collision, geometry
// building, movement, actor placement, and the editor:
//   - hasVoxel(x, y, z)               -- collision / face culling / AO
//   - getVoxelColor(x, y, z)          -- palette index at a voxel, or null
//   - isVoxelOccupiedAtTile(...)      -- actor flight clearance
//   - allSurfaces / allSurfaceHeights -- per-tactical-tile walkable surfaces
//   - maxSurfaceHeight                -- global ceiling for framing / spawning
//
// Cache strategy: keyed on revision (= shape + Voxels string), not on terrain
// object identity. fast-json-patch replaces the terrain reference on every
// delta sync, so WeakMap<VoxelTerrain, ...> caching misses constantly. A small
// LRU keyed on the value-equal revision survives state sync correctly.

import {
	DEFAULT_TERRAIN_RESOLUTION,
	type Voxel,
	type VoxelTerrain,
} from "../../../domains/VoxelTerrain/VoxelTerrain";
import { isPassableMaterial } from "../materials/terrainMaterialRules";
import { decodeVoxels } from "./VoxelDataUtils";
import { resolveTerrainVoxels } from "./terrainPayloadStore";

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
	readonly voxelCount: number;
	readonly maxSurfaceHeight: number;
	// Per-tactical-tile walkable surfaces. Keys: `${tileX},${tileY}`.
	// `allSurfaces`       -- rules-height integers (Math.floor of exact).
	// `allSurfaceHeights` -- exact sub-tactical heights, for rendering.
	readonly allSurfaces: ReadonlyMap<string, readonly number[]>;
	readonly allSurfaceHeights: ReadonlyMap<string, readonly number[]>;
	/** Whether (vx, vy, vz) is inside the voxel grid. The single bounds authority. */
	inVoxelBounds(vx: number, vy: number, vz: number): boolean;
	hasVoxel(vx: number, vy: number, vz: number): boolean;
	/**
	 * Palette index (0..255) of the voxel at (vx, vy, vz), or null if no voxel
	 * occupies that cell. Used by the editor for sample / paint / hover lookups.
	 */
	getVoxelColor(vx: number, vy: number, vz: number): number | null;
	isVoxelOccupiedAtTile(tileX: number, tileY: number, voxelY: number): boolean;
}

const REVISION_NONE = "none";

/**
 * Value-equal terrain identity. Use anywhere you'd memoize on the terrain.
 * `voxels` defaults to the resolved payload (per-client store, or inline voxels
 * for an EditableVoxelTerrain); callers that already hold the voxel string can
 * pass it to avoid a redundant lookup.
 */
export function createTerrainRevision(
	terrain: VoxelTerrain | null | undefined,
	voxels: string = terrain ? resolveTerrainVoxels(terrain) : ""
): string {
	if (!terrain) return REVISION_NONE;
	return [
		terrain.Id,
		terrain.Width,
		terrain.Length,
		terrain.Height,
		getVoxelTerrainResolution(terrain),
		voxels,
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

function voxelGridIndex(
	vx: number,
	vy: number,
	vz: number,
	voxelWidth: number,
	voxelLayerSize: number
): number {
	return vx + vz * voxelWidth + vy * voxelLayerSize;
}

/**
 * Builds an index without touching the cache. Use this in workers, or pass
 * `decodedVoxels` to skip a redundant decode when the caller already has the
 * voxel array on hand (e.g. the geometry builder needs colors too).
 */
export function buildVoxelTerrainIndex(
	terrain: VoxelTerrain,
	voxels: string,
	decodedVoxels?: readonly Voxel[]
): VoxelTerrainIndex {
	const resolution = getVoxelTerrainResolution(terrain);
	const voxelWidth = terrain.Width * resolution;
	const voxelLength = terrain.Length * resolution;
	const voxelHeight = terrain.Height * resolution;
	const revision = createTerrainRevision(terrain, voxels);
	const voxelLayerSize = voxelWidth * voxelLength;

	// Dense occupancy/color grid. 0 means empty; occupied cells store
	// paletteIndex + 1 so all 0..255 palette values fit in Uint16.
	const voxelColors = new Uint16Array(voxelLayerSize * voxelHeight);
	const maxVoxelYs = new Int16Array(voxelLayerSize);
	maxVoxelYs.fill(-1);
	let maxVoxelY = -1;
	let voxelCount = 0;

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

		const key = voxelGridIndex(
			voxel.x,
			voxel.y,
			voxel.z,
			voxelWidth,
			voxelLayerSize
		);
		if (voxelColors[key] === 0) voxelCount++;
		voxelColors[key] = (voxel.color & 0xff) + 1;

		const idx = voxel.z * voxelWidth + voxel.x;
		if (voxel.y > maxVoxelYs[idx]) maxVoxelYs[idx] = voxel.y;
		if (voxel.y > maxVoxelY) maxVoxelY = voxel.y;
	}

	// Walkable surfaces by tactical tile: a voxel is a top surface if nothing
	// sits directly above it in the same sub-column. Collect both rules-height
	// (floor) and exact heights so renderers can step sub-tactically.
	const rulesSets = new Map<string, Set<number>>();
	const exactSets = new Map<string, Set<number>>();
	for (const voxel of decoded) {
		if (!inVoxelBounds(voxel.x, voxel.y, voxel.z)) {
			continue;
		}
		// Passable materials (e.g. water) are never a walkable surface.
		if (isPassableMaterial(voxel.color & 0xff)) {
			continue;
		}
		// A voxel is a surface only if no *solid* voxel sits directly above it.
		// A passable voxel above (e.g. water resting on ground) does not bury
		// the solid voxel beneath -- the ground stays walkable.
		const aboveColor =
			voxel.y + 1 < voxelHeight
				? voxelColors[voxelGridIndex(
					voxel.x,
					voxel.y + 1,
					voxel.z,
					voxelWidth,
					voxelLayerSize
				)]
				: 0;
		if (aboveColor !== 0 && !isPassableMaterial(aboveColor - 1)) continue;

		const key = tileKey(
			Math.floor(voxel.x / resolution),
			Math.floor(voxel.z / resolution)
		);

		let rules = rulesSets.get(key);
		if (!rules) rulesSets.set(key, (rules = new Set()));
		rules.add(voxelTopToRulesHeight(voxel.y, resolution));

		let exact = exactSets.get(key);
		if (!exact) exactSets.set(key, (exact = new Set()));
		exact.add(voxelTopToTacticalHeight(voxel.y, resolution));
	}

	const sortAsc = (a: number, b: number) => a - b;
	const allSurfaces = new Map<string, readonly number[]>();
	for (const [key, set] of rulesSets) {
		allSurfaces.set(key, [...set].sort(sortAsc));
	}
	const allSurfaceHeights = new Map<string, readonly number[]>();
	for (const [key, set] of exactSets) {
		allSurfaceHeights.set(key, [...set].sort(sortAsc));
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
		voxelCount,
		maxSurfaceHeight: voxelTopToTacticalHeight(maxVoxelY, resolution),
		allSurfaces,
		allSurfaceHeights,
		inVoxelBounds,
		hasVoxel(vx, vy, vz) {
			if (!inVoxelBounds(vx, vy, vz)) return false;
			const color = voxelColors[voxelGridIndex(
				vx,
				vy,
				vz,
				voxelWidth,
				voxelLayerSize
			)];
			// Passable materials are invisible to collision / raycast / FP capsule.
			return color !== 0 && !isPassableMaterial(color - 1);
		},
		getVoxelColor(vx, vy, vz) {
			if (!inVoxelBounds(vx, vy, vz)) return null;
			const color = voxelColors[voxelGridIndex(
				vx,
				vy,
				vz,
				voxelWidth,
				voxelLayerSize
			)];
			return color === 0 ? null : color - 1;
		},
		isVoxelOccupiedAtTile(tileX, tileY, voxelY) {
			if (voxelY < 0 || voxelY >= voxelHeight) return false;
			const startX = tileX * resolution;
			const endX = startX + resolution;
			const startZ = tileY * resolution;
			const endZ = startZ + resolution;
			if (
				startX < 0 || startZ < 0 ||
				startX >= voxelWidth || startZ >= voxelLength
			) {
				return false;
			}
			for (let vz = startZ; vz < endZ; vz++) {
				for (let vx = startX; vx < endX; vx++) {
					const color = voxelColors[voxelGridIndex(
						vx,
						voxelY,
						vz,
						voxelWidth,
						voxelLayerSize
					)];
					if (color !== 0 && !isPassableMaterial(color - 1)) return true;
				}
			}
			return false;
		},
	};
}

// Revision-keyed LRU. Size 4 covers active terrain + an undo step + a worker
// preview + slack. Insertion order is the LRU order (Map preserves it).
const INDEX_CACHE_LIMIT = 4;
const indexCache = new Map<string, VoxelTerrainIndex>();

/**
 * Cached entry point for the main thread. `voxels` defaults to the resolved
 * payload: the per-client materialized buffer for a committed terrain, or the
 * inline voxels of an EditableVoxelTerrain (editor / preview).
 */
export function getVoxelTerrainIndex(
	terrain: VoxelTerrain,
	voxels: string = resolveTerrainVoxels(terrain)
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
