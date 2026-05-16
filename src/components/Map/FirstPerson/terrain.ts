import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { acceleratedRaycast, MeshBVH } from "three-mesh-bvh";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { getVoxelCount } from "../../../utils/VoxelDataUtils";
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

type RuntimeSerializedBVH = Parameters<typeof MeshBVH.deserialize>[0] & {
	version: number;
	indirectBuffer: ArrayBufferView | null;
};

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
	const terrainWorkerRef = useRef<Worker | null>(null);
	const terrainBuildIdRef = useRef(0);
	const terrainResourcesRef = useRef<TerrainRenderResources | null>(null);

	// Spawn one worker for the lifetime of this hook instance; terminated on unmount.
	useEffect(() => {
		const worker = new Worker(
			new URL('../../../utils/voxelGeometryWorker.ts', import.meta.url),
			{ type: 'module' }
		);
		terrainWorkerRef.current = worker;
		return () => {
			worker.terminate();
			terrainWorkerRef.current = null;
		};
	}, []);

	useEffect(() => {
		const dirLight = directionalLightRef.current;
		const worker = terrainWorkerRef.current;
		if (!resources || !dirLight || !worker) return;

		// Bump build ID so any result from a previous (now-stale) request is silently dropped.
		const buildId = ++terrainBuildIdRef.current;
		resources.occlusionTargets.length = 0;

		if (!terrain || getVoxelCount(terrain.Voxels) === 0) {
			// Remove current terrain immediately if no new terrain is incoming.
			const old = terrainResourcesRef.current;
			if (old) {
				resources.scene.remove(old.mesh);
				disposeTerrainResources(old);
				terrainResourcesRef.current = null;
			}
			return () => {
				resources.occlusionTargets.length = 0;
			};
		}

		// ---- synchronous: directional light setup ----

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

		// ---- async: off-thread geometry + BVH build ----

		const onMessage = (event: MessageEvent) => {
			if (event.data.buildId !== buildId) return; // stale result, ignore
			worker.removeEventListener('message', onMessage);

			const {
				positions, normals, colors, tileCoords, tileHeights, highlightStrengths,
				indices, bvhRoots, bvhVersion,
			} = event.data;

			// Reconstruct BufferGeometry from the transferred typed arrays.
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position',          new THREE.BufferAttribute(positions, 3));
			geometry.setAttribute('normal',            new THREE.BufferAttribute(normals, 3));
			geometry.setAttribute('color',             new THREE.BufferAttribute(colors, 3));
			geometry.setAttribute('tileCoord',         new THREE.BufferAttribute(tileCoords, 2));
			geometry.setAttribute('tileHeight',        new THREE.BufferAttribute(tileHeights, 1));
			geometry.setAttribute('highlightStrength', new THREE.BufferAttribute(highlightStrengths, 1));
			geometry.setIndex(new THREE.BufferAttribute(indices, 1));
			geometry.computeBoundingBox();
			geometry.computeBoundingSphere();
			// Deserialize the BVH that was built in the worker -- no rebuild needed.
			const serializedBvh: RuntimeSerializedBVH = {
				version: bvhVersion,
				roots: bvhRoots,
				index: indices,
				indirectBuffer: null,
			};
			geometry.boundsTree = MeshBVH.deserialize(
				serializedBvh,
				geometry,
				{ setIndex: false }
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

			// Guard: resources may have been torn down while build was in flight.
			if (!resources) {
				geometry.boundsTree = undefined;
				geometry.dispose();
				material.dispose();
				return;
			}

			// Swap old terrain out, new terrain in.
			const old = terrainResourcesRef.current;
			if (old) {
				resources.scene.remove(old.mesh);
				disposeTerrainResources(old);
			}

			resources.scene.add(mesh);
			resources.occlusionTargets.push(mesh);
			terrainResourcesRef.current = { mesh, geometry, material };
		};

		worker.addEventListener('message', onMessage);
		worker.postMessage({ buildId, terrain });

		return () => {
			worker.removeEventListener('message', onMessage);
			resources.occlusionTargets.length = 0;
			// Old mesh stays visible until the new result lands (or the hook unmounts,
			// in which case the component that owns the scene handles final cleanup).
		};
		// `terrain` intentionally omitted from deps: see comment in 3DMap.tsx.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [resources, terrainSignature, directionalLightRef]);
}
