import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { VoxelTerrain } from "../../../../domains/VoxelTerrain/VoxelTerrain";
import type { ThreeDSceneResources } from "../../Actors3D/actorTokenTypes";
import { THREE_D_SURROUNDINGS } from "../../threeDMapConstants";
import { terrainPaletteIndexToVoxelColor } from "../../../../utils/terrain/editor/VoxelTerrainEditorUtils";
import type { VoxelTerrainOccupancy } from "../geometry/VoxelTerrainGeometryUtils";
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
// Renders a flat surface at a DM-configured height, using a DM-configured
// palette color or special material (water, grass, lava, ...). Purely visual:
//   - never added to occlusionTargets (invisible to the occlusion fade),
//   - never casts shadows (it would swamp the terrain-fitted shadow frustum),
//   - inert to interaction for free, since world-view picking raycasts voxel
//     DATA (DDA), not scene meshes.
//
// Geometry has three parts:
//   1. Ring: four top-facing mega-quads extending outward from the terrain's
//      bounding-box footprint.
//   2. Interior fill: the plane also extends INWARD over voxel columns that
//      are open at the plane height, so a non-rectangular terrain (a boat in
//      open water) sits in the surface instead of against a donut hole. A
//      column qualifies when the voxel cells directly below AND directly
//      above the plane are both empty (a filled cell on either side has a
//      face coplanar with the plane -- z-fighting). Qualifying columns are
//      then flood-filled 4-connected from the footprint perimeter, so the
//      surface stays one connected sheet: enclosed-but-empty pockets (a boat
//      cabin, a walled courtyard) stay dry, and water cannot leak through
//      walls that touch only diagonally. The covered mask is greedy-merged
//      into rectangles before quads are emitted.
//   3. Skirt: outward-facing quads at the footprint boundary closing the
//      under-plane gap seen from low angles -- but only along boundary runs
//      NOT covered by the interior fill (where the fill reaches the boundary
//      the surface is continuous across it, and a skirt wall would read as a
//      dark seam through translucent materials). Offset outward by a small
//      epsilon so it never z-fights terrain side faces.
//
// Without an occupancy snapshot (terrain still meshing, or empty terrain) the
// geometry falls back to ring + full skirt -- the pre-interior-fill shape.
//
// Materials reuse the real terrain material factories (AO-only variant, same
// as the first-person view) so an endless water/grass/lava field looks like
// the in-map material. The AO sampler gets the placeholder "fully empty"
// texture: the plane lies outside the terrain's AO volume and must not pick
// up clamped edge darkening. surfaceDeformStrength is 0 on every vertex --
// the merged quads have too few vertices to ripple, so vertex displacement
// is disabled while per-fragment animation still plays.
// ---------------------------------------------------------------------------

interface SurroundingsResources {
	mesh: THREE.Mesh;
	geometry: THREE.BufferGeometry;
	material: THREE.MeshStandardMaterial;
	voxelAo: VoxelAoTexture;
	onAnimationFrame: ((timeMs: number) => void) | null;
}

/**
 * Per-voxel-column water coverage at the plane height, in occupancy-grid
 * space, plus the grid-to-world mapping needed to emit quads.
 */
