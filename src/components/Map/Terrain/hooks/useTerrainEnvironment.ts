import { useEffect, type RefObject } from "react";
import * as THREE from "three";
import type { VoxelTerrain } from "../../../../domains/VoxelTerrain/VoxelTerrain";
import { getVoxelCount } from "../../../../utils/terrain/data/VoxelDataUtils";
import { getMaxVoxelSurfaceHeight } from "../../../../utils/terrain/data/VoxelTerrainUtils";
import type { ThreeDSceneResources } from "../../Actors3D/actorTokenTypes";
import { getShadowCameraBounds } from "../../shadowCameraBounds";
import {
	applyVoxelTerrainBackground,
	applyVoxelTerrainDirectionalLight,
} from "../../terrainEnvironment";

// ---------------------------------------------------------------------------
// Shared terrain-environment hook for both map views.
//
// The world view (3DMap) and the first-person view used to keep identical
// copies of two effects:
//   - background: applies the terrain's background color/skybox to the scene.
//   - directional light + shadow camera bounds: sizes the sun light and its
//     shadow frustum to the terrain extents.
//
// (The world view's copy of the light/shadow code was tangled together with
// camera framing; that framing stays in 3DMap.tsx -- only the shared
// light/shadow work moved here.) Both effects are null-guarded so an as-yet
// unbuilt scene (resources === null) is a no-op.
// ---------------------------------------------------------------------------

export function useTerrainEnvironment(
	resources: ThreeDSceneResources | null,
	terrain: VoxelTerrain | null | undefined,
	terrainSignature: string,
	directionalLightRef: RefObject<THREE.DirectionalLight | null>
): void {
	const terrainLighting = terrain?.Lighting;
	const terrainBackgroundColor = terrain?.Background.Color;

	// background
	useEffect(() => {
		if (!resources) return;
		applyVoxelTerrainBackground(resources.scene, terrain);
	}, [resources, terrain, terrainBackgroundColor]);

	// directional light + shadow camera bounds
	useEffect(() => {
		const dirLight = directionalLightRef.current;
		if (!resources || !dirLight) return;
		if (!terrain || getVoxelCount(terrain.Voxels) === 0) return;

		const maxSurfaceHeight = getMaxVoxelSurfaceHeight(terrain);
		const terrainCenterY = (maxSurfaceHeight - 1) / 2;
		applyVoxelTerrainDirectionalLight(
			dirLight,
			terrain,
			maxSurfaceHeight,
			terrainCenterY
		);
		const shadowCamera = getShadowCameraBounds(
			terrain.Width,
			terrain.Length,
			maxSurfaceHeight
		);
		dirLight.shadow.camera.left = shadowCamera.left;
		dirLight.shadow.camera.right = shadowCamera.right;
		dirLight.shadow.camera.top = shadowCamera.top;
		dirLight.shadow.camera.bottom = shadowCamera.bottom;
		dirLight.shadow.camera.near = shadowCamera.near;
		dirLight.shadow.camera.far = shadowCamera.far;
		dirLight.shadow.camera.updateProjectionMatrix();
		resources.requestShadowUpdate();
	}, [
		resources,
		terrain,
		terrainSignature,
		directionalLightRef,
		terrainLighting?.Color,
		terrainLighting?.Intensity,
		terrainLighting?.Rotation,
		terrainLighting?.Elevation,
	]);
}
