// src/domains/VoxelTerrain/VoxelMovementAdjacency.ts
//
// Per-terrain-revision adjacency graph for surface-to-surface movement.
//
// calculateVoxelMovementRange runs Dijkstra per actor selection, and originally
// rebuilt the reachability cache (exact surface heights + air clearances) on
// every call. The edge-reachability work is purely a function of terrain
// geometry though -- it does not depend on the actor, the start tile, the
// movement budget, or the movement settings -- so we cache surface-to-surface
// adjacency per VoxelTerrain revision in the same LRU style as
// VoxelTerrainIndex. Within a revision the per-tile edges are computed lazily
// (on first access) and memoized, so the cost tracks the tiles a Dijkstra
// frontier actually visits rather than the whole terrain -- see
// buildVoxelMovementAdjacency for why that matters.
//
// What's in the graph:
//   For each surface tile (x, y, h), the list of neighboring surface tiles
//   (nx, ny, nh) directly reachable in one cardinal step, where the edge is
//   "isSurfaceTransitionReachable": the body (see "Body rules" below) can climb
//   or drop in the right tile and fits through the crossing between the tiles.
//
// What's NOT in the graph:
//   - Flier-over-non-empty-tile shortcuts that let the actor preserve its
//     current altitude (current.h is dynamic, not a property of terrain).
//   - Flier-over-empty-tile crossings at current.h or floor 0 (same reason).
//   - Climb/step costs (depend on MovementSettings.heightCostLookup).
//   Those stay in calculateVoxelMovementRange.
//
// Cache strategy: keyed on createTerrainRevision, mirroring VoxelTerrainIndex.
// Both caches need to evict together logically -- if the index for a revision
// is gone, the adjacency for that revision is also useless -- but we keep them
// independent to avoid coupling the modules.

import { ACTOR_BODY_HEIGHT_TILES, type VoxelTerrain } from "./VoxelTerrain";
import {
	createTerrainRevision,
	getVoxelTerrainIndex,
	tileKey,
	tileHeightKey,
	type VoxelTerrainIndex,
} from "../../utils/terrain/data/VoxelTerrainIndex";

export interface VoxelMovementNeighbor {
	readonly x: number;
	readonly y: number;
	readonly h: number;
}

/**
 * Canonical direction list. Exported so Dijkstra and the adjacency build use
 * the exact same order — `getNeighborsByDirection(...)[d]` corresponds to
 * `VOXEL_MOVEMENT_DIRECTIONS[d]`.
 */
export const VOXEL_MOVEMENT_DIRECTIONS: readonly { dx: number; dy: number }[] =
	Object.freeze([
		{ dx: 1, dy: 0 },
		{ dx: -1, dy: 0 },
		{ dx: 0, dy: 1 },
		{ dx: 0, dy: -1 },
	]);

export interface VoxelMovementAdjacency {
	readonly revision: string;
	/**
	 * Walkable neighbors reachable in one cardinal step from (x, y, h),
	 * grouped by direction. Index d corresponds to VOXEL_MOVEMENT_DIRECTIONS[d];
	 * the returned outer array always has length VOXEL_MOVEMENT_DIRECTIONS.length.
	 * Each inner array is the (typically 0-2) reachable surface heights via
	 * that step. Returns the shared empty result when (x, y, h) is not a
	 * surface tile.
	 */
	getNeighborsByDirection(
		x: number,
		y: number,
		h: number
	): readonly (readonly VoxelMovementNeighbor[])[];
}

// Shared empty result for non-surface lookups. Single array of 4 frozen empty
// inner arrays so getNeighborsByDirection misses are allocation-free.
const EMPTY_DIRECTION_BUCKET: readonly VoxelMovementNeighbor[] = Object.freeze([]);
const EMPTY_NEIGHBORS_BY_DIRECTION: readonly (readonly VoxelMovementNeighbor[])[] =
	Object.freeze(
		VOXEL_MOVEMENT_DIRECTIONS.map(() => EMPTY_DIRECTION_BUCKET)
	);

// ---------------------------------------------------------------------------
// Body rules. Every actor is a 1 x 1 x ACTOR_BODY_HEIGHT_TILES box for grid
// movement (size is visual only):
//   - AIR (`isAirCellOpen`): a flyer can hover at rules-height h when at least
//     half of the tile's sub-columns are clear for a full body from h up.
//   - PASSAGE (`canPassBetweenTiles`): a step between two neighbouring tiles
//     needs an open lane at least half a tile wide, clear for a full body, along
//     the strip from one tile's centre to the other's. This is what makes walls
//     thinner than a tile (and one-voxel gaps in them) block movement, matching
//     first-person collision and line of sight. Voxels less than half a tile
//     above the body's base are steps, not obstacles.
// Walking footing (half a tile of floor with a full body of headroom) is
// computed by the terrain index itself (`allSurfaces`).
// ---------------------------------------------------------------------------

