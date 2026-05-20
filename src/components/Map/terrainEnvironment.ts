import * as THREE from "three";
import type { VoxelTerrain } from "../../domains/VoxelTerrain/VoxelTerrain";

const LIGHT_DISTANCE_SCALE = 1.65;

export function applyVoxelTerrainBackground(
	scene: THREE.Scene,
	terrain: VoxelTerrain | null | undefined
): void {
	scene.background = terrain?.Background.Color
		? new THREE.Color(terrain.Background.Color)
		: null;
}

export function applyVoxelTerrainDirectionalLight(
	dirLight: THREE.DirectionalLight,
	terrain: VoxelTerrain,
	maxSurfaceHeight: number,
	terrainCenterY: number
): void {
	const lighting = terrain.Lighting;
	const rotation = THREE.MathUtils.degToRad(lighting.Rotation);
	const elevation = THREE.MathUtils.degToRad(
		THREE.MathUtils.clamp(lighting.Elevation, 0, 90)
	);
	const terrainMaxExtent = Math.max(
		terrain.Width,
		terrain.Length,
		maxSurfaceHeight
	);
	const distance = Math.max(terrainMaxExtent * LIGHT_DISTANCE_SCALE, 8);
	const horizontalDistance = Math.cos(elevation) * distance;

	dirLight.color.set(lighting.Color);
	dirLight.intensity = Math.PI * Math.max(0, lighting.Intensity);
	dirLight.position.set(
		Math.sin(rotation) * horizontalDistance,
		terrainCenterY + Math.sin(elevation) * distance,
		Math.cos(rotation) * horizontalDistance
	);
	dirLight.target.position.set(0, terrainCenterY, 0);
}
