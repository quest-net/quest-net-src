// Hover ghost + selection bounds indicator geometry.
//
// `updateHoverIndicator` rebuilds the contents of `hoverGroup` based on the
// active tool, brush, and pick. `updateSelectionIndicator` rebuilds the
// `selectionGroup` (the persistent box-select outline + live preview frame).

import * as THREE from "three";
import { VOXEL_FACE_DEFINITIONS } from "../../Map/Terrain/geometry/VoxelTerrainGeometryConstants";
import type { EditableVoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import {
	packVoxelKey,
	unpackVoxelKey,
	type VoxelTerrainIndex,
} from "../../../utils/terrain/data/VoxelTerrainIndex";
import {
	editGridGetColor,
	editGridHasVoxel,
	type EditGrid,
} from "../../../utils/terrain/editor/EditGridUtils";
import {
	normalizeVoxelPaletteIndex,
	terrainPaletteIndexToVoxelColor,
} from "../../../utils/terrain/editor/VoxelTerrainEditorUtils";
import type { ChunkDims } from "../../../utils/terrain/editor/EditGridChunkUtils";
import {
	getVoxelSelectionBounds,
	type TerrainSelection,
	type VoxelCoord,
	type VoxelSelectionBounds,
} from "../../../utils/terrain/editor/VoxelTerrainSelectionUtils";
import {
	iterateStampVoxels,
	type StampTransform,
} from "../../../utils/terrain/editor/VoxelStampUtils";
import {
	collectAffectedCoords,
	getPickSelectionBounds,
	isVoxelInBounds,
	type EditGranularity,
	type PickInfo,
} from "../../../utils/terrain/editor/VoxelBrushUtils";
import {
	clearObjectGroup,
	type EditorSceneResources,
} from "./editorScene";
import { createSelectionBoundsFrame } from "./editorGridLines";

const HOVER_FACE_OFFSET = 0.014;
const BOX_SELECTION_COLOR = 0xef4444;
const BOX_SELECTION_PREVIEW_COLOR = 0xfacc15;

export type HoverTool =
	| "place"
	| "fill"
	| "erase"
	| "paint"
	| "sample"
	| "stamp"
	| "boxSelect"
	| "colorSelect";

function getVoxelWorldCenter(index: VoxelTerrainIndex, voxel: VoxelCoord): THREE.Vector3 {
	const half = index.voxelSize / 2;
	return new THREE.Vector3(
		voxel.x / index.resolution - index.width  / 2 + half,
		(voxel.y + 0.5) / index.resolution - 0.5,
		voxel.z / index.resolution - index.length / 2 + half,
	);
}

function getHoverColor(colorIndex: number): THREE.Color {
	const color = new THREE.Color(
		terrainPaletteIndexToVoxelColor(normalizeVoxelPaletteIndex(colorIndex)),
	);
	const lum = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
	return lum > 0.62
		? color.multiplyScalar(0.48)
		: color.lerp(new THREE.Color(0xffffff), 0.5);
}

function addVoxelFace(
	positions: number[],
	colors: number[],
	indices: number[],
	center: THREE.Vector3,
	voxelSize: number,
	face: (typeof VOXEL_FACE_DEFINITIONS)[number],
	color: THREE.Color,
	offset: number,
): void {
	const vertexIndex = positions.length / 3;
	const [nx, ny, nz] = face.normal;
	for (const [cx, cy, cz] of face.corners) {
		positions.push(
			center.x + cx * voxelSize + nx * offset,
			center.y + cy * voxelSize + ny * offset,
			center.z + cz * voxelSize + nz * offset,
		);
		colors.push(color.r, color.g, color.b);
	}
	indices.push(
		vertexIndex, vertexIndex + 1, vertexIndex + 2,
		vertexIndex, vertexIndex + 2, vertexIndex + 3,
	);
}

function finalizeColoredGeometry(
	positions: number[],
	colors: number[],
	indices: number[],
): THREE.BufferGeometry | null {
	if (positions.length === 0) return null;
	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geo.setAttribute("color",    new THREE.Float32BufferAttribute(colors, 3));
	geo.setIndex(indices);
	geo.computeBoundingSphere();
	return geo;
}

function createHoverSurfaceGeometry(
	grid: EditGrid,
	dims: ChunkDims,
	index: VoxelTerrainIndex,
	coords: VoxelCoord[],
): THREE.BufferGeometry | null {
	const { vW, vH, vL } = dims;
	const positions: number[] = [];
	const colors:    number[] = [];
	const indices:   number[] = [];
	const selectedKeys = new Set(coords.map((c) => packVoxelKey(c.x, c.y, c.z)));

	for (const key of selectedKeys) {
		const { x, y, z } = unpackVoxelKey(key);
		const colorIndex = editGridGetColor(grid, x, y, z, vW, vH, vL);
		if (colorIndex === null) continue;

		const center = getVoxelWorldCenter(index, { x, y, z });
		const color  = getHoverColor(colorIndex);

		for (const face of VOXEL_FACE_DEFINITIONS) {
			const [dx, dy, dz] = face.neighborOffset;
			if (editGridHasVoxel(grid, x + dx, y + dy, z + dz, vW, vH, vL)) continue;
			addVoxelFace(positions, colors, indices, center, index.voxelSize, face, color, HOVER_FACE_OFFSET);
		}
	}

	return finalizeColoredGeometry(positions, colors, indices);
}

function createPlaceGhostGeometry(
	grid: EditGrid,
	dims: ChunkDims,
	index: VoxelTerrainIndex,
	coords: VoxelCoord[],
): THREE.BufferGeometry | null {
	const { vW, vH, vL } = dims;
	const positions: number[] = [];
	const colors:    number[] = [];
	const indices:   number[] = [];
	const ghostKeys = new Set<number>();

	for (const coord of coords) {
		if (!isVoxelInBounds(index, coord)) continue;
		if (editGridHasVoxel(grid, coord.x, coord.y, coord.z, vW, vH, vL)) continue;
		ghostKeys.add(packVoxelKey(coord.x, coord.y, coord.z));
	}

	const white = new THREE.Color(0xffffff);
	for (const key of ghostKeys) {
		const { x, y, z } = unpackVoxelKey(key);
		const center = getVoxelWorldCenter(index, { x, y, z });
		for (const face of VOXEL_FACE_DEFINITIONS) {
			const [dx, dy, dz] = face.neighborOffset;
			const neighborKey = packVoxelKey(x + dx, y + dy, z + dz);
			if (ghostKeys.has(neighborKey)) continue;
			if (editGridHasVoxel(grid, x + dx, y + dy, z + dz, vW, vH, vL)) continue;
			addVoxelFace(positions, colors, indices, center, index.voxelSize, face, white, 0);
		}
	}

	return finalizeColoredGeometry(positions, colors, indices);
}

function createSelectionCellGhostGeometry(
	dims: ChunkDims,
	index: VoxelTerrainIndex,
	bounds: VoxelSelectionBounds,
): THREE.BufferGeometry | null {
	const positions: number[] = [];
	const colors:    number[] = [];
	const indices:   number[] = [];
	const ghostKeys = new Set<number>();

	for (let y = bounds.min.y; y <= bounds.max.y; y++) {
		for (let z = bounds.min.z; z <= bounds.max.z; z++) {
			for (let x = bounds.min.x; x <= bounds.max.x; x++) {
				if (x < 0 || x >= dims.vW || y < 0 || y >= dims.vH || z < 0 || z >= dims.vL) {
					continue;
				}
				ghostKeys.add(packVoxelKey(x, y, z));
			}
		}
	}

	if (ghostKeys.size === 0) return null;

	const white = new THREE.Color(0xffffff);
	for (const key of ghostKeys) {
		const { x, y, z } = unpackVoxelKey(key);
		const center = getVoxelWorldCenter(index, { x, y, z });
		for (const face of VOXEL_FACE_DEFINITIONS) {
			const [dx, dy, dz] = face.neighborOffset;
			if (ghostKeys.has(packVoxelKey(x + dx, y + dy, z + dz))) continue;
			addVoxelFace(positions, colors, indices, center, index.voxelSize, face, white, 0);
		}
	}

	return finalizeColoredGeometry(positions, colors, indices);
}

function createStampGhostGeometry(
	source: EditableVoxelTerrain,
	transform: StampTransform,
	anchor: VoxelCoord,
	dims: ChunkDims,
	index: VoxelTerrainIndex,
): THREE.BufferGeometry | null {
	const { vW, vH, vL } = dims;

	// Resolve the stamp into destination voxel coords (clipped to bounds) and
	// remember each voxel's palette color. The Map dedupes overlapping coords
	// from resolution upscaling and powers neighbor-occupancy face culling.
	const occupancy = new Map<number, number>();
	for (const offset of iterateStampVoxels(source, dims.resolution, transform)) {
		const x = anchor.x + offset.x;
		const y = anchor.y + offset.y;
		const z = anchor.z + offset.z;
		if (x < 0 || x >= vW || y < 0 || y >= vH || z < 0 || z >= vL) continue;
		occupancy.set(packVoxelKey(x, y, z), offset.color);
	}
	if (occupancy.size === 0) return null;

	const positions: number[] = [];
	const colors:    number[] = [];
	const indices:   number[] = [];
	const tmpColor   = new THREE.Color();

	for (const [key, paletteIndex] of occupancy) {
		const { x, y, z } = unpackVoxelKey(key);
		const center = getVoxelWorldCenter(index, { x, y, z });
		tmpColor.set(terrainPaletteIndexToVoxelColor(paletteIndex));

		for (const face of VOXEL_FACE_DEFINITIONS) {
			const [dx, dy, dz] = face.neighborOffset;
			const neighborKey = packVoxelKey(x + dx, y + dy, z + dz);
			if (occupancy.has(neighborKey)) continue;
			addVoxelFace(
				positions, colors, indices,
				center, index.voxelSize, face, tmpColor, HOVER_FACE_OFFSET,
			);
		}
	}

	return finalizeColoredGeometry(positions, colors, indices);
}

export interface HoverInputs {
	grid: EditGrid;
	dims: ChunkDims;
	index: VoxelTerrainIndex;
	pick: PickInfo | null;
	tool: HoverTool;
	granularity: EditGranularity;
	brushSize: number;
	colorIndex: number;
	stampSource: EditableVoxelTerrain | null;
	stampTransform: StampTransform;
}

export function updateHoverIndicator(
	resources: EditorSceneResources,
	inputs: HoverInputs,
): void {
	clearObjectGroup(resources.hoverGroup);
	const { pick, tool, granularity, brushSize, colorIndex, grid, dims, index } = inputs;
	if (!pick) return;

	// Fill acts only on an active selection; its hover is the selection outline,
	// drawn elsewhere. It has no per-voxel brush ghost.
	if (tool === "fill") return;

	if (tool === "boxSelect") {
		const bounds = getPickSelectionBounds(index, pick, granularity, dims);
		const geometry = createSelectionCellGhostGeometry(dims, index, bounds);
		if (!geometry) return;
		const material = new THREE.MeshBasicMaterial({
			color: BOX_SELECTION_COLOR,
			transparent: true,
			opacity: 0.28,
			depthWrite: false,
			vertexColors: false,
		});
		const mesh = new THREE.Mesh(geometry, material);
		mesh.renderOrder = 31;
		resources.hoverGroup.add(mesh);
		return;
	}

	if (tool === "colorSelect") {
		const geometry = createHoverSurfaceGeometry(grid, dims, index, [pick.voxel]);
		if (!geometry) return;
		const material = new THREE.MeshBasicMaterial({
			transparent: true,
			opacity: 0.9,
			depthWrite: false,
			vertexColors: true,
		});
		const mesh = new THREE.Mesh(geometry, material);
		mesh.renderOrder = 30;
		resources.hoverGroup.add(mesh);
		return;
	}

	if (tool === "stamp") {
		if (!inputs.stampSource) return;
		const anchor: VoxelCoord = pick.ground
			? { ...pick.voxel }
			: {
				x: pick.voxel.x + pick.normal.x,
				y: pick.voxel.y + pick.normal.y,
				z: pick.voxel.z + pick.normal.z,
			};
		const geometry = createStampGhostGeometry(inputs.stampSource, inputs.stampTransform, anchor, dims, index);
		if (!geometry) return;
		const material = new THREE.MeshBasicMaterial({
			transparent:  true,
			opacity:      0.55,
			depthWrite:   false,
			vertexColors: true,
		});
		const mesh = new THREE.Mesh(geometry, material);
		mesh.renderOrder = 30;
		resources.hoverGroup.add(mesh);
		return;
	}

	const coords =
		tool === "sample"
			? [pick.voxel]
			: collectAffectedCoords(index, pick, tool, granularity, brushSize);

	const geometry =
		tool === "place"
			? createPlaceGhostGeometry(grid, dims, index, coords)
			: createHoverSurfaceGeometry(grid, dims, index, coords);

	if (!geometry) return;

	const material =
		tool === "place"
			? new THREE.MeshBasicMaterial({
				color: terrainPaletteIndexToVoxelColor(colorIndex),
				transparent: true,
				opacity: 0.38,
				depthWrite: false,
				vertexColors: false,
			})
			: new THREE.MeshBasicMaterial({
				transparent: true,
				opacity: 0.9,
				depthWrite: false,
				vertexColors: true,
			});
	const mesh = new THREE.Mesh(geometry, material);
	mesh.renderOrder = 30;
	resources.hoverGroup.add(mesh);
}

export function updateSelectionIndicator(
	resources: EditorSceneResources,
	dims: ChunkDims,
	selection: TerrainSelection | null,
	previewBounds: VoxelSelectionBounds | null,
): void {
	clearObjectGroup(resources.selectionGroup);

	const bounds =
		previewBounds ??
		(selection?.kind === "box" ? getVoxelSelectionBounds(selection) : null);
	if (bounds) {
		resources.selectionGroup.add(
			createSelectionBoundsFrame(
				bounds,
				dims,
				previewBounds ? BOX_SELECTION_PREVIEW_COLOR : BOX_SELECTION_COLOR,
				previewBounds ? 0.95 : 0.86,
			),
		);
	}
}
