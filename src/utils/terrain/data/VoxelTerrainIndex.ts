// src/utils/VoxelTerrainIndex.ts
//
// Single runtime representation of a voxel terrain. Decodes the encoded voxel
// string once per revision and exposes the queries used by collision, geometry
// building, movement, actor placement, and the editor:
//   - hasVoxel(x, y, z)               -- collision / face culling / AO
//   - getVoxelColor(x, y, z)          -- palette index at a voxel, or null
//   - isVoxelOccupiedAtTile(...)      -- actor flight clearance
//   - allSurfaces / allSurfaceHeights -- per-tactical-tile walkable surfaces
//   - columnSurfaceHeight(x, z)       -- "where's the ground" fallback
//   - maxSurfaceHeight                -- global ceiling for framing / spawning
//
// Cache strategy: keyed on revision (= shape + Voxels string), not on terrain
// object identity. fast-json-patch replaces the terrain reference on every
// delta sync, so WeakMap<VoxelTerrain, ...> caching misses constantly. A small
// LRU keyed on the value-equal revision survives state sync correctly.

import {
	DEFAULT_TERRAIN_RESOLUTION,
} from "../../../domains/VoxelTerrain/voxelTerrainConstants";
import type { Voxel, VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { decodeVoxels } from "./VoxelDataUtils";

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
	hasVoxel(vx: number, vy: number, vz: number): boolean;
	/**
	 * Palette index (0..255) of the voxel at (vx, vy, vz), or null if no voxel
	 * occupies that cell. Used by the editor for sample / paint / hover lookups.
	 */
	getVoxelColor(vx: number, vy: number, vz: number): number | null;
	isVoxelOccupiedAtTile(tileX: number, tileY: number, voxelY: number): boolean;
	/**
	 * Exact top-of-terrain height in the center sub-voxel column of tactical
	 * tile (x, z). Returns 0 if the column is empty. This is the
	 * "where's the ground" fallback used when a tile has no walkable surfaces;
	 * unlike `allSurfaceHeights` it does not require the voxel to be unblocked.
	 */
	columnSurfaceHeight(x: number, z: number): number;
}

const REVISION_NONE = "none";

/** Value-equal terrain identity. Use anywhere you'd memoize on the terrain. */
export function createTerrainRevision(
	terrain: VoxelTerrain | null | undefined
): string {
	if (!terrain) return REVISION_NONE;
	return [
		terrain.Id,
		terrain.Width,
		terrain.Length,
		terrain.Height,
		getVoxelTerrainResolution(terrain),
		terrain.Voxels,
	].join(":");
}

// Pack (x, y, z) into one 32-bit integer for runtime lookup caches.
// x/y/z are 0..255.
export function packVoxelKey(x: number, y: number, z: number): number {
	return x + (y << 8) + (z << 16);
}

/** Inverse of packVoxelKey. */
export function unpackVoxelKey(key: number): { x: number; y: number; z: number } {
	return {
		x: key & 0xff,
		y: (key >>> 8) & 0xff,
		z: (key >>> 16) & 0xff,
	};
}

function tileKey(tileX: number, tileY: number): string {
	return `${tileX},${tileY}`;
}

// Mirrors the old `tacticalCoordinateToCachedVoxelIndex` semantics:
// "center sub-column of tactical tile (coordinate)". Clamped to [0, voxelMax-1].
function tacticalToCenterVoxel(
	coordinate: number,
	maxTactical: number,
	resolution: number
): number {
	const voxelMax = maxTactical * resolution - 1;
	const candidate = Math.floor((coordinate + 0.5) * resolution);
	if (candidate < 0) return 0;
	if (candidate > voxelMax) return voxelMax;
	return candidate;
}

/**
 * Builds an index without touching the cache. Use this in workers, or pass
 * `decodedVoxels` to skip a redundant decode when the caller already has the
 * voxel array on hand (e.g. the geometry builder needs colors too).
 */
