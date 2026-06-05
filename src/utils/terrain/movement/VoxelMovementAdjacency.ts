// src/utils/terrain/movement/VoxelMovementAdjacency.ts
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
//   "isSurfaceTransitionReachable" (i.e. no voxel column blocks the climb /
//   descent between the two exact surface heights).
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

import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import {
	createTerrainRevision,
	getVoxelTerrainIndex,
	type VoxelTerrainIndex,
} from "../data/VoxelTerrainIndex";

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
	 * Each inner array is the (typically 0–2) reachable surface heights via
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

function tileHeightKey(x: number, y: number, h: number): string {
	return `${x},${y},${h}`;
}

/**
 * PASSAGE / clearance predicate: whether the tactical cell at rules-height `h`
 * over (x, y) is open enough to pass through -- clear unless the cell is *fully*
 * covered by solid voxels across the whole res*res footprint. This strictness is
 * deliberate: it is what stops actors tunnelling through a wall via a one-voxel
 * gap. It governs the non-flyer climb/step clearance below and the flyer's
 * open-air hover test, but it is NOT the standing authority -- a walkable surface
 * (`allSurfaces`) can exist in a cell this rejects (a low surface beside a taller
 * sub-column pillar), and such surfaces are standable. See `canStandVoxel` in
 * VoxelMovementUtilities for the single standing rule. "Not fully covered" rather
 * than "no solid voxel" is what lets actors rest or pass just above terrain whose
 * exact surface height is fractional -- the integer rules-height plane falls
 * inside the straddling surface voxel.
 */
export function isCellStandable(
	index: VoxelTerrainIndex,
	x: number,
	y: number,
	h: number
): boolean {
	if (h < 0) return false;
	const { resolution } = index;
	const startVoxelY = Math.max(0, Math.floor(h * resolution));
	const endVoxelY = Math.max(startVoxelY, Math.floor((h + 1) * resolution) - 1);
	for (let voxelY = startVoxelY; voxelY <= endVoxelY; voxelY++) {
		if (!index.isVoxelOccupiedAtTile(x, y, voxelY)) return true;
	}
	return false;
}

/**
 * Whether a non-flyer can step from surface (fromX, fromY, fromH) onto neighbor
 * surface (toX, toY, toH). Climbing, the actor rises through its own column;
 * stepping down, it descends through the destination column -- and every cell it
 * passes through must be standable, the SAME occupancy rule a flyer uses. Pure
 * function of terrain geometry, used only during the adjacency build; once the
 * graph exists, callers read precomputed neighbor heights via
 * getNeighborsByDirection() instead.
 */
function isSurfaceTransitionReachable(
	index: VoxelTerrainIndex,
	fromX: number,
	fromY: number,
	fromH: number,
	toX: number,
	toY: number,
	toH: number
): boolean {
	if (toH === fromH) return true;

	if (toH > fromH) {
		// Climb: rise through the from-column from just above fromH up to toH.
		for (let h = fromH + 1; h <= toH; h++) {
			if (!isCellStandable(index, fromX, fromY, h)) return false;
		}
		return true;
	}

	// Step down: descend through the to-column from just above toH up to fromH.
	for (let h = toH + 1; h <= fromH; h++) {
		if (!isCellStandable(index, toX, toY, h)) return false;
	}
	return true;
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
		const surfaces = index.allSurfaces.get(`${x},${y}`);
		if (!surfaces || !surfaces.includes(h)) return null;

		let buckets: VoxelMovementNeighbor[][] | null = null;

		for (let d = 0; d < VOXEL_MOVEMENT_DIRECTIONS.length; d++) {
			const { dx, dy } = VOXEL_MOVEMENT_DIRECTIONS[d];
			const nx = x + dx;
			const ny = y + dy;

			if (nx < 0 || nx >= index.width || ny < 0 || ny >= index.length) {
				continue;
			}

			const neighborSurfaces = index.allSurfaces.get(`${nx},${ny}`) ?? [];
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
