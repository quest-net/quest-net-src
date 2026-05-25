import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { getVoxelCount } from "../../../utils/terrain/data/VoxelDataUtils";
import { getMaxVoxelSurfaceHeight } from "../../../utils/terrain/data/VoxelTerrainUtils";
import type { ThreeDSceneResources } from "../Actors3D/actorTokenTypes";
import {
	createTerrainSignature,
	useVoxelTerrainGeometryWorker,
} from "../Terrain/hooks/useVoxelTerrainGeometryWorker";
import { getShadowCameraBounds } from "../shadowCameraBounds";
import {
	createVoxelAoTexture,
	TERRAIN_MATERIAL_REGISTRY,
	type VoxelAoTexture,
} from "../Terrain/materials";
import {
	applyVoxelTerrainBackground,
	applyVoxelTerrainDirectionalLight,
} from "../terrainEnvironment";

interface TerrainRenderResources {
	meshes: THREE.Mesh[];
	geometries: THREE.BufferGeometry[];
	materials: THREE.MeshStandardMaterial[];
	voxelAo: VoxelAoTexture;
	animationFrameCallbacks: ((timeMs: number) => void)[];
}

function disposeTerrainResources(resources: TerrainRenderResources): void {
	for (const geo of resources.geometries) geo.dispose();
	for (const mat of resources.materials) mat.dispose();
	resources.voxelAo.texture.dispose();
}

export { createTerrainSignature };

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

			for (const m of terrainResources.meshes) activeResources.scene.remove(m);
			for (const cb of terrainResources.animationFrameCallbacks) {
				activeResources.animationCallbacks.delete(cb);
			}
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

	useEffect(() => {
		if (!resources) return;

		if (!terrainGeometry) {
			const old = terrainResourcesRef.current;
			if (!old) return;

			for (const m of old.meshes) resources.scene.remove(m);
			for (const cb of old.animationFrameCallbacks) {
				resources.animationCallbacks.delete(cb);
			}
			disposeTerrainResources(old);
			terrainResourcesRef.current = null;
			resources.occlusionTargets.length = 0;
			resources.requestShadowUpdate();
			return;
		}

		const meshes: THREE.Mesh[] = [];
		const geometries: THREE.BufferGeometry[] = [];
		const materials: THREE.MeshStandardMaterial[] = [];
		const voxelAo = createVoxelAoTexture(terrainGeometry.occupancy);
		const animationFrameCallbacks: ((timeMs: number) => void)[] = [];

		for (const [bucketKey, geometry] of terrainGeometry.buckets) {
			const factory =
				TERRAIN_MATERIAL_REGISTRY.get(bucketKey) ??
				TERRAIN_MATERIAL_REGISTRY.get('default')!;
			const result = factory({ acceptsMovementHighlight: false, voxelAo });
			if (result.onAnimationFrame) {
				resources.animationCallbacks.add(result.onAnimationFrame);
				animationFrameCallbacks.push(result.onAnimationFrame);
			}
			const mesh = new THREE.Mesh(geometry, result.material);
			mesh.castShadow = result.castShadow;
			mesh.receiveShadow = result.receiveShadow;
			mesh.renderOrder = result.renderOrder ?? 0;
			meshes.push(mesh);
			geometries.push(geometry);
			materials.push(result.material);
		}

		const old = terrainResourcesRef.current;
		if (old) {
			for (const m of old.meshes) resources.scene.remove(m);
			for (const cb of old.animationFrameCallbacks) {
				resources.animationCallbacks.delete(cb);
			}
			disposeTerrainResources(old);
		}

		for (const mesh of meshes) resources.scene.add(mesh);
		resources.occlusionTargets.length = 0;
		for (const mesh of meshes) resources.occlusionTargets.push(mesh);
		terrainResourcesRef.current = { meshes, geometries, materials, voxelAo, animationFrameCallbacks };
		resources.requestShadowUpdate();
	}, [resources, terrainGeometry]);
}
