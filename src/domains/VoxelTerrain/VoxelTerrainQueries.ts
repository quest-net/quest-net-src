// High-level convenience helpers on top of VoxelTerrainIndex. The index module
// owns the runtime data (occupancy, surface heights, walkable surfaces); this
// file owns the small domain helpers callers across the app rely on.

import type { Position } from "../Actor/Actor";
import type { Campaign } from "../Campaign/Campaign";
import { FLYING_SPAWN_ELEVATION, type VoxelTerrain } from "./VoxelTerrain";
import {
	getVoxelTerrainIndex,
	tileKey,
} from "../../utils/terrain/data/VoxelTerrainIndex";

// Re-export coordinate primitives so existing imports keep working unchanged.
export {
	getVoxelSize,
	getVoxelTerrainResolution,
	voxelTopToRulesHeight,
	voxelTopToTacticalHeight,
} from "../../utils/terrain/data/VoxelTerrainIndex";

type TilePosition = { x: number; y: number; h: number };

// ---------------------------------------------------------------------------
// Position normalization. Two deliberately different snapping policies live
// side by side so the distinction is impossible to miss:
//
//   - roundVoxelPosition         HARD round on x/y/h. Collapses a position to
//                                its integer tile cell. Used for tile-occupancy
//                                keys and authoritative pose comparison, where a
//                                fractional height must never read as a distinct
//                                cell.
//   - snapHeightToRules /        EPSILON-aware. Only snaps h to an integer when
//     normalizePositionForValidation  it is already within POSITION_HEIGHT_EPSILON
//                                of one; otherwise the fractional height is
//                                preserved. Used by validation so a flyer hovering
//                                at a genuine sub-tactical altitude keeps it.
// ---------------------------------------------------------------------------

const POSITION_HEIGHT_EPSILON = 1e-6;

/** HARD round of a position to its integer tile cell, preserving terrainId. */
export function roundVoxelPosition(position: Position): Position {
	return {
		terrainId: position.terrainId,
		x: Math.round(position.x),
		y: Math.round(position.y),
		h: Math.round(position.h),
	};
}

/** Snap h to the nearest integer only when within epsilon; else keep it as-is. */
export function snapHeightToRules(height: number): number {
	const rounded = Math.round(height);
	return Math.abs(height - rounded) <= POSITION_HEIGHT_EPSILON ? rounded : height;
}

/**
 * Validation-grade normalization: rounds the horizontal cell, epsilon-snaps the
 * height (so true fractional flight heights survive), and re-anchors terrainId
 * to `terrain`. Returns null if any coordinate is non-finite.
 */
export function normalizePositionForValidation(
	position: Position,
	terrain: VoxelTerrain
): Position | null {
	if (
		!Number.isFinite(position.x) ||
		!Number.isFinite(position.y) ||
		!Number.isFinite(position.h)
	) {
		return null;
	}

	return {
		terrainId: terrain.Id,
		x: Math.round(position.x),
		y: Math.round(position.y),
		h: snapHeightToRules(position.h),
	};
}

export function getVoxelTerrainById(
	campaign: Campaign,
	terrainId: string | undefined
): VoxelTerrain | null {
	if (!terrainId) return null;
	return (
		campaign.VoxelTerrains.find((terrain) => terrain.Id === terrainId) ?? null
	);
}

export function getMaxVoxelSurfaceHeight(terrain: VoxelTerrain): number {
	return getVoxelTerrainIndex(terrain).maxSurfaceHeight;
}

function getCenterTile(terrain: VoxelTerrain): { x: number; y: number } {
	return {
		x: Math.max(0, Math.min(terrain.Width - 1, Math.floor(terrain.Width / 2))),
		y: Math.max(0, Math.min(terrain.Length - 1, Math.floor(terrain.Length / 2))),
	};
}

/**
 * Spiral out from the terrain's center tile, returning the first tile for which
 * `findAtTile` yields a non-null value. Shared by spawn-surface search and
 * actor-displacement search so both walk tiles in the same center-out order.
 */
export function findTileFromCenter<T>(
	terrain: VoxelTerrain,
	findAtTile: (x: number, y: number) => T | null
): T | null {
	const center = getCenterTile(terrain);
	const maxRadius = Math.max(terrain.Width, terrain.Length);

	for (let radius = 0; radius <= maxRadius; radius++) {
		for (let y = center.y - radius; y <= center.y + radius; y++) {
			for (let x = center.x - radius; x <= center.x + radius; x++) {
				if (Math.max(Math.abs(x - center.x), Math.abs(y - center.y)) !== radius) {
					continue;
				}
				if (x < 0 || y < 0 || x >= terrain.Width || y >= terrain.Length) {
					continue;
				}

				const result = findAtTile(x, y);
				if (result !== null) return result;
			}
		}
	}

	return null;
}

function findSpawnSurface(terrain: VoxelTerrain): TilePosition | null {
	const index = getVoxelTerrainIndex(terrain);
	return findTileFromCenter(terrain, (x, y) => {
		const surfaces = index.allSurfaces.get(tileKey(x, y)) ?? [];
		return surfaces.length > 0 ? { x, y, h: surfaces[0] } : null;
	});
}

function getFallbackSpawnPosition(terrain: VoxelTerrain): TilePosition {
	const center = getCenterTile(terrain);
	return { x: center.x, y: center.y, h: 0 };
}

export function getDefaultVoxelSpawnPosition(
	terrain: VoxelTerrain,
	canFly = false
): Position {
	if (canFly) {
		return getFlyingVoxelSpawnPosition(terrain);
	}

	const surface = findSpawnSurface(terrain) ?? getFallbackSpawnPosition(terrain);
	return { terrainId: terrain.Id, ...surface };
}

export function getFlyingVoxelSpawnPosition(terrain: VoxelTerrain): Position {
	const surface = findSpawnSurface(terrain) ?? getFallbackSpawnPosition(terrain);
	const maxHeight = Math.max(surface.h, terrain.Height);

	return {
		terrainId: terrain.Id,
		x: surface.x,
		y: surface.y,
		h: Math.min(surface.h + FLYING_SPAWN_ELEVATION, maxHeight),
	};
}

export function getVoxelSpawnPosition(
	campaign: Campaign,
	terrainId: string,
	canFly = false
): Position | null {
	const terrain = getVoxelTerrainById(campaign, terrainId);
	return terrain ? getDefaultVoxelSpawnPosition(terrain, canFly) : null;
}