export function buildVoxelTerrainIndex(
	terrain: VoxelTerrain,
	decodedVoxels?: readonly Voxel[]
): VoxelTerrainIndex {
	const resolution = getVoxelTerrainResolution(terrain);
	const voxelWidth = terrain.Width * resolution;
	const voxelLength = terrain.Length * resolution;
	const voxelHeight = terrain.Height * resolution;
	const revision = createTerrainRevision(terrain);

	const occupied = new Set<number>();
	const colors = new Map<number, number>();
	const maxVoxelYs = new Int16Array(voxelWidth * voxelLength);
	maxVoxelYs.fill(-1);
	let maxVoxelY = -1;

	// Single decode pass: build occupancy + colors, track per-column maxima.
	const voxels = decodedVoxels ?? Array.from(decodeVoxels(terrain.Voxels));
	for (const voxel of voxels) {
		const key = packVoxelKey(voxel.x, voxel.y, voxel.z);
		occupied.add(key);
		colors.set(key, voxel.color);
		if (
			voxel.x < 0 || voxel.z < 0 ||
			voxel.x >= voxelWidth || voxel.z >= voxelLength
		) {
			continue;
		}
		const idx = voxel.z * voxelWidth + voxel.x;
		if (voxel.y > maxVoxelYs[idx]) maxVoxelYs[idx] = voxel.y;
		if (voxel.y > maxVoxelY) maxVoxelY = voxel.y;
	}

	const surfaceHeights = new Float32Array(maxVoxelYs.length);
	for (let i = 0; i < maxVoxelYs.length; i++) {
		surfaceHeights[i] = voxelTopToTacticalHeight(maxVoxelYs[i], resolution);
	}

	// Walkable surfaces by tactical tile: a voxel is a top surface if nothing
	// sits directly above it in the same sub-column. Collect both rules-height
	// (floor) and exact heights so renderers can step sub-tactically.
	const rulesSets = new Map<string, Set<number>>();
	const exactSets = new Map<string, Set<number>>();
	for (const voxel of voxels) {
		if (
			voxel.x < 0 || voxel.z < 0 ||
			voxel.x >= voxelWidth || voxel.z >= voxelLength
		) {
			continue;
		}
		if (occupied.has(packVoxelKey(voxel.x, voxel.y + 1, voxel.z))) continue;

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
		voxelCount: voxels.length,
		maxSurfaceHeight: voxelTopToTacticalHeight(maxVoxelY, resolution),
		allSurfaces,
		allSurfaceHeights,
		hasVoxel(vx, vy, vz) {
			return occupied.has(packVoxelKey(vx, vy, vz));
		},
		getVoxelColor(vx, vy, vz) {
			const color = colors.get(packVoxelKey(vx, vy, vz));
			return color === undefined ? null : color;
		},
		isVoxelOccupiedAtTile(tileX, tileY, voxelY) {
			const startX = tileX * resolution;
			const endX = startX + resolution;
			const startZ = tileY * resolution;
			const endZ = startZ + resolution;
			for (let vz = startZ; vz < endZ; vz++) {
				for (let vx = startX; vx < endX; vx++) {
					if (occupied.has(packVoxelKey(vx, voxelY, vz))) return true;
				}
			}
			return false;
		},
		columnSurfaceHeight(x, z) {
			const vx = tacticalToCenterVoxel(x, width, resolution);
			const vz = tacticalToCenterVoxel(z, length, resolution);
			return surfaceHeights[vz * voxelWidth + vx] ?? 0;
		},
	};
}

// Revision-keyed LRU. Size 4 covers active terrain + an undo step + a worker
// preview + slack. Insertion order is the LRU order (Map preserves it).
const INDEX_CACHE_LIMIT = 4;
const indexCache = new Map<string, VoxelTerrainIndex>();

/** Cached entry point for the main thread. */
export function getVoxelTerrainIndex(terrain: VoxelTerrain): VoxelTerrainIndex {
	const revision = createTerrainRevision(terrain);
	const cached = indexCache.get(revision);
	if (cached) {
		// Refresh LRU position.
		indexCache.delete(revision);
		indexCache.set(revision, cached);
		return cached;
	}
	const index = buildVoxelTerrainIndex(terrain);
	indexCache.set(revision, index);
	while (indexCache.size > INDEX_CACHE_LIMIT) {
		const oldest = indexCache.keys().next().value;
		if (oldest === undefined) break;
		indexCache.delete(oldest);
	}
	return index;
}
