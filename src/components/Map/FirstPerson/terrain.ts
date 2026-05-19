import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { acceleratedRaycast } from "three-mesh-bvh";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { getVoxelCount } from "../../../utils/VoxelDataUtils";
import { getMaxVoxelSurfaceHeight } from "../../../utils/VoxelTerrainUtils";
import type { ThreeDSceneResources } from "../Actors3D/actorTokenTypes";
import {
	createTerrainSignature,
	useVoxelTerrainGeometryWorker,
} from "../hooks/useVoxelTerrainGeometryWorker";
import { getShadowCameraBounds } from "../shadowCameraBounds";
import {
	THREE_D_MAP_LIGHTING,
	THREE_D_TERRAIN_MATERIAL,
} from "../threeDMapConstants";

interface TerrainRenderResources {
	mesh: THREE.Mesh;
	material: THREE.MeshStandardMaterial;
}

function disposeTerrainResources(resources: TerrainRenderResources): void {
	resources.material.dispose();
}

export { createTerrainSignature };

export function createEmptyMovementHighlight(): ThreeDSceneResources["movementHighlight"] {
	const data = new Uint8Array(4);
	const texture = new THREE.Data3DTexture(data, 1, 1, 1);
	texture.format = THREE.RGBAFormat;
	texture.type = THREE.UnsignedByteType;
	texture.needsUpdate = true;
	return {
		texture,
		data,
		width: 1,
		heightLevels: 1,
		length: 1,
	};
}

export function useFirstPersonTerrain(
	resources: ThreeDSceneResources | null,
	terrain: VoxelTerrain | null | undefined,
	terrainSignature: string,
	directionalLightRef: RefObject<THREE.DirectionalLight | null>
): void {
	const terrainResourcesRef = useRef<TerrainRenderResources | null>(null);
	const resourcesRef = useRef<ThreeDSceneResources | null>(null);
	const terrainGeometry = useVoxelTerrainGeometryWorker(
		terrain,
		terrainSignature,
		resources !== null
	);

	useEffect(() => {
		resourcesRef.current = resources;
	}, [resources]);

	useEffect(
		() => () => {
			const activeResources = resourcesRef.current;
			const terrainResources = terrainResourcesRef.current;
			if (!activeResources || !terrainResources) return;

			activeResources.scene.remove(terrainResources.mesh);
			disposeTerrainResources(terrainResources);
			terrainResourcesRef.current = null;
			activeResources.occlusionTargets.length = 0;
		},
		[]
	);

	useEffect(() => {
		const dirLight = directionalLightRef.current;
		if (!resources || !dirLight) return;
		if (!terrain || getVoxelCount(terrain.Voxels) === 0) return;

		const maxSurfaceHeight = getMaxVoxelSurfaceHeight(terrain);
		const terrainCenterY = (maxSurfaceHeight - 1) / 2;
		const terrainMaxExtent = Math.max(
			terrain.Width,
			terrain.Length,
			maxSurfaceHeight
		);
		dirLight.position.set(
			terrainMaxExtent * THREE_D_MAP_LIGHTING.DIRECTIONAL_POSITION_X_SCALE,
			terrainMaxExtent * THREE_D_MAP_LIGHTING.DIRECTIONAL_POSITION_Y_SCALE +
				maxSurfaceHeight,
			terrainMaxExtent * THREE_D_MAP_LIGHTING.DIRECTIONAL_POSITION_Z_SCALE
		);
		dirLight.target.position.set(0, terrainCenterY, 0);
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
		// `terrain` intentionally omitted from deps: terrainSignature is the
		// value-equal identity for terrain geometry and lighting.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [resources, terrainSignature, directionalLightRef]);

	useEffect(() => {
		if (!resources) return;

		if (!terrainGeometry) {
			const old = terrainResourcesRef.current;
			if (!old) return;

			resources.scene.remove(old.mesh);
			disposeTerrainResources(old);
			terrainResourcesRef.current = null;
			resources.occlusionTargets.length = 0;
			return;
		}

		const material = new THREE.MeshStandardMaterial({
			roughness: THREE_D_TERRAIN_MATERIAL.ROUGHNESS,
			metalness: THREE_D_TERRAIN_MATERIAL.METALNESS,
			vertexColors: true,
		});
		const mesh = new THREE.Mesh(terrainGeometry.geometry, material);
		mesh.raycast = acceleratedRaycast;
		mesh.castShadow = true;
		mesh.receiveShadow = true;

		const old = terrainResourcesRef.current;
		if (old) {
			resources.scene.remove(old.mesh);
			disposeTerrainResources(old);
		}

		resources.scene.add(mesh);
		resources.occlusionTargets.length = 0;
		resources.occlusionTargets.push(mesh);
		terrainResourcesRef.current = {
			mesh,
			material,
		};
	}, [resources, terrainGeometry]);
}
