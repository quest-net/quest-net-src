import { useEffect, type RefObject } from "react";
import * as THREE from "three";
import { acceleratedRaycast } from "three-mesh-bvh";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { createVoxelTerrainGeometry } from "../../../utils/VoxelTerrainGeometryUtils";
import { getVoxelCount } from "../../../utils/VoxelDataUtils";
import {
	normalizeVoxelPaletteIndex,
	terrainPaletteIndexToVoxelColor,
} from "../../../utils/VoxelTerrainEditorUtils";
import {
	getMaxVoxelSurfaceHeight,
	getVoxelTerrainResolution,
} from "../../../utils/VoxelTerrainUtils";
import type { ThreeDSceneResources } from "../Actors3D/actorTokenTypes";
import {
	THREE_D_MAP_LIGHTING,
	THREE_D_MAP_SHADOW,
	THREE_D_TERRAIN_MATERIAL,
} from "../threeDMapConstants";

interface TerrainRenderResources {
	mesh: THREE.Mesh;
	geometry: THREE.BufferGeometry;
	material: THREE.MeshStandardMaterial;
}

function disposeTerrainResources(resources: TerrainRenderResources): void {
	resources.geometry.boundsTree = undefined;
	resources.geometry.dispose();
	resources.material.dispose();
}

export function createTerrainSignature(terrain?: VoxelTerrain | null): string {
	if (!terrain) return "none";

	return [
		terrain.Id,
		terrain.Width,
		terrain.Length,
		terrain.Height,
		getVoxelTerrainResolution(terrain),
		terrain.Voxels,
	].join(":");
}

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
	useEffect(() => {
		const dirLight = directionalLightRef.current;
		if (!resources || !dirLight) return;

		let terrainResources: TerrainRenderResources | null = null;
		resources.occlusionTargets.length = 0;

		if (!terrain || getVoxelCount(terrain.Voxels) === 0) {
			return () => {
				resources.occlusionTargets.length = 0;
			};
		}

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
		dirLight.shadow.camera.near = THREE_D_MAP_SHADOW.CAMERA_NEAR;
		dirLight.shadow.camera.far = Math.max(
			THREE_D_MAP_SHADOW.MIN_CAMERA_DEPTH,
			terrainMaxExtent * 4
		);
		dirLight.shadow.camera.updateProjectionMatrix();

		const geometry = createVoxelTerrainGeometry(
			terrain,
			(voxel) => new THREE.Color(
				terrainPaletteIndexToVoxelColor(normalizeVoxelPaletteIndex(voxel.color))
			)
		);
		const material = new THREE.MeshStandardMaterial({
			roughness: THREE_D_TERRAIN_MATERIAL.ROUGHNESS,
			metalness: THREE_D_TERRAIN_MATERIAL.METALNESS,
			vertexColors: true,
		});
		const mesh = new THREE.Mesh(geometry, material);
		mesh.raycast = acceleratedRaycast;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		resources.scene.add(mesh);
		resources.occlusionTargets.push(mesh);
		terrainResources = { mesh, geometry, material };

		return () => {
			resources.scene.remove(mesh);
			resources.occlusionTargets.length = 0;
			if (terrainResources) {
				disposeTerrainResources(terrainResources);
			}
		};
		// `terrain` is intentionally omitted from deps: StateSync deep-clones the
		// campaign on every delta (fast-json-patch is called with mutateDocument=false),
		// so the terrain object reference flips on every sync even when its contents
		// are unchanged. Rebuilding the voxel geometry + BVH per sync costs ~300ms
		// and stutters the first-person camera. terrainSignature is the value-equal
		// identity (Id:W:L:H:res:Voxels) and is the only thing we actually need to
		// react to, matching 3DMap.tsx's terrain effect.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [resources, terrainSignature, directionalLightRef]);
}
