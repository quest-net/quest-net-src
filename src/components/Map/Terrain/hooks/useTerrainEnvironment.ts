import { useEffect, type RefObject } from "react";
import * as THREE from "three";
import type { VoxelTerrain } from "../../../../domains/VoxelTerrain/VoxelTerrain";
import { getVoxelCount } from "../../../../utils/terrain/data/VoxelDataUtils";
import { resolveTerrainVoxels } from "../../../../utils/terrain/data/terrainPayloadStore";
import { getMaxVoxelSurfaceHeight } from "../../../../utils/terrain/data/VoxelTerrainQueries";
import type { ThreeDSceneResources } from "../../Actors3D/actorTokenTypes";
import { getShadowCameraBounds } from "../../shadowCameraBounds";
import { THREE_D_MAP_DOF } from "../../threeDMapConstants";
import {
	applyVoxelTerrainBackground,
	applyVoxelTerrainDirectionalLight,
} from "../../terrainEnvironment";

// ---------------------------------------------------------------------------
// Terrain-environment hook for the map scene (MapScene's shared terrain).
//
// Runs two effects:
//   - background: applies the terrain's background color/skybox to the scene.
//   - directional light + shadow camera bounds: sizes the sun light and its
//     shadow frustum to the terrain extents.
//
// Camera framing lives in MapScene; only the light/shadow/background work lives
// here. Both effects are null-guarded so an as-yet unbuilt scene
// (resources === null) is a no-op.
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
		if (!terrain || getVoxelCount(resolveTerrainVoxels(terrain)) === 0) return;

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

		// Aim the depth-of-field distance blur: keep the terrain center in focus
		// with a sharp band covering the whole playable footprint, so only the
		// far surroundings (and anything else in the distance) blur.
		resources.setDepthOfFieldFocus?.(
			new THREE.Vector3(0, terrainCenterY, 0),
			Math.max(
				THREE_D_MAP_DOF.MIN_FOCUS_RANGE,
				Math.max(terrain.Width, terrain.Length, maxSurfaceHeight) *
					THREE_D_MAP_DOF.FOCUS_RANGE_MULTIPLIER
			)
		);
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
