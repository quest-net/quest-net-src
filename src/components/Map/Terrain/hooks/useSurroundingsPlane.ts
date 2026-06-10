import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { VoxelTerrain } from "../../../../domains/VoxelTerrain/VoxelTerrain";
import type { ThreeDSceneResources } from "../../Actors3D/actorTokenTypes";
import { THREE_D_SURROUNDINGS } from "../../threeDMapConstants";
import { terrainPaletteIndexToVoxelColor } from "../../../../utils/terrain/editor/VoxelTerrainEditorUtils";
import {
	createPlaceholderVoxelAoTexture,
	getMaterialBucket,
	isVolumetricMaterial,
	TERRAIN_MATERIAL_REGISTRY,
	type VoxelAoTexture,
} from "../materials";

// ---------------------------------------------------------------------------
// Decorative "surroundings" plane for the map scene.
//
// Renders a flat ring extending outward from the terrain's footprint at a
// DM-configured height, using a DM-configured palette color or special
// material (water, grass, lava, ...). Purely visual:
//   - never added to occlusionTargets (invisible to the occlusion fade),
//   - never casts shadows (it would swamp the terrain-fitted shadow frustum),
//   - inert to interaction for free, since world-view picking raycasts voxel
//     DATA (DDA), not scene meshes.
//
// Geometry is a 4-quad ring abutting the footprint (a full plane would z-fight
// terrain bottom faces at height 0 and slice through voxels above it), plus a
// 4-quad outward-facing "skirt" closing the gap under the ring's inner edge
// where edge terrain sits lower than the plane. The skirt is offset outward by
// a small epsilon so it never z-fights terrain side faces.
//
// Materials reuse the real terrain material factories (AO-only variant, same
// as the first-person view) so an endless water/grass/lava field looks like
// the in-map material. The AO sampler gets the placeholder "fully empty"
// texture: the plane lies outside the terrain's AO volume and must not pick
// up clamped edge darkening. surfaceDeformStrength is 0 on every vertex --
// the ring's mega-quads have too few vertices to ripple, so vertex
// displacement is disabled while per-fragment animation still plays.
// ---------------------------------------------------------------------------

interface SurroundingsResources {
	mesh: THREE.Mesh;
	geometry: THREE.BufferGeometry;
	material: THREE.MeshStandardMaterial;
	voxelAo: VoxelAoTexture;
	onAnimationFrame: ((timeMs: number) => void) | null;
}

/** Returns true when an existing plane was actually removed. */
function removeSurroundings(
	resources: ThreeDSceneResources,
	ref: { current: SurroundingsResources | null }
): boolean {
	const built = ref.current;
	if (!built) return false;
	resources.scene.remove(built.mesh);
	if (built.onAnimationFrame) {
		resources.animationCallbacks.delete(built.onAnimationFrame);
	}
	built.geometry.dispose();
	built.material.dispose();
	built.voxelAo.texture.dispose();
	ref.current = null;
	return true;
}

function buildSurroundingsGeometry(
	width: number,
	length: number,
	planeHeight: number,
	color: THREE.Color
): THREE.BufferGeometry {
	const halfWidth = width / 2;
	const halfLength = length / 2;
	// Terrain voxel (0,0,0)'s bottom sits at world y = -0.5 (see the worker's
	// worldOriginY); a surroundings height h is level with the top of an h-cell
	// stack.
	const baseY = -0.5;
	const planeY = planeHeight - 0.5;
	const extent = Math.max(
		Math.max(width, length) * THREE_D_SURROUNDINGS.EXTENT_MULTIPLIER,
		THREE_D_SURROUNDINGS.MIN_EXTENT
	);
	const eps = THREE_D_SURROUNDINGS.SKIRT_EPSILON;

	const positions: number[] = [];
	const normals: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];

	const addQuad = (
		corners: ReadonlyArray<readonly [number, number, number]>,
		normal: readonly [number, number, number]
	) => {
		const base = positions.length / 3;
		for (const [x, y, z] of corners) {
			positions.push(x, y, z);
			normals.push(normal[0], normal[1], normal[2]);
			colors.push(color.r, color.g, color.b);
		}
		indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
	};

	// Ring: four top-facing strips around the footprint. Corner order matches
	// the voxel mesher's +Y face winding (CCW viewed from above).
	const addTopQuad = (minX: number, maxX: number, minZ: number, maxZ: number) =>
		addQuad(
			[
				[minX, planeY, maxZ],
				[maxX, planeY, maxZ],
				[maxX, planeY, minZ],
				[minX, planeY, minZ],
			],
			[0, 1, 0]
		);
	addTopQuad(-extent, extent, -extent, -halfLength); // -Z strip
	addTopQuad(-extent, extent, halfLength, extent);   // +Z strip
	addTopQuad(-extent, -halfWidth, -halfLength, halfLength); // -X strip
	addTopQuad(halfWidth, extent, -halfLength, halfLength);   // +X strip

	// Skirt: outward-facing quads at the footprint boundary, closing the
	// under-plane gap seen from low angles where edge terrain sits below the
	// plane. Windings match the voxel mesher's side faces. Skipped at height 0
	// (degenerate).
	if (planeY > baseY) {
		const zNeg = -halfLength - eps;
		const zPos = halfLength + eps;
		const xNeg = -halfWidth - eps;
		const xPos = halfWidth + eps;
		addQuad(
			[
				[halfWidth, baseY, zNeg],
				[-halfWidth, baseY, zNeg],
				[-halfWidth, planeY, zNeg],
				[halfWidth, planeY, zNeg],
			],
			[0, 0, -1]
		);
		addQuad(
			[
				[-halfWidth, baseY, zPos],
				[halfWidth, baseY, zPos],
				[halfWidth, planeY, zPos],
				[-halfWidth, planeY, zPos],
			],
			[0, 0, 1]
		);
		addQuad(
			[
				[xNeg, baseY, halfLength],
				[xNeg, planeY, halfLength],
				[xNeg, planeY, -halfLength],
				[xNeg, baseY, -halfLength],
			],
			[-1, 0, 0]
		);
		addQuad(
			[
				[xPos, baseY, -halfLength],
				[xPos, planeY, -halfLength],
				[xPos, planeY, halfLength],
				[xPos, baseY, halfLength],
			],
			[1, 0, 0]
		);
	}

	const vertexCount = positions.length / 3;
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
	geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
	geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
	// Custom terrain-shader attributes. Some material variants declare these
	// (e.g. water's surfaceDeformStrength), so every vertex carries them;
	// all-zero values mean "static surface, no highlight".
	geometry.setAttribute("surfaceDeformStrength", new THREE.BufferAttribute(new Float32Array(vertexCount), 1));
	geometry.setAttribute("tileHeight", new THREE.BufferAttribute(new Float32Array(vertexCount), 1));
	geometry.setAttribute("highlightStrength", new THREE.BufferAttribute(new Float32Array(vertexCount), 1));
	geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
	return geometry;
}

