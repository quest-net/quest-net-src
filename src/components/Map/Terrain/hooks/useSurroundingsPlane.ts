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
	getMaterialDeformsSurface,
	isVolumetricMaterial,
	TERRAIN_MATERIAL_REGISTRY,
	type VoxelAoTexture,
} from "../materials";
import { createSurroundingsCloudsMaterial } from "../materials/surroundingsCloudsMaterial";

// ---------------------------------------------------------------------------
// Decorative "surroundings" plane for the map scene.
//
// Renders a flat surface at a DM-configured height, using a DM-configured
// palette color or special material (water, grass, lava, clouds...). Purely
// visual:
//   - never added to occlusionTargets (invisible to the occlusion fade),
//   - never casts shadows (it would swamp the terrain-fitted shadow frustum),
//   - inert to interaction for free, since world-view picking raycasts voxel
//     DATA (DDA), not scene meshes.
//
// Geometry has three parts:
//   1. Ring: top-facing quads extending outward from the terrain's
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
// Vertex displacement (water ripples, cloud puffs): when the chosen material
// deforms its surface, the interior fill and a "detail band" of the ring
// around the footprint are tessellated into DETAIL_CELL_SIZE quads and given
// a per-vertex surfaceDeformStrength of 1 -- except vertices that touch a
// closed column (a hull wall), the band's outer seam, or the skirt, which get
// 0 so the sheet stays pinned where displacement could open cracks. Beyond
// the band the ring remains mega-quads with strength 0 (distant surface stays
// flat; no vertex budget wasted off-screen). Tessellation cuts are anchored
// to the footprint origin so vertices on shared rectangle borders coincide;
// borders at off-grid voxel positions can produce T-junctions, but the
// displacement field is a smooth world-position noise, so the mismatch is
// bounded by its curvature over one cell -- far below visibility.
//
// Without an occupancy snapshot (terrain still meshing, or empty terrain) the
// geometry falls back to ring + full skirt with zero deform strength.
//
// Materials reuse the real terrain material factories (AO-only variant, same
// as the first-person view) so an endless water/grass/lava field looks like
// the in-map material. The AO sampler gets the placeholder "fully empty"
// texture: the plane lies outside the terrain's AO volume and must not pick
// up clamped edge darkening.
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
	// World units per occupancy-grid cell along X / Z. Derived from world size /
	// grid dims so it stays correct when the occupancy volume is a downsampled
	// view (where it no longer equals the true voxelSize = 1 / resolution).
	stepX: number;
	stepZ: number;
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
	const { data, voxelWidth, voxelHeight, voxelLength } = occupancy;
	// Cells per world unit along Y, from the grid dims + world size -- correct
	// even when the occupancy volume is downsampled (voxelSize no longer matches
	// the grid resolution).
	const cellsPerWorldY = voxelHeight / occupancy.worldSizeY;
	// The grid layer whose bottom face is coplanar with the plane, and the layer
	// whose top face is (one below it).
	const layerAbove = Math.round(planeHeight * cellsPerWorldY);
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
		stepX: occupancy.worldSizeX / voxelWidth,
		stepZ: occupancy.worldSizeZ / voxelLength,
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

type QuadStrengths = readonly [number, number, number, number];
const ZERO_STRENGTHS: QuadStrengths = [0, 0, 0, 0];

/**
 * Per-vertex deform strength for displaced materials: 1 in the open field,
 * 0 where displacement must not move the sheet -- vertices that touch a
 * closed (wall) column, and vertices on the detail band's outer seam where
 * tessellated geometry meets the flat far-field mega-quads.
 */
function makeStrengthAt(
	coverage: InteriorCoverage,
	bandX: number,
	bandZ: number
): (x: number, z: number) => number {
	const { covered, voxelWidth, voxelLength, stepX, stepZ, originX, originZ } =
		coverage;
	const eps = 1e-4;
	const columnOpen = (wx: number, wz: number): boolean => {
		const vx = Math.floor((wx - originX) / stepX);
		const vz = Math.floor((wz - originZ) / stepZ);
		// Outside the footprint is open field (the ring).
		if (vx < 0 || vx >= voxelWidth || vz < 0 || vz >= voxelLength) return true;
		return covered[vz * voxelWidth + vx] === 1;
	};
	return (x: number, z: number): number => {
		if (x <= -bandX + eps || x >= bandX - eps) return 0;
		if (z <= -bandZ + eps || z >= bandZ - eps) return 0;
		return columnOpen(x - eps, z - eps) &&
			columnOpen(x + eps, z - eps) &&
			columnOpen(x - eps, z + eps) &&
			columnOpen(x + eps, z + eps)
			? 1
			: 0;
	};
}

