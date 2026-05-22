import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { getVoxelCount } from "../../../utils/terrain/data/VoxelDataUtils";
import { getMaxVoxelSurfaceHeight } from "../../../utils/terrain/data/VoxelTerrainUtils";
import type { ThreeDSceneResources } from "../Actors3D/actorTokenTypes";
import { installSpecialMaterialShader } from "../Materials/installSpecialMaterials";
import {
	createTerrainSignature,
	useVoxelTerrainGeometryWorker,
} from "../Terrain/hooks/useVoxelTerrainGeometryWorker";
import { getShadowCameraBounds } from "../shadowCameraBounds";
import { THREE_D_TERRAIN_MATERIAL } from "../threeDMapConstants";
import {
	applyVoxelTerrainBackground,
	applyVoxelTerrainDirectionalLight,
} from "../terrainEnvironment";

interface TerrainRenderResources {
	mesh: THREE.Mesh;
	geometry: THREE.BufferGeometry;
	material: THREE.MeshStandardMaterial;
}

function disposeTerrainResources(resources: TerrainRenderResources): void {
	resources.geometry.dispose();
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
	const terrainLighting = terrain?.Lighting;
	const terrainBackgroundColor = terrain?.Background.Color;
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
		if (!resources) return;

		applyVoxelTerrainBackground(resources.scene, terrain);
	}, [resources, terrain, terrainBackgroundColor]);

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
		const specialUniforms = installSpecialMaterialShader(material);
		const tickTime = (now: number) => {
			specialUniforms.uTime.value = now / 1000;
		};
		resources.animationCallbacks.add(tickTime);

		const mesh = new THREE.Mesh(terrainGeometry.geometry, material);
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
			geometry: terrainGeometry.geometry,
			material,
		};

		return () => {
			resources.animationCallbacks.delete(tickTime);
		};
	}, [resources, terrainGeometry]);
}
