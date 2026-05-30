import { type RefObject } from "react";
import * as THREE from "three";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import type { ThreeDSceneResources } from "../Actors3D/actorTokenTypes";
import {
	createTerrainSignature,
	useVoxelTerrainGeometryWorker,
} from "../Terrain/hooks/useVoxelTerrainGeometryWorker";
import { useTerrainMeshes } from "../Terrain/hooks/useTerrainMeshes";
import { useTerrainEnvironment } from "../Terrain/hooks/useTerrainEnvironment";

export { createTerrainSignature };

export function useFirstPersonTerrain(
	resources: ThreeDSceneResources | null,
	terrain: VoxelTerrain | null | undefined,
	terrainSignature: string,
	directionalLightRef: RefObject<THREE.DirectionalLight | null>,
	performanceMode = false
): void {
	const terrainGeometry = useVoxelTerrainGeometryWorker(
		terrain,
		terrainSignature,
		resources !== null
	);

	// Terrain meshes, AO, and fog volume -- shared with the world view. FP never
	// paints movement range, so movementHighlight is disabled.
	useTerrainMeshes(resources, terrainGeometry, {
		movementHighlight: false,
		performanceMode,
	});

	// Background + directional-light/shadow-bounds -- shared with the world view.
	useTerrainEnvironment(resources, terrain, terrainSignature, directionalLightRef);
}
