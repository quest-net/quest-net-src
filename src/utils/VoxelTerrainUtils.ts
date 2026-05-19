// High-level convenience helpers on top of VoxelTerrainIndex. The index module
// owns the runtime data (occupancy, surface heights, walkable surfaces); this
// file owns the small domain helpers callers across the app rely on.

import type { Position } from "../domains/Actor/Actor";
import type { Campaign } from "../domains/Campaign/Campaign";
import type { VoxelTerrain } from "../domains/VoxelTerrain/VoxelTerrain";
import { FLYING_SPAWN_ELEVATION } from "../domains/VoxelTerrain/voxelTerrainConstants";
import { getVoxelTerrainIndex } from "./VoxelTerrainIndex";

// Re-export coordinate primitives so existing imports keep working unchanged.
export {
	getVoxelSize,
	getVoxelTerrainResolution,
	voxelTopToRulesHeight,
	voxelTopToTacticalHeight,
} from "./VoxelTerrainIndex";

export function getActiveVoxelTerrain(campaign: Campaign): VoxelTerrain | null {
	return (
		campaign.VoxelTerrains.find(
			(terrain) => terrain.Id === campaign.GameState.VoxelTerrainId
		) ?? null
	);
}

export function getMaxVoxelSurfaceHeight(terrain: VoxelTerrain): number {
	return getVoxelTerrainIndex(terrain).maxSurfaceHeight;
}

export function getVoxelSurfaceHeight(
	terrain: VoxelTerrain,
	x: number,
	z: number
): number {
	return getVoxelTerrainIndex(terrain).columnSurfaceHeight(x, z);
}

export function getVoxelRulesSurfaceHeight(
	terrain: VoxelTerrain,
	x: number,
	z: number
): number {
	return Math.floor(getVoxelSurfaceHeight(terrain, x, z));
}

export function getDefaultVoxelSpawnPosition(
	terrain: VoxelTerrain,
	canFly = false
): Position {
	if (canFly) {
		return getFlyingVoxelSpawnPosition(terrain);
	}

	const x = Math.floor(terrain.Width / 2);
	const y = Math.floor(terrain.Length / 2);
	return { x, y, h: getVoxelRulesSurfaceHeight(terrain, x, y) };
}

export function getFlyingVoxelSpawnPosition(terrain: VoxelTerrain): Position {
	const x = Math.floor(terrain.Width / 2);
	const y = Math.floor(terrain.Length / 2);
	const surfaceHeight = getVoxelRulesSurfaceHeight(terrain, x, y);
	const maxHeight = Math.max(surfaceHeight, terrain.Height);

	return {
		x,
		y,
		h: Math.min(surfaceHeight + FLYING_SPAWN_ELEVATION, maxHeight),
	};
}

export function getActiveVoxelSpawnPosition(
	campaign: Campaign,
	canFly = false
): Position | null {
	const terrain = getActiveVoxelTerrain(campaign);
	return terrain ? getDefaultVoxelSpawnPosition(terrain, canFly) : null;
}
