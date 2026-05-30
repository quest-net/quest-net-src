import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { ThreeDSceneResources } from "../../Actors3D/actorTokenTypes";
import type { VoxelTerrainGeometryResult } from "./useVoxelTerrainGeometryWorker";
import { createFogVolumeTexture, type FogVolumeTexture } from "../../mapVolumetricFog";
import {
	createMovementHighlightTexture,
	createVoxelAoTexture,
	TERRAIN_MATERIAL_REGISTRY,
	type MovementHighlightTexture,
	type VoxelAoTexture,
} from "../materials";

// ---------------------------------------------------------------------------
// Shared terrain-mesh builder for both map views.
//
// The world view (3DMap) and the first-person view used to keep byte-for-byte
// copies of this build/teardown logic. They differ in exactly three ways, all
// captured by TerrainMeshesOptions:
//   - movementHighlight: world view paints movement range onto the terrain
//     shader (and owns the highlight 3D texture lifecycle); FP does not.
//   - onReady: world view drives a loading screen and fires once after the
//     first build; FP has no such signal.
//   - performanceMode: coarser AO texture.
//
// Everything else -- the per-bucket material lookup, AO texture, fog-density
// volume + setFogVolume wiring, animation-callback registration, occlusion
// targets, and disposal -- is identical and lives here once. Adding the next
// volume/post-processed material now means wiring it here a single time.
// ---------------------------------------------------------------------------

interface TerrainRenderResources {
	meshes: THREE.Mesh[];
	geometries: THREE.BufferGeometry[];
	materials: THREE.MeshStandardMaterial[];
	voxelAo: VoxelAoTexture;
	fogTexture: FogVolumeTexture | null;
	// null in FP mode -- that view never paints movement range, so the scene's
	// own placeholder texture is left untouched.
	movementHighlight: MovementHighlightTexture | null;
	animationFrameCallbacks: ((timeMs: number) => void)[];
}

function disposeTerrainResources(resources: TerrainRenderResources): void {
	for (const geo of resources.geometries) geo.dispose();
	for (const mat of resources.materials) mat.dispose();
	resources.voxelAo.texture.dispose();
	resources.fogTexture?.texture.dispose();
	resources.movementHighlight?.texture.dispose();
}

export interface TerrainMeshesOptions {
	/** World view paints movement range onto the terrain shader; FP does not. */
	movementHighlight: boolean;
	/** Fired once after meshes are first added (world view drives a loading screen). */
	onReady?: () => void;
	performanceMode?: boolean;
}

export function useTerrainMeshes(
	resources: ThreeDSceneResources | null,
	terrainGeometry: VoxelTerrainGeometryResult | null,
	options: TerrainMeshesOptions
): void {
	const terrainResourcesRef = useRef<TerrainRenderResources | null>(null);
	// Keep the latest options/resources visible to the unmount cleanup without
	// re-running it. Mirrors the resourcesRef pattern the views used before.
	const optionsRef = useRef(options);
	optionsRef.current = options;
	const resourcesRef = useRef<ThreeDSceneResources | null>(null);
	useEffect(() => {
		resourcesRef.current = resources;
	}, [resources]);

	// Unmount-only teardown.
	useEffect(
		() => () => {
			const res = resourcesRef.current;
			if (!res) return;
			const terrain = terrainResourcesRef.current;
			if (terrain) {
				for (const m of terrain.meshes) res.scene.remove(m);
				for (const cb of terrain.animationFrameCallbacks) {
					res.animationCallbacks.delete(cb);
				}
				res.setFogVolume?.(null);
				disposeTerrainResources(terrain);
				terrainResourcesRef.current = null;
				res.occlusionTargets.length = 0;
			} else if (optionsRef.current.movementHighlight) {
				// No terrain was ever built: dispose the (1,1,1) placeholder the
				// scene created at init so it does not leak.
				res.movementHighlight.texture.dispose();
			}
		},
		[]
	);

	useEffect(() => {
		if (!resources) return;
		const { movementHighlight: wantHighlight, onReady, performanceMode } =
			optionsRef.current;

		// No geometry: tear down any existing terrain and reset to placeholders.
		if (!terrainGeometry) {
			const old = terrainResourcesRef.current;
			if (!old) return;

			for (const m of old.meshes) resources.scene.remove(m);
			for (const cb of old.animationFrameCallbacks) {
				resources.animationCallbacks.delete(cb);
			}
			resources.setFogVolume?.(null);
			disposeTerrainResources(old);
			terrainResourcesRef.current = null;
			resources.occlusionTargets.length = 0;
			if (wantHighlight) {
				resources.movementHighlight = createMovementHighlightTexture(1, 1, 1);
			}
			resources.requestShadowUpdate();
			return;
		}

		const movementHighlight = wantHighlight
			? createMovementHighlightTexture(
					terrainGeometry.width,
					terrainGeometry.height + 1,
					terrainGeometry.length
			  )
			: null;
		const voxelAo = createVoxelAoTexture(terrainGeometry.occupancy, {
			performanceMode,
		});
		const fogTexture = terrainGeometry.fogVolume
			? createFogVolumeTexture(terrainGeometry.fogVolume)
			: null;
		resources.setFogVolume?.(fogTexture);

		const meshes: THREE.Mesh[] = [];
		const geometries: THREE.BufferGeometry[] = [];
		const materials: THREE.MeshStandardMaterial[] = [];
		const animationFrameCallbacks: ((timeMs: number) => void)[] = [];

		for (const [bucketKey, geometry] of terrainGeometry.buckets) {
			const factory =
				TERRAIN_MATERIAL_REGISTRY.get(bucketKey) ??
				TERRAIN_MATERIAL_REGISTRY.get("default")!;
			const result = factory({
				acceptsMovementHighlight: wantHighlight,
				performanceMode,
				movementHighlight: movementHighlight ?? undefined,
				voxelAo,
			});
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
		} else if (wantHighlight) {
			// First real build: dispose the (1,1,1) placeholder from scene init.
			resources.movementHighlight.texture.dispose();
		}

		for (const mesh of meshes) resources.scene.add(mesh);
		resources.occlusionTargets.length = 0;
		for (const mesh of meshes) resources.occlusionTargets.push(mesh);
		if (movementHighlight) resources.movementHighlight = movementHighlight;
		terrainResourcesRef.current = {
			meshes,
			geometries,
			materials,
			voxelAo,
			fogTexture,
			movementHighlight,
			animationFrameCallbacks,
		};
		resources.requestShadowUpdate();
		onReady?.();
	}, [resources, terrainGeometry]);
}