const passageCache = new WeakMap<VoxelTerrainIndex, Map<number, boolean>>();
const airCache = new WeakMap<VoxelTerrainIndex, Map<number, boolean>>();

function cacheFor(
	caches: WeakMap<VoxelTerrainIndex, Map<number, boolean>>,
	index: VoxelTerrainIndex
): Map<number, boolean> {
	let cache = caches.get(index);
	if (!cache) caches.set(index, (cache = new Map()));
	return cache;
}

/**
 * Exact height (tactical units) an actor's feet rest at in rules cell (x, y, h):
 * the highest footing at that rules height, or the cell floor `h` when the tile
 * has none there (a flyer in open air).
 */
function getCellBaseHeight(
	index: VoxelTerrainIndex,
	x: number,
	y: number,
	h: number
): number {
	let base = h;
	for (const exact of index.allSurfaceHeights.get(tileKey(x, y)) ?? []) {
		if (Math.floor(exact) === h && exact > base) base = exact;
	}
	return base;
}

/** Whether a flyer's body fits at rules-height h over (x, y) in open air. */
export function isAirCellOpen(
	index: VoxelTerrainIndex,
	x: number,
	y: number,
	h: number
): boolean {
	if (h < 0) return false;
	const key = x + index.width * (y + index.length * h);
	const cache = cacheFor(airCache, index);
	const cached = cache.get(key);
	if (cached !== undefined) return cached;

	const res = index.resolution;
	const open = isHalfTileClear(index, x, y, h * res, (h + ACTOR_BODY_HEIGHT_TILES) * res);
	cache.set(key, open);
	return open;
}

/** Whether at least half of tile (x, y)'s sub-columns have no solid voxel in [vy0, vy1). */
function isHalfTileClear(
	index: VoxelTerrainIndex,
	x: number,
	y: number,
	vy0: number,
	vy1: number
): boolean {
	const res = index.resolution;
	let clearColumns = 0;
	for (let vz = y * res; vz < (y + 1) * res; vz++) {
		for (let vx = x * res; vx < (x + 1) * res; vx++) {
			let clear = true;
			for (let vy = vy0; vy < vy1 && clear; vy++) {
				if (index.hasVoxel(vx, vy, vz)) clear = false;
			}
			if (clear) clearColumns++;
		}
	}
	return clearColumns * 2 >= res * res;
}

/**
 * Whether a body standing at `baseHeight` (exact tactical units) fits through
 * from tile (ax, ay) to its cardinal neighbour (bx, by). Symmetric in a and b.
 */
function canPassBetweenTiles(
	index: VoxelTerrainIndex,
	ax: number,
	ay: number,
	bx: number,
	by: number,
	baseHeight: number
): boolean {
	const res = index.resolution;
	const baseVoxel = Math.round(baseHeight * res);
	const alongX = ay === by;
	const lo = Math.min(alongX ? ax : ay, alongX ? bx : by);
	const across = alongX ? ay : ax;
	const span = Math.max(index.width, index.length);
	const key = ((lo + span * across) * 2 + (alongX ? 0 : 1)) * 4096 + baseVoxel;
	const cache = cacheFor(passageCache, index);
	const cached = cache.get(key);
	if (cached !== undefined) return cached;

	// The strip from the near tile's centre to the far tile's centre.
	const u0 = lo * res + Math.floor(res / 2);
	const u1 = (lo + 1) * res + Math.ceil(res / 2) - 1;
	const vy0 = baseVoxel + Math.floor(res / 2);
	const vy1 = baseVoxel + ACTOR_BODY_HEIGHT_TILES * res;
	const minLane = Math.ceil(res / 2);
	let lane = 0;
	let open = false;
	for (let w = across * res; w < (across + 1) * res && !open; w++) {
		let clear = true;
		for (let u = u0; u <= u1 && clear; u++) {
			for (let vy = vy0; vy < vy1 && clear; vy++) {
				if (alongX ? index.hasVoxel(u, vy, w) : index.hasVoxel(w, vy, u)) clear = false;
			}
		}
		lane = clear ? lane + 1 : 0;
		if (lane >= minLane) open = true;
	}
	cache.set(key, open);
	return open;
}

/**
 * Whether a body can step from rules cell (fromX, fromY, fromH) to the
 * neighbouring cell (toX, toY, toH). Climbing, the body rises in its own tile,
 * then moves across above both floors; stepping down, it moves across, then
 * drops in the destination tile. The rise or drop needs half the tile clear
 * from just above the lower floor (minus the step allowance) to a full body
 * above the higher one, which stops climbing up through a thin ceiling.
 * Walkers use it through the cached adjacency graph; flyers call it directly
 * for same-altitude steps.
 */
