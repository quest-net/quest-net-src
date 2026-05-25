// src/utils/terrain/movement/VoxelMovementAdjacency.ts
//
// Per-terrain-revision adjacency graph for surface-to-surface movement.
//
// calculateVoxelMovementRange runs Dijkstra per actor selection, and previously
// rebuilt the reachability cache (exact surface heights + air clearances) on
// every call. The edge-reachability work is purely a function of terrain
// geometry though -- it does not depend on the actor, the start tile, the
// movement budget, or the movement settings -- so we precompute the full
// surface-to-surface adjacency once per VoxelTerrain revision and cache it in
// the same LRU style as VoxelTerrainIndex.
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

const HEIGHT_EPSILON = 1e-6;

// Shared empty result for non-surface lookups. Single array of 4 frozen empty
// inner arrays so getNeighborsByDirection misses are allocation-free.
const EMPTY_DIRECTION_BUCKET: readonly VoxelMovementNeighbor[] = Object.freeze([]);
const EMPTY_NEIGHBORS_BY_DIRECTION: readonly (readonly VoxelMovementNeighbor[])[] =
	Object.freeze(
		VOXEL_MOVEMENT_DIRECTIONS.map(() => EMPTY_DIRECTION_BUCKET)
	);

interface AdjacencyBuildCache {
	exactSurfaceHeights: Map<string, number | null>;
	airClearances: Map<string, boolean>;
}

function tileHeightKey(x: number, y: number, h: number): string {
	return `${x},${y},${h}`;
}

/**
 * Looks up the exact (sub-tactical) surface height for a rules-height integer
 * at (tileX, tileY). Memoized via `cache.exactSurfaceHeights` during a single
 * adjacency build.
 */
function getExactSurfaceHeightForRulesHeight(
	index: VoxelTerrainIndex,
	tileX: number,
	tileY: number,
	rulesH: number,
	cache: AdjacencyBuildCache
): number | null {
	const key = `${tileX},${tileY},${rulesH}`;
	if (cache.exactSurfaceHeights.has(key)) {
		return cache.exactSurfaceHeights.get(key) ?? null;
	}

	const exactSurfaces = index.allSurfaceHeights.get(`${tileX},${tileY}`) ?? [];
	let match: number | null = null;

	for (const surfaceH of exactSurfaces) {
		if (
			Math.abs(surfaceH - rulesH) <= HEIGHT_EPSILON ||
			Math.floor(surfaceH) === rulesH
		) {
			match = surfaceH;
		}
	}

	cache.exactSurfaceHeights.set(key, match);
	return match;
}

/**
 * True when the voxel column at (tileX, tileY) is clear of solid voxels in
 * the open interval (lowerExactH, upperExactH).
 */
function isTileAirClearBetweenHeights(
	index: VoxelTerrainIndex,
	tileX: number,
	tileY: number,
	lowerExactH: number,
	upperExactH: number,
	cache: AdjacencyBuildCache
): boolean {
	if (upperExactH <= lowerExactH + HEIGHT_EPSILON) return true;
	const key = `${tileX},${tileY},${lowerExactH},${upperExactH}`;
	const cached = cache.airClearances.get(key);
	if (cached !== undefined) return cached;

	const startVoxelY = Math.max(
		0,
		Math.ceil(lowerExactH * index.resolution - HEIGHT_EPSILON)
	);
	const endVoxelY = Math.min(
		index.voxelHeight - 1,
		Math.ceil(upperExactH * index.resolution - HEIGHT_EPSILON) - 1
	);

	for (let voxelY = startVoxelY; voxelY <= endVoxelY; voxelY++) {
		if (index.isVoxelOccupiedAtTile(tileX, tileY, voxelY)) {
			cache.airClearances.set(key, false);
			return false;
		}
	}

	cache.airClearances.set(key, true);
	return true;
}

/**
 * Whether an actor can step from (fromX, fromY, fromH) onto neighbor surface
 * (toX, toY, toH). Pure function of terrain geometry. Used only during the
 * adjacency build; once the graph exists, callers read precomputed neighbor
 * heights via getNeighborsByDirection() instead.
 */
function isSurfaceTransitionReachable(
	index: VoxelTerrainIndex,
	fromX: number,
	fromY: number,
	fromH: number,
	toX: number,
	toY: number,
	toH: number,
	cache: AdjacencyBuildCache
): boolean {
	if (toH === fromH) return true;

	const fromExactH = getExactSurfaceHeightForRulesHeight(
		index,
		fromX,
		fromY,
		fromH,
		cache
	);
	const toExactH = getExactSurfaceHeightForRulesHeight(
		index,
		toX,
		toY,
		toH,
		cache
	);
	if (fromExactH === null || toExactH === null) return false;

	if (toExactH > fromExactH) {
		return isTileAirClearBetweenHeights(
			index,
			fromX,
			fromY,
			fromExactH,
			toExactH,
			cache
		);
	}

	return isTileAirClearBetweenHeights(
		index,
		toX,
		toY,
		toExactH,
		fromExactH,
		cache
	);
}

/**
 * Builds the surface adjacency graph for `terrain`. Skips the LRU cache; use
 * `getVoxelMovementAdjacency` for the normal entry point.
 */
export function buildVoxelMovementAdjacency(
	terrain: VoxelTerrain
): VoxelMovementAdjacency {
	const index = getVoxelTerrainIndex(terrain);
	const buildCache: AdjacencyBuildCache = {
		exactSurfaceHeights: new Map(),
		airClearances: new Map(),
	};

	// Map<tileHeightKey, perDirectionBuckets>. The outer entry is only
	// allocated when at least one walkable neighbor exists for that surface
	// tile, so isolated surfaces stay out of memory entirely.
	const neighborsByTile = new Map<string, VoxelMovementNeighbor[][]>();

	for (const [columnKey, surfaceHeights] of index.allSurfaces) {
		const commaIndex = columnKey.indexOf(",");
		const x = Number(columnKey.slice(0, commaIndex));
		const y = Number(columnKey.slice(commaIndex + 1));

		for (const h of surfaceHeights) {
			const fromKey = tileHeightKey(x, y, h);
			let buckets: VoxelMovementNeighbor[][] | undefined;

			for (let d = 0; d < VOXEL_MOVEMENT_DIRECTIONS.length; d++) {
				const { dx, dy } = VOXEL_MOVEMENT_DIRECTIONS[d];
				const nx = x + dx;
				const ny = y + dy;

				if (
					nx < 0 ||
					nx >= index.width ||
					ny < 0 ||
					ny >= index.length
				) {
					continue;
				}

				const neighborSurfaces =
					index.allSurfaces.get(`${nx},${ny}`) ?? [];
				if (neighborSurfaces.length === 0) continue;

				for (const nh of neighborSurfaces) {
					if (
						!isSurfaceTransitionReachable(
							index,
							x,
							y,
							h,
							nx,
							ny,
							nh,
							buildCache
						)
					) {
						continue;
					}

					if (!buckets) {
						buckets = VOXEL_MOVEMENT_DIRECTIONS.map(
							() => [] as VoxelMovementNeighbor[]
						);
						neighborsByTile.set(fromKey, buckets);
					}
					buckets[d].push({ x: nx, y: ny, h: nh });
				}
			}
		}
	}

	return {
		revision: index.revision,
		getNeighborsByDirection(x, y, h) {
			return (
				neighborsByTile.get(tileHeightKey(x, y, h)) ??
				EMPTY_NEIGHBORS_BY_DIRECTION
			);
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
