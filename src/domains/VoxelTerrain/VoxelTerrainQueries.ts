// High-level convenience helpers on top of VoxelTerrainIndex. The index module
// owns the runtime data (occupancy, surface heights, walkable surfaces); this
// file owns the small domain helpers callers across the app rely on.

import type { Position } from "../Actor/Actor";
import type { Campaign } from "../Campaign/Campaign";
import type { VoxelTerrain } from "./VoxelTerrain";
import { FLYING_SPAWN_ELEVATION } from "./voxelTerrainConstants";
import { getVoxelTerrainIndex } from "../../utils/terrain/data/VoxelTerrainIndex";

// Re-export coordinate primitives so existing imports keep working unchanged.
export {
	getVoxelSize,
	getVoxelTerrainResolution,
	voxelTopToRulesHeight,
	voxelTopToTacticalHeight,
} from "../../utils/terrain/data/VoxelTerrainIndex";

type TilePosition = { x: number; y: number; h: number };

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

function findSpawnSurface(terrain: VoxelTerrain): TilePosition | null {
	const index = getVoxelTerrainIndex(terrain);
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

				const surfaces = index.allSurfaces.get(`${x},${y}`) ?? [];
				if (surfaces.length > 0) {
					return { x, y, h: surfaces[0] };
				}
			}
		}
	}

	return null;
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
