import type { Position } from "../domains/Actor/Actor";
import type { Campaign } from "../domains/Campaign/Campaign";
import type { VoxelTerrain } from "../domains/VoxelTerrain/VoxelTerrain";
import {
	DEFAULT_TERRAIN_RESOLUTION,
	FLYING_SPAWN_ELEVATION,
} from "../domains/VoxelTerrain/voxelTerrainConstants";
import { decodeVoxels } from "./VoxelDataUtils";

export interface VoxelTerrainSurfaceData {
	width: number;
	length: number;
	height: number;
	resolution: number;
	voxelWidth: number;
	voxelLength: number;
	voxels: string;
	surfaceHeights: Float32Array;
	maxSurfaceHeight: number;
	firstVoxel?: {
		x: number;
		y: number;
		z: number;
		color: number;
	};
}

interface VoxelTerrainSurfaceCacheEntry {
	width: number;
	length: number;
	height: number;
	resolution: number;
	voxels: string;
	data: VoxelTerrainSurfaceData;
}

const surfaceDataCache = new WeakMap<VoxelTerrain, VoxelTerrainSurfaceCacheEntry>();

export function getActiveVoxelTerrain(campaign: Campaign): VoxelTerrain | null {
	return (
		campaign.VoxelTerrains.find(
			(terrain) => terrain.Id === campaign.GameState.VoxelTerrainId
		) ?? null
	);
}

export function getVoxelTerrainResolution(terrain: VoxelTerrain): number {
	return Math.max(DEFAULT_TERRAIN_RESOLUTION, terrain.Resolution ?? DEFAULT_TERRAIN_RESOLUTION);
}

export function getVoxelSize(terrain: VoxelTerrain): number {
	return 1 / getVoxelTerrainResolution(terrain);
}

export function getVoxelTerrainSurfaceData(terrain: VoxelTerrain): VoxelTerrainSurfaceData {
	const resolution = getVoxelTerrainResolution(terrain);
	const cached = surfaceDataCache.get(terrain);
	if (
		cached &&
		cached.width === terrain.Width &&
		cached.length === terrain.Length &&
		cached.height === terrain.Height &&
		cached.resolution === resolution &&
		cached.voxels === terrain.Voxels
	) {
		return cached.data;
	}

	const voxelWidth = terrain.Width * resolution;
	const voxelLength = terrain.Length * resolution;
	const maxVoxelYs = new Int16Array(voxelWidth * voxelLength);
	maxVoxelYs.fill(-1);

	let maxVoxelY = -1;
	let firstVoxel: VoxelTerrainSurfaceData["firstVoxel"];
	for (const voxel of decodeVoxels(terrain.Voxels)) {
		firstVoxel ??= voxel;
		if (
			voxel.x < 0 ||
			voxel.z < 0 ||
			voxel.x >= voxelWidth ||
			voxel.z >= voxelLength
		) {
			continue;
		}

		const index = voxel.z * voxelWidth + voxel.x;
		if (voxel.y > maxVoxelYs[index]) {
			maxVoxelYs[index] = voxel.y;
		}
		if (voxel.y > maxVoxelY) {
			maxVoxelY = voxel.y;
		}
	}

	const surfaceHeights = new Float32Array(maxVoxelYs.length);
	for (let i = 0; i < maxVoxelYs.length; i++) {
		surfaceHeights[i] = (maxVoxelYs[i] + 1) / resolution;
	}

	const data: VoxelTerrainSurfaceData = {
		width: terrain.Width,
		length: terrain.Length,
		height: terrain.Height,
		resolution,
		voxelWidth,
		voxelLength,
		voxels: terrain.Voxels,
		surfaceHeights,
		maxSurfaceHeight: (maxVoxelY + 1) / resolution,
		firstVoxel,
	};
	surfaceDataCache.set(terrain, {
		width: terrain.Width,
		length: terrain.Length,
		height: terrain.Height,
		resolution,
		voxels: terrain.Voxels,
		data,
	});
	return data;
}

export function tacticalCoordinateToVoxelIndex(
	terrain: VoxelTerrain,
	coordinate: number,
	maxTacticalCoordinate: number
): number {
	const resolution = getVoxelTerrainResolution(terrain);
	const maxVoxelIndex = maxTacticalCoordinate * resolution - 1;
	return Math.max(
		0,
		Math.min(maxVoxelIndex, Math.floor((coordinate + 0.5) * resolution))
	);
}

export function voxelIndexToTacticalCoordinate(
	terrain: VoxelTerrain,
	voxelIndex: number
): number {
	return (voxelIndex + 0.5) / getVoxelTerrainResolution(terrain) - 0.5;
}

function tacticalCoordinateToCachedVoxelIndex(
	surfaceData: VoxelTerrainSurfaceData,
	coordinate: number,
	maxTacticalCoordinate: number
): number {
	const maxVoxelIndex = maxTacticalCoordinate * surfaceData.resolution - 1;
	return Math.max(
		0,
		Math.min(maxVoxelIndex, Math.floor((coordinate + 0.5) * surfaceData.resolution))
	);
}

export function getMaxVoxelSurfaceHeight(terrain: VoxelTerrain): number {
	return getVoxelTerrainSurfaceData(terrain).maxSurfaceHeight;
}

export function getVoxelSurfaceHeight(terrain: VoxelTerrain, x: number, z: number): number {
	return getVoxelSurfaceHeightFromData(
		getVoxelTerrainSurfaceData(terrain),
		x,
		z
	);
}

export function getVoxelSurfaceHeightFromData(
	surfaceData: VoxelTerrainSurfaceData,
	x: number,
	z: number
): number {
	const voxelX = tacticalCoordinateToCachedVoxelIndex(surfaceData, x, surfaceData.width);
	const voxelZ = tacticalCoordinateToCachedVoxelIndex(surfaceData, z, surfaceData.length);
	const index = voxelZ * surfaceData.voxelWidth + voxelX;
	return surfaceData.surfaceHeights[index] ?? 0;
}

export function getVoxelRulesSurfaceHeight(terrain: VoxelTerrain, x: number, z: number): number {
	return Math.floor(getVoxelSurfaceHeight(terrain, x, z));
}

export function getVoxelRulesSurfaceHeightFromData(
	surfaceData: VoxelTerrainSurfaceData,
	x: number,
	z: number
): number {
	return Math.floor(getVoxelSurfaceHeightFromData(surfaceData, x, z));
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