function buildSurroundingsGeometry(
	width: number,
	length: number,
	planeHeight: number,
	color: THREE.Color,
	coverage: InteriorCoverage | null,
	tessellate: boolean
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
	const deformStrengths: number[] = [];
	const indices: number[] = [];

	const addQuad = (
		corners: ReadonlyArray<readonly [number, number, number]>,
		normal: readonly [number, number, number],
		strengths: QuadStrengths = ZERO_STRENGTHS
	) => {
		const base = positions.length / 3;
		for (let i = 0; i < corners.length; i++) {
			const [x, y, z] = corners[i];
			positions.push(x, y, z);
			normals.push(normal[0], normal[1], normal[2]);
			colors.push(color.r, color.g, color.b);
			deformStrengths.push(strengths[i]);
		}
		indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
	};

	// Top-facing quad; corner order matches the voxel mesher's +Y face winding
	// (CCW viewed from above). Strengths follow the same corner order.
	const addTopQuad = (
		minX: number,
		maxX: number,
		minZ: number,
		maxZ: number,
		strengths: QuadStrengths = ZERO_STRENGTHS
	) =>
		addQuad(
			[
				[minX, planeY, maxZ],
				[maxX, planeY, maxZ],
				[maxX, planeY, minZ],
				[minX, planeY, minZ],
			],
			[0, 1, 0],
			strengths
		);

	// Tessellated top quad: cut at DETAIL_CELL_SIZE multiples anchored to the
	// footprint corner, so cut lines coincide across separately-emitted quads.
	const detailCell = THREE_D_SURROUNDINGS.DETAIL_CELL_SIZE;
	const cutsBetween = (min: number, max: number, anchor: number): number[] => {
		const cuts: number[] = [min];
		const firstStep = Math.ceil((min - anchor) / detailCell + 1e-6);
		for (let k = firstStep; ; k++) {
			const c = anchor + k * detailCell;
			if (c >= max - 1e-6) break;
			if (c > min + 1e-6) cuts.push(c);
		}
		cuts.push(max);
		return cuts;
	};
	const addDetailTopQuad = (
		minX: number,
		maxX: number,
		minZ: number,
		maxZ: number,
		strengthAt: (x: number, z: number) => number
	) => {
		const xs = cutsBetween(minX, maxX, -halfWidth);
		const zs = cutsBetween(minZ, maxZ, -halfLength);
		for (let zi = 0; zi < zs.length - 1; zi++) {
			for (let xi = 0; xi < xs.length - 1; xi++) {
				const x0 = xs[xi];
				const x1 = xs[xi + 1];
				const z0 = zs[zi];
				const z1 = zs[zi + 1];
				addTopQuad(x0, x1, z0, z1, [
					strengthAt(x0, z1),
					strengthAt(x1, z1),
					strengthAt(x1, z0),
					strengthAt(x0, z0),
				]);
			}
		}
	};

	const detailed = coverage !== null && tessellate;
	const bandX = Math.min(halfWidth + THREE_D_SURROUNDINGS.DETAIL_MARGIN, extent);
	const bandZ = Math.min(halfLength + THREE_D_SURROUNDINGS.DETAIL_MARGIN, extent);
	const strengthAt = detailed ? makeStrengthAt(coverage, bandX, bandZ) : null;

	// Ring around the footprint.
	if (strengthAt) {
		// Detail band: tessellated strips between the footprint and the band
		// rectangle, then flat far-field mega-quads out to the extent.
		addDetailTopQuad(-bandX, bandX, -bandZ, -halfLength, strengthAt); // -Z
		addDetailTopQuad(-bandX, bandX, halfLength, bandZ, strengthAt);   // +Z
		addDetailTopQuad(-bandX, -halfWidth, -halfLength, halfLength, strengthAt); // -X
		addDetailTopQuad(halfWidth, bandX, -halfLength, halfLength, strengthAt);   // +X
		if (bandZ < extent) {
			addTopQuad(-extent, extent, -extent, -bandZ);
			addTopQuad(-extent, extent, bandZ, extent);
		}
		if (bandX < extent) {
			addTopQuad(-extent, -bandX, -bandZ, bandZ);
			addTopQuad(bandX, extent, -bandZ, bandZ);
		}
	} else {
		addTopQuad(-extent, extent, -extent, -halfLength); // -Z strip
		addTopQuad(-extent, extent, halfLength, extent);   // +Z strip
		addTopQuad(-extent, -halfWidth, -halfLength, halfLength); // -X strip
		addTopQuad(halfWidth, extent, -halfLength, halfLength);   // +X strip
	}

	// Interior fill: greedy-merge the covered mask into rectangles and emit a
	// top quad per rectangle, in world units via the occupancy grid mapping.
	if (coverage) {
		const { covered, voxelWidth, voxelLength, stepX, stepZ, originX, originZ } =
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
				const rectMinX = originX + x * stepX;
				const rectMaxX = originX + (x + w) * stepX;
				const rectMinZ = originZ + z * stepZ;
				const rectMaxZ = originZ + (z + d) * stepZ;
				if (strengthAt) {
					addDetailTopQuad(rectMinX, rectMaxX, rectMinZ, rectMaxZ, strengthAt);
				} else {
					addTopQuad(rectMinX, rectMaxX, rectMinZ, rectMaxZ);
				}
			}
		}
	}

	// Skirt: outward-facing quads at the footprint boundary, closing the
	// under-plane gap seen from low angles where edge terrain sits below the
	// plane. Emitted only along boundary runs the interior fill does NOT
	// cover -- a covered run's surface is continuous across the boundary.
	// Windings match the voxel mesher's side faces. Skipped at height 0
	// (degenerate). Without coverage info every edge is one full run.
	// Always zero deform strength: the skirt must stay pinned.
	if (planeY > baseY) {
		const zNeg = -halfLength - eps;
		const zPos = halfLength + eps;
		const xNeg = -halfWidth - eps;
		const xPos = halfWidth + eps;
		const columnsX = coverage ? coverage.voxelWidth : 1;
		const columnsZ = coverage ? coverage.voxelLength : 1;
		const stepX = coverage ? coverage.stepX : width;
		const stepZ = coverage ? coverage.stepZ : length;
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
	// Custom terrain-shader attributes. surfaceDeformStrength gates vertex
	// displacement (water ripples, cloud puffs) -- nonzero only on tessellated
	// detail-band/interior vertices clear of walls and seams. tileHeight and
	// highlightStrength stay zero: the surroundings never shows the movement
	// highlight.
	geometry.setAttribute("surfaceDeformStrength", new THREE.BufferAttribute(new Float32Array(deformStrengths), 1));
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
		// Tessellate only for materials that displace vertices (clouds, and any
		// terrain material flagged deformSurface, e.g. water); static materials
		// keep the cheap mega-quad geometry.
		const deformingMaterial =
			isVolumetricMaterial(surroundingsColorIndex) ||
			getMaterialDeformsSurface(surroundingsColorIndex);
		const geometry = buildSurroundingsGeometry(
			terrainWidth,
			terrainLength,
			planeHeight,
			color,
			coverage,
			deformingMaterial
		);

		// Volumetric materials (fog) have no surface shader -- the raymarched fog
		// pass cannot draw a sheet outside the terrain volume -- so they get the
		// dedicated "sea of clouds" surroundings material instead.
		const factory = isVolumetricMaterial(surroundingsColorIndex)
			? createSurroundingsCloudsMaterial
			: TERRAIN_MATERIAL_REGISTRY.get(getMaterialBucket(surroundingsColorIndex)) ??
				TERRAIN_MATERIAL_REGISTRY.get("default")!;
		const voxelAo = createPlaceholderVoxelAoTexture();
		// No movementHighlight -> the skirt shares the terrain program with the
		// overlay disabled.
		const result = factory({
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