export function useSurroundingsPlane(
	resources: ThreeDSceneResources | null,
	terrain: VoxelTerrain | null | undefined,
	performanceMode?: boolean
): void {
	const surroundingsRef = useRef<SurroundingsResources | null>(null);
	const resourcesRef = useRef<ThreeDSceneResources | null>(null);
	useEffect(() => {
		resourcesRef.current = resources;
	}, [resources]);

	// Unmount-only teardown.
	useEffect(
		() => () => {
			const res = resourcesRef.current;
			if (res) removeSurroundings(res, surroundingsRef);
		},
		[]
	);

	// Scalars only, so voxel-content edits don't churn the plane.
	const terrainWidth = terrain?.Width;
	const terrainLength = terrain?.Length;
	const terrainMaxHeight = terrain?.Height;
	const surroundingsHeight = terrain?.Surroundings?.Height;
	const surroundingsColorIndex = terrain?.Surroundings?.ColorIndex;

	useEffect(() => {
		if (!resources) return;
		const removed = removeSurroundings(resources, surroundingsRef);
		if (
			terrainWidth === undefined ||
			terrainLength === undefined ||
			terrainMaxHeight === undefined ||
			surroundingsHeight === undefined ||
			surroundingsColorIndex === undefined
		) {
			if (removed) resources.requestShadowUpdate();
			return;
		}

		const planeHeight = Math.max(0, Math.min(terrainMaxHeight, surroundingsHeight));
		const color = new THREE.Color(
			terrainPaletteIndexToVoxelColor(surroundingsColorIndex)
		);
		const geometry = buildSurroundingsGeometry(
			terrainWidth,
			terrainLength,
			planeHeight,
			color
		);

		// Volumetric materials (fog) have no surface shader; fall back to the
		// plain vertex-colored default, tinted with the swatch color.
		const bucketKey = isVolumetricMaterial(surroundingsColorIndex)
			? "default"
			: getMaterialBucket(surroundingsColorIndex);
		const factory =
			TERRAIN_MATERIAL_REGISTRY.get(bucketKey) ??
			TERRAIN_MATERIAL_REGISTRY.get("default")!;
		const voxelAo = createPlaceholderVoxelAoTexture();
		const result = factory({
			acceptsMovementHighlight: false,
			performanceMode,
			voxelAo,
		});

		const mesh = new THREE.Mesh(geometry, result.material);
		mesh.castShadow = false;
		mesh.receiveShadow = result.receiveShadow;
		mesh.renderOrder = result.renderOrder ?? 0;

		resources.scene.add(mesh);
		if (result.onAnimationFrame) {
			resources.animationCallbacks.add(result.onAnimationFrame);
		}
		surroundingsRef.current = {
			mesh,
			geometry,
			material: result.material,
			voxelAo,
			onAnimationFrame: result.onAnimationFrame ?? null,
		};
		resources.requestShadowUpdate();
	}, [
		resources,
		terrainWidth,
		terrainLength,
		terrainMaxHeight,
		surroundingsHeight,
		surroundingsColorIndex,
		performanceMode,
	]);
}