export function isSurfaceTransitionReachable(
	index: VoxelTerrainIndex,
	fromX: number,
	fromY: number,
	fromH: number,
	toX: number,
	toY: number,
	toH: number
): boolean {
	const fromBase = getCellBaseHeight(index, fromX, fromY, fromH);
	const toBase = getCellBaseHeight(index, toX, toY, toH);
	const top = Math.max(fromBase, toBase);
	if (fromBase !== toBase) {
		const [x, y, low] = toBase > fromBase ? [fromX, fromY, fromBase] : [toX, toY, toBase];
		const res = index.resolution;
		const vy0 = Math.round(low * res) + Math.floor(res / 2);
		const vy1 = Math.round(top * res) + ACTOR_BODY_HEIGHT_TILES * res;
		if (!isHalfTileClear(index, x, y, vy0, vy1)) return false;
	}
	return canPassBetweenTiles(index, fromX, fromY, toX, toY, top);
}

/**
 * Builds the surface adjacency graph for `terrain`. Skips the LRU cache; use
 * `getVoxelMovementAdjacency` for the normal entry point.
 *
 * Neighbor buckets are computed lazily on first `getNeighborsByDirection`
 * access and memoized for the lifetime of this revision's object. Computing a
 * tile's edges runs the expensive air-clearance scans, so deferring them means
 * we only pay for the surface tiles a Dijkstra frontier actually visits --
 * bounded by the actor's move budget -- instead of flooding the entire terrain
 * up front. (That eager whole-terrain build was what made the first FP entry on
 * a fresh terrain stutter for ~1s.) The memoization still amortizes across
 * repeated Dijkstra runs on the same revision: each visited tile is computed at
 * most once, so later actor selections reuse earlier tiles for free.
 */
export function buildVoxelMovementAdjacency(
	terrain: VoxelTerrain
): VoxelMovementAdjacency {
	const index = getVoxelTerrainIndex(terrain);

	// Per-(x,y,h) neighbor buckets, populated on demand. `null` records a tile
	// that was checked and has no walkable neighbors (or is not a surface),
	// distinguishing it from a not-yet-computed tile so we never recompute it.
	const memo = new Map<
		string,
		readonly (readonly VoxelMovementNeighbor[])[] | null
	>();

	const computeNeighbors = (
		x: number,
		y: number,
		h: number
	): readonly (readonly VoxelMovementNeighbor[])[] | null => {
		// Only actual surface tiles have outgoing edges. Dijkstra also probes
		// the (possibly non-surface) start node, which lands here as a miss.
		const surfaces = index.allSurfaces.get(tileKey(x, y));
		if (!surfaces || !surfaces.includes(h)) return null;

		let buckets: VoxelMovementNeighbor[][] | null = null;

		for (let d = 0; d < VOXEL_MOVEMENT_DIRECTIONS.length; d++) {
			const { dx, dy } = VOXEL_MOVEMENT_DIRECTIONS[d];
			const nx = x + dx;
			const ny = y + dy;

			if (nx < 0 || nx >= index.width || ny < 0 || ny >= index.length) {
				continue;
			}

			const neighborSurfaces = index.allSurfaces.get(tileKey(nx, ny)) ?? [];
			if (neighborSurfaces.length === 0) continue;

			for (const nh of neighborSurfaces) {
				if (!isSurfaceTransitionReachable(index, x, y, h, nx, ny, nh)) {
					continue;
				}

				if (!buckets) {
					buckets = VOXEL_MOVEMENT_DIRECTIONS.map(
						() => [] as VoxelMovementNeighbor[]
					);
				}
				buckets[d].push({ x: nx, y: ny, h: nh });
			}
		}

		return buckets;
	};

	return {
		revision: index.revision,
		getNeighborsByDirection(x, y, h) {
			const key = tileHeightKey(x, y, h);
			let cached = memo.get(key);
			if (cached === undefined) {
				cached = computeNeighbors(x, y, h);
				memo.set(key, cached);
			}
			return cached ?? EMPTY_NEIGHBORS_BY_DIRECTION;
		},
	};
}

// Revision-keyed LRU, sized to match the VoxelTerrainIndex cache so the two
// stay in lockstep on undo/redo and worker preview transitions.
const ADJACENCY_CACHE_LIMIT = 4;
const adjacencyCache = new Map<string, VoxelMovementAdjacency>();

/** Cached entry point. Builds on first request, then reuses per revision. */
export function getVoxelMovementAdjacency(
	terrain: VoxelTerrain
): VoxelMovementAdjacency {
	const revision = createTerrainRevision(terrain);
	const cached = adjacencyCache.get(revision);
	if (cached) {
		// Refresh LRU position.
		adjacencyCache.delete(revision);
		adjacencyCache.set(revision, cached);
		return cached;
	}
	const adjacency = buildVoxelMovementAdjacency(terrain);
	adjacencyCache.set(revision, adjacency);
	while (adjacencyCache.size > ADJACENCY_CACHE_LIMIT) {
		const oldest = adjacencyCache.keys().next().value;
		if (oldest === undefined) break;
		adjacencyCache.delete(oldest);
	}
	return adjacency;
}