interface InteriorCoverage {
	covered: Uint8Array; // 1 = the plane fills this column
	voxelWidth: number;
	voxelLength: number;
	voxelSize: number;
	originX: number;
	originZ: number;
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

function computeInteriorCoverage(
	occupancy: VoxelTerrainOccupancy,
	planeHeight: number
): InteriorCoverage {
	const { data, voxelWidth, voxelHeight, voxelLength, voxelSize } = occupancy;
	const resolution = Math.round(1 / voxelSize);
	// The voxel layer whose bottom face is coplanar with the plane, and the
	// layer whose top face is (one below it).
	const layerAbove = Math.round(planeHeight * resolution);
	const layerBelow = layerAbove - 1;
	const columnCount = voxelWidth * voxelLength;
	const sliceSize = voxelWidth * voxelHeight;

	// Eligibility: both cells flanking the plane must be empty. Occupancy
	// excludes volumetric (fog) voxels, so fog never blocks the surface.
	const eligible = new Uint8Array(columnCount);
	const checkBelow = layerBelow >= 0 && layerBelow < voxelHeight;
	const checkAbove = layerAbove >= 0 && layerAbove < voxelHeight;
	for (let z = 0; z < voxelLength; z++) {
		const zBase = z * sliceSize;
		const rowBase = z * voxelWidth;
		for (let x = 0; x < voxelWidth; x++) {
			const belowFilled =
				checkBelow && data[zBase + layerBelow * voxelWidth + x] !== 0;
			const aboveFilled =
				checkAbove && data[zBase + layerAbove * voxelWidth + x] !== 0;
			eligible[rowBase + x] = belowFilled || aboveFilled ? 0 : 1;
		}
	}

	// Flood fill from the footprint perimeter (the columns touching the outer
	// ring, i.e. open "ocean"). 4-connected; cells are marked covered when
	// pushed so each enters the stack at most once.
	const covered = new Uint8Array(columnCount);
	const stack = new Int32Array(columnCount);
	let stackSize = 0;
	const visit = (index: number) => {
		if (eligible[index] && !covered[index]) {
			covered[index] = 1;
			stack[stackSize++] = index;
		}
	};
	for (let x = 0; x < voxelWidth; x++) {
		visit(x);
		visit((voxelLength - 1) * voxelWidth + x);
	}
	for (let z = 0; z < voxelLength; z++) {
		visit(z * voxelWidth);
		visit(z * voxelWidth + voxelWidth - 1);
	}
	while (stackSize > 0) {
		const index = stack[--stackSize];
		const x = index % voxelWidth;
		if (x > 0) visit(index - 1);
		if (x < voxelWidth - 1) visit(index + 1);
		if (index >= voxelWidth) visit(index - voxelWidth);
		if (index < columnCount - voxelWidth) visit(index + voxelWidth);
	}

	return {
		covered,
		voxelWidth,
		voxelLength,
		voxelSize,
		originX: occupancy.worldOriginX,
		originZ: occupancy.worldOriginZ,
	};
}

/**
 * Walks one footprint edge of `count` boundary columns and invokes `emit` for
 * each maximal run [start, end) of columns NOT covered by the interior fill.
 */
function forEachUncoveredRun(
	count: number,
	isCovered: (i: number) => boolean,
	emit: (start: number, end: number) => void
): void {
	let runStart = -1;
	for (let i = 0; i <= count; i++) {
		const open = i < count && !isCovered(i);
		if (open && runStart < 0) runStart = i;
		if (!open && runStart >= 0) {
			emit(runStart, i);
			runStart = -1;
		}
	}
}

function buildSurroundingsGeometry(
	width: number,
	length: number,
	planeHeight: number,
	color: THREE.Color,
	coverage: InteriorCoverage | null
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

	// Interior fill: greedy-merge the covered mask into rectangles and emit a
	// top quad per rectangle, in world units via the occupancy grid mapping.
	if (coverage) {
		const { covered, voxelWidth, voxelLength, voxelSize, originX, originZ } =
			coverage;
		const consumed = new Uint8Array(covered.length);
		for (let z = 0; z < voxelLength; z++) {
			for (let x = 0; x < voxelWidth; x++) {
				const index = z * voxelWidth + x;
				if (!covered[index] || consumed[index]) continue;
				// Widen along x, then extend along z while the full row matches.
				let w = 1;
				while (x + w < voxelWidth) {
					const i = index + w;
					if (!covered[i] || consumed[i]) break;
					w++;
				}
				let d = 1;
				extend: while (z + d < voxelLength) {
					const rowBase = (z + d) * voxelWidth + x;
					for (let dx = 0; dx < w; dx++) {
						const i = rowBase + dx;
						if (!covered[i] || consumed[i]) break extend;
					}
					d++;
				}
				for (let dz = 0; dz < d; dz++) {
					const rowBase = (z + dz) * voxelWidth + x;
					consumed.fill(1, rowBase, rowBase + w);
				}
				addTopQuad(
					originX + x * voxelSize,
					originX + (x + w) * voxelSize,
					originZ + z * voxelSize,
					originZ + (z + d) * voxelSize
				);
			}
		}
	}

	// Skirt: outward-facing quads at the footprint boundary, closing the
	// under-plane gap seen from low angles where edge terrain sits below the
	// plane. Emitted only along boundary runs the interior fill does NOT
	// cover -- a covered run's surface is continuous across the boundary.
	// Windings match the voxel mesher's side faces. Skipped at height 0
	// (degenerate). Without coverage info every edge is one full run.
	if (planeY > baseY) {
		const zNeg = -halfLength - eps;
		const zPos = halfLength + eps;
		const xNeg = -halfWidth - eps;
		const xPos = halfWidth + eps;
		const columnsX = coverage ? coverage.voxelWidth : 1;
		const columnsZ = coverage ? coverage.voxelLength : 1;
		const stepX = coverage ? coverage.voxelSize : width;
		const stepZ = coverage ? coverage.voxelSize : length;
		const originX = coverage ? coverage.originX : -halfWidth;
		const originZ = coverage ? coverage.originZ : -halfLength;
		const coveredAt = (x: number, z: number) =>
			coverage ? coverage.covered[z * coverage.voxelWidth + x] === 1 : false;

		forEachUncoveredRun(
			columnsX,
			(i) => coveredAt(i, 0),
			(start, end) => {
				const x0 = originX + start * stepX;
				const x1 = originX + end * stepX;
				addQuad(
					[
						[x1, baseY, zNeg],
						[x0, baseY, zNeg],
						[x0, planeY, zNeg],
						[x1, planeY, zNeg],
					],
					[0, 0, -1]
				);
			}
		);
		forEachUncoveredRun(
			columnsX,
			(i) => coveredAt(i, columnsZ - 1),
			(start, end) => {
				const x0 = originX + start * stepX;
				const x1 = originX + end * stepX;
				addQuad(
					[
						[x0, baseY, zPos],
						[x1, baseY, zPos],
						[x1, planeY, zPos],
						[x0, planeY, zPos],
					],
					[0, 0, 1]
				);
			}
		);
		forEachUncoveredRun(
			columnsZ,
			(i) => coveredAt(0, i),
			(start, end) => {
				const z0 = originZ + start * stepZ;
				const z1 = originZ + end * stepZ;
				addQuad(
					[
						[xNeg, baseY, z1],
						[xNeg, planeY, z1],
						[xNeg, planeY, z0],
						[xNeg, baseY, z0],
					],
					[-1, 0, 0]
				);
			}
		);
		forEachUncoveredRun(
			columnsZ,
			(i) => coveredAt(columnsX - 1, i),
			(start, end) => {
				const z0 = originZ + start * stepZ;
				const z1 = originZ + end * stepZ;
				addQuad(
					[
						[xPos, baseY, z0],
						[xPos, planeY, z0],
						[xPos, planeY, z1],
						[xPos, baseY, z1],
					],
					[1, 0, 0]
				);
			}
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
	occupancy: VoxelTerrainOccupancy | null,
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

	// Scalars for the config; the occupancy snapshot keys content rebuilds (a
	// voxel edit must recompute the interior fill -- the rebuild is trivial
	// next to the terrain remesh that produced the new snapshot).
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
		// The worker hook can briefly hold the PREVIOUS terrain's snapshot while
		// a new terrain meshes; only trust one whose extents match this terrain.
		const matchingOccupancy =
			occupancy &&
			occupancy.worldSizeX === terrainWidth &&
			occupancy.worldSizeZ === terrainLength &&
			occupancy.worldSizeY === terrainMaxHeight
				? occupancy
				: null;
		const coverage = matchingOccupancy
			? computeInteriorCoverage(matchingOccupancy, planeHeight)
			: null;
		const geometry = buildSurroundingsGeometry(
			terrainWidth,
			terrainLength,
			planeHeight,
			color,
			coverage
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
		occupancy,
		performanceMode,
	]);
}
