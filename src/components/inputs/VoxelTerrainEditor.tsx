import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { acceleratedRaycast, MeshBVH } from "three-mesh-bvh";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Voxel, VoxelTerrain } from "../../domains/VoxelTerrain/VoxelTerrain";
import { terrainHeightToWorldY } from "../Map/Actors3D/actorTokenPlacement";
import { VOXEL_FACE_DEFINITIONS } from "../../utils/VoxelTerrainGeometryConstants";
import {
	buildVoxelTerrainBuffers,
	createVoxelTerrainBufferGeometry,
} from "../../utils/VoxelTerrainGeometryUtils";
import {
	decodeVoxels,
	encodeVoxels,
} from "../../utils/VoxelDataUtils";
import {
	DEFAULT_TERRAIN_COLOR_INDEX,
	TERRAIN_PALETTE,
	TERRAIN_PALETTE_ROWS,
} from "../../utils/TerrainPaletteUtils";
import {
	normalizeVoxelPaletteIndex,
	terrainPaletteIndexToVoxelColor,
} from "../../utils/VoxelTerrainEditorUtils";
import {
	createTerrainRevision,
	getVoxelTerrainIndex,
	getVoxelTerrainResolution,
	packVoxelKey,
	unpackVoxelKey,
	type VoxelTerrainIndex,
} from "../../utils/VoxelTerrainIndex";
import {
	buildTerrainFromVox,
	getVoxResolutionOptions,
	parseVoxFile,
	type VoxParseResult,
	type VoxResolutionOption,
} from "../../utils/VoxImportUtils";
import ThreeDMap from "../Map/3DMap";
import { MapStateProvider } from "../Map/MapStateProvider";

export interface ActorOverlayInfo {
	id: string;
	name: string;
	position: { x: number; y: number; h: number };
}

type EditorView = "edit" | "preview";
type EditorTool = "place" | "erase" | "paint" | "sample";
type EditGranularity = "tactical" | "voxel";

interface VoxelTerrainEditorProps {
	terrain: VoxelTerrain;
	onChange: (terrain: VoxelTerrain) => void;
	readOnly?: boolean;
	actors?: ActorOverlayInfo[];
}

interface VoxelCoord {
	x: number;
	y: number;
	z: number;
}

interface PickInfo {
	voxel: VoxelCoord;
	normal: VoxelCoord;
	ground: boolean;
	plane: THREE.Plane;
}

interface LockedStrokePlane {
	plane: THREE.Plane;
	normal: VoxelCoord;
	ground: boolean;
}

interface ActiveStroke {
	pointerId: number;
	startClientX: number;
	startClientY: number;
	dragStarted: boolean;
	lockedPlane: LockedStrokePlane;
}

interface EditorSceneResources {
	scene: THREE.Scene;
	camera: THREE.OrthographicCamera;
	renderer: THREE.WebGLRenderer;
	controls: OrbitControls;
	raycaster: THREE.Raycaster;
	gridGroup: THREE.Group;
	hoverGroup: THREE.Group;
	terrainMesh: THREE.Mesh | null;
	terrainMaterial: THREE.MeshStandardMaterial;
}

// VOX import ----------------------------------------------------------------

type VoxImportModal =
	| { kind: "pick"; parsed: VoxParseResult; options: VoxResolutionOption[]; selected: number }
	| { kind: "error"; message: string };

const VOX_RESOLUTION_LABELS: Record<number, string> = {
	1: "Basic",
	2: "Detailed",
	3: "Very Detailed",
};

// ---------------------------------------------------------------------------

const UNDO_LIMIT = 50;
const MIN_BRUSH_SIZE = 1;
const MAX_BRUSH_SIZE = 8;
const PICK_EPSILON = 0.0001;
const GRID_LINE_OFFSET = 0.008;
const HOVER_FACE_OFFSET = 0.014;
const INITIAL_CAMERA_HALF_SIZE = 14;
const CAMERA_DISTANCE_MULTIPLIER = 1.65;
const STROKE_DRAG_THRESHOLD_PX = 5;
const EDITOR_PIXEL_RATIO = 1;
// Lift the actor-overlay dot slightly above the tactical surface so it
// reads cleanly against the terrain.
const ACTOR_OVERLAY_FLOAT_Y = 0.2;

const TOOL_BUTTONS: Array<{
	id: EditorTool;
	label: string;
	icon: string;
	shortcut: string;
}> = [
	{
		id: "place",
		label: "Place",
		icon: "icon-[mdi--cube-outline]",
		shortcut: "P",
	},
	{
		id: "erase",
		label: "Erase",
		icon: "icon-[mdi--eraser]",
		shortcut: "R",
	},
	{
		id: "paint",
		label: "Paint",
		icon: "icon-[mdi--palette]",
		shortcut: "G",
	},
	{
		id: "sample",
		label: "Sample",
		icon: "icon-[mdi--eyedropper]",
		shortcut: "I",
	},
];

// Detect Mac for showing the right modifier glyph in tooltips.
const IS_MAC =
	typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
const MOD_KEY_LABEL = IS_MAC ? "⌘" : "Ctrl";

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// Mid-stroke overlay
//
// The editor's canonical state is the encoded `VoxelTerrain.Voxels` string.
// `getVoxelTerrainIndex(terrain)` exposes hasVoxel / getVoxelColor queries
// for that committed state.
//
// During a brush stroke we accumulate pending changes in a small overlay
// (`Map<packedKey, color | null>`, where `null` means "this voxel was deleted
// in this stroke"). Queries check the overlay first, then fall back to the
// index. On rAF flush the overlay is folded into the terrain and cleared.
// ---------------------------------------------------------------------------

type VoxelOverlay = Map<number, number | null>;

function peekHasVoxel(
	index: VoxelTerrainIndex,
	overlay: VoxelOverlay,
	vx: number,
	vy: number,
	vz: number
): boolean {
	const key = packVoxelKey(vx, vy, vz);
	if (overlay.has(key)) return overlay.get(key) !== null;
	return index.hasVoxel(vx, vy, vz);
}

function peekVoxelColor(
	index: VoxelTerrainIndex,
	overlay: VoxelOverlay,
	vx: number,
	vy: number,
	vz: number
): number | null {
	const key = packVoxelKey(vx, vy, vz);
	if (overlay.has(key)) {
		const value = overlay.get(key);
		return value === undefined ? null : value;
	}
	return index.getVoxelColor(vx, vy, vz);
}

/** Fold an overlay's pending edits into `base` and return the new terrain. */
function commitOverlayToTerrain(base: VoxelTerrain, overlay: VoxelOverlay): VoxelTerrain {
	if (overlay.size === 0) return base;
	const voxels: Voxel[] = [];
	// Keep base voxels that aren't touched by the overlay.
	for (const voxel of decodeVoxels(base.Voxels)) {
		const key = packVoxelKey(voxel.x, voxel.y, voxel.z);
		if (!overlay.has(key)) voxels.push(voxel);
	}
	// Add overlay placements (skip deletes).
	for (const [key, color] of overlay) {
		if (color === null) continue;
		const { x, y, z } = unpackVoxelKey(key);
		voxels.push({ x, y, z, color });
	}
	return { ...base, Voxels: encodeVoxels(voxels) };
}

// ---------------------------------------------------------------------------
// Geometry helpers (bounds checks, coordinate conversions, brush expansion)
// ---------------------------------------------------------------------------

function isVoxelInBounds(index: VoxelTerrainIndex, coord: VoxelCoord): boolean {
	return (
		coord.x >= 0 && coord.x < index.voxelWidth &&
		coord.y >= 0 && coord.y < index.voxelHeight &&
		coord.z >= 0 && coord.z < index.voxelLength
	);
}

function pointToVoxelCoord(
	point: THREE.Vector3,
	index: VoxelTerrainIndex
): VoxelCoord {
	return {
		x: Math.floor((point.x + index.width / 2) * index.resolution),
		y: Math.floor((point.y + 0.5) * index.resolution),
		z: Math.floor((point.z + index.length / 2) * index.resolution),
	};
}

function normalToCoord(normal: THREE.Vector3): VoxelCoord {
	return {
		x: Math.round(normal.x),
		y: Math.round(normal.y),
		z: Math.round(normal.z),
	};
}

function getBrushOffsets(size: number): number[] {
	const safeSize = clamp(Math.floor(size) || MIN_BRUSH_SIZE, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
	const start = -Math.floor((safeSize - 1) / 2);

	return Array.from({ length: safeSize }, (_, index) => start + index);
}

function getPlaneBrushCoords(
	origin: VoxelCoord,
	normal: VoxelCoord,
	brushSize: number
): VoxelCoord[] {
	const offsets = getBrushOffsets(brushSize);
	const coords: VoxelCoord[] = [];

	for (const a of offsets) {
		for (const b of offsets) {
			if (normal.y !== 0) {
				coords.push({ x: origin.x + a, y: origin.y, z: origin.z + b });
			} else if (normal.x !== 0) {
				coords.push({ x: origin.x, y: origin.y + a, z: origin.z + b });
			} else {
				coords.push({ x: origin.x + a, y: origin.y + b, z: origin.z });
			}
		}
	}

	return coords;
}

function getTacticalBrushUnits(
	origin: VoxelCoord,
	normal: VoxelCoord,
	brushSize: number,
	index: VoxelTerrainIndex
): VoxelCoord[] {
	const offsets = getBrushOffsets(brushSize);
	const units: VoxelCoord[] = [];

	for (const a of offsets) {
		for (const b of offsets) {
			let unit: VoxelCoord;
			if (normal.y !== 0) {
				unit = { x: origin.x + a, y: origin.y, z: origin.z + b };
			} else if (normal.x !== 0) {
				unit = { x: origin.x, y: origin.y + a, z: origin.z + b };
			} else {
				unit = { x: origin.x + a, y: origin.y + b, z: origin.z };
			}

			if (
				unit.x >= 0 && unit.x < index.width &&
				unit.y >= 0 && unit.y < index.height &&
				unit.z >= 0 && unit.z < index.length
			) {
				units.push(unit);
			}
		}
	}

	return units;
}

function getTacticalUnitFromVoxel(coord: VoxelCoord, index: VoxelTerrainIndex): VoxelCoord {
	return {
		x: Math.floor(coord.x / index.resolution),
		y: Math.floor(coord.y / index.resolution),
		z: Math.floor(coord.z / index.resolution),
	};
}

function getTacticalBlockCoords(unit: VoxelCoord, index: VoxelTerrainIndex): VoxelCoord[] {
	const coords: VoxelCoord[] = [];
	const startX = unit.x * index.resolution;
	const startY = unit.y * index.resolution;
	const startZ = unit.z * index.resolution;

	for (let z = startZ; z < startZ + index.resolution; z++) {
		for (let y = startY; y < startY + index.resolution; y++) {
			for (let x = startX; x < startX + index.resolution; x++) {
				const coord = { x, y, z };
				if (isVoxelInBounds(index, coord)) coords.push(coord);
			}
		}
	}

	return coords;
}

function collectAffectedCoords(
	index: VoxelTerrainIndex,
	pick: PickInfo,
	tool: EditorTool,
	granularity: EditGranularity,
	brushSize: number
): VoxelCoord[] {
	if (granularity === "voxel") {
		const origin =
			tool === "place" && !pick.ground
				? {
					x: pick.voxel.x + pick.normal.x,
					y: pick.voxel.y + pick.normal.y,
					z: pick.voxel.z + pick.normal.z,
				}
				: pick.voxel;
		const normal = pick.ground ? { x: 0, y: 1, z: 0 } : pick.normal;

		return getPlaneBrushCoords(origin, normal, brushSize).filter((coord) =>
			isVoxelInBounds(index, coord)
		);
	}

	const baseUnit = getTacticalUnitFromVoxel(pick.voxel, index);
	const origin =
		tool === "place" && !pick.ground
			? {
				x: baseUnit.x + pick.normal.x,
				y: baseUnit.y + pick.normal.y,
				z: baseUnit.z + pick.normal.z,
			}
			: baseUnit;
	const normal = pick.ground ? { x: 0, y: 1, z: 0 } : pick.normal;
	const units = getTacticalBrushUnits(origin, normal, brushSize, index);

	return units.flatMap((unit) => getTacticalBlockCoords(unit, index));
}

function applyVoxelEdit(
	index: VoxelTerrainIndex,
	overlay: VoxelOverlay,
	pick: PickInfo,
	tool: EditorTool,
	granularity: EditGranularity,
	brushSize: number,
	colorIndex: number
): { changed: boolean; sampledColor: number | null } {
	const coords =
		tool === "sample"
			? [pick.voxel]
			: collectAffectedCoords(index, pick, tool, granularity, brushSize);
	let changed = false;
	let sampledColor: number | null = null;

	if (tool === "sample") {
		for (const coord of coords) {
			const color = peekVoxelColor(index, overlay, coord.x, coord.y, coord.z);
			if (color !== null) {
				sampledColor = color;
				break;
			}
		}

		return { changed: false, sampledColor };
	}

	for (const coord of coords) {
		const key = packVoxelKey(coord.x, coord.y, coord.z);

		if (tool === "erase") {
			if (peekHasVoxel(index, overlay, coord.x, coord.y, coord.z)) {
				overlay.set(key, null);
				changed = true;
			}
			continue;
		}

		if (tool === "paint") {
			const current = peekVoxelColor(index, overlay, coord.x, coord.y, coord.z);
			if (current !== null && current !== colorIndex) {
				overlay.set(key, colorIndex);
				changed = true;
			}
			continue;
		}

		// place
		if (!peekHasVoxel(index, overlay, coord.x, coord.y, coord.z)) {
			overlay.set(key, colorIndex);
			changed = true;
		}
	}

	return {
		changed,
		sampledColor: null,
	};
}

// Cached THREE.Color instance reused for every voxel as it streams through the
// shared geometry builder. The builder copies the .r/.g/.b values into a
// Float32Array, so a single Color object is enough.
const EDITOR_VOXEL_COLOR = new THREE.Color();

function buildEditorTerrainGeometry(terrain: VoxelTerrain): THREE.BufferGeometry {
	const buffers = buildVoxelTerrainBuffers(terrain, (voxel) => {
		EDITOR_VOXEL_COLOR.set(
			terrainPaletteIndexToVoxelColor(normalizeVoxelPaletteIndex(voxel.color))
		);
		return EDITOR_VOXEL_COLOR;
	});
	const geometry = createVoxelTerrainBufferGeometry(buffers);
	geometry.boundsTree = new MeshBVH(geometry);
	return geometry;
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
	if (Array.isArray(material)) {
		for (const entry of material) entry.dispose();
		return;
	}

	material.dispose();
}

function disposeObjectTree(object: THREE.Object3D): void {
	object.traverse((child) => {
		const mesh = child as THREE.Mesh;
		if (mesh.geometry) mesh.geometry.dispose();
		if (mesh.material) disposeMaterial(mesh.material);
	});
}

function clearObjectGroup(group: THREE.Group): void {
	disposeObjectTree(group);
	group.clear();
}

function createGridLineSegments(
	points: number[],
	color: number,
	opacity: number
): THREE.LineSegments {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));

	const material = new THREE.LineBasicMaterial({
		color,
		transparent: true,
		opacity,
		depthWrite: false,
	});

	return new THREE.LineSegments(geometry, material);
}

function createBoundsFrame(
	index: VoxelTerrainIndex,
	color: number,
	opacity: number
): THREE.LineSegments {
	const minX = -index.width / 2;
	const maxX = index.width / 2;
	const minY = -0.5;
	const maxY = index.height - 0.5;
	const minZ = -index.length / 2;
	const maxZ = index.length / 2;
	const corners = [
		[minX, minY, minZ],
		[maxX, minY, minZ],
		[maxX, minY, maxZ],
		[minX, minY, maxZ],
		[minX, maxY, minZ],
		[maxX, maxY, minZ],
		[maxX, maxY, maxZ],
		[minX, maxY, maxZ],
	];
	const edges = [
		[0, 1],
		[1, 2],
		[2, 3],
		[3, 0],
		[4, 5],
		[5, 6],
		[6, 7],
		[7, 4],
		[0, 4],
		[1, 5],
		[2, 6],
		[3, 7],
	];
	const points: number[] = [];

	for (const [a, b] of edges) {
		points.push(...corners[a], ...corners[b]);
	}

	return createGridLineSegments(points, color, opacity);
}

function addTopRectangle(
	points: number[],
	minX: number,
	maxX: number,
	y: number,
	minZ: number,
	maxZ: number
): void {
	points.push(minX, y, minZ, maxX, y, minZ);
	points.push(maxX, y, minZ, maxX, y, maxZ);
	points.push(maxX, y, maxZ, minX, y, maxZ);
	points.push(minX, y, maxZ, minX, y, minZ);
}

// Iterate the terrain's top-exposed voxels (the ones whose +Y neighbor is
// empty). Used by both grid builders. The index drives the "above me empty"
// check; we still decode the terrain to walk every voxel because the index
// doesn't expose per-voxel positions (only per-tile surface heights).
function* iterateTopExposedVoxels(
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex
): Generator<Voxel> {
	for (const voxel of decodeVoxels(terrain.Voxels)) {
		if (index.hasVoxel(voxel.x, voxel.y + 1, voxel.z)) continue;
		yield voxel;
	}
}

function createVoxelSurfaceGrid(
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex,
	color: number,
	opacity: number
): THREE.LineSegments | null {
	const points: number[] = [];
	const r = index.resolution;
	const halfW = index.width / 2;
	const halfL = index.length / 2;

	for (const voxel of iterateTopExposedVoxels(terrain, index)) {
		const minX = voxel.x / r - halfW;
		const maxX = (voxel.x + 1) / r - halfW;
		const y = (voxel.y + 1) / r - 0.5 + GRID_LINE_OFFSET;
		const minZ = voxel.z / r - halfL;
		const maxZ = (voxel.z + 1) / r - halfL;
		addTopRectangle(points, minX, maxX, y, minZ, maxZ);
	}

	if (points.length === 0) return null;
	return createGridLineSegments(points, color, opacity);
}

function createTacticalSurfaceGrid(
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex,
	color: number,
	opacity: number
): THREE.LineSegments | null {
	const points: number[] = [];
	const r = index.resolution;
	const halfW = index.width / 2;
	const halfL = index.length / 2;

	for (const voxel of iterateTopExposedVoxels(terrain, index)) {
		const minX = voxel.x / r - halfW;
		const maxX = (voxel.x + 1) / r - halfW;
		const y = (voxel.y + 1) / r - 0.5 + GRID_LINE_OFFSET * 2;
		const minZ = voxel.z / r - halfL;
		const maxZ = (voxel.z + 1) / r - halfL;

		if (voxel.x % r === 0) {
			points.push(minX, y, minZ, minX, y, maxZ);
		}
		if ((voxel.x + 1) % r === 0) {
			points.push(maxX, y, minZ, maxX, y, maxZ);
		}
		if (voxel.z % r === 0) {
			points.push(minX, y, minZ, maxX, y, minZ);
		}
		if ((voxel.z + 1) % r === 0) {
			points.push(minX, y, maxZ, maxX, y, maxZ);
		}
	}

	if (points.length === 0) return null;
	return createGridLineSegments(points, color, opacity);
}

function rebuildGrid(
	resources: EditorSceneResources,
	terrain: VoxelTerrain,
	showTacticalGrid: boolean,
	showVoxelGrid: boolean
): void {
	clearObjectGroup(resources.gridGroup);

	const index = getVoxelTerrainIndex(terrain);

	if (showVoxelGrid && index.resolution > 1) {
		const voxelGrid = createVoxelSurfaceGrid(terrain, index, 0xf59e0b, 0.38);
		if (voxelGrid) resources.gridGroup.add(voxelGrid);
	}

	if (showTacticalGrid) {
		const tacticalGrid = createTacticalSurfaceGrid(terrain, index, 0x14b8a6, 0.68);
		if (tacticalGrid) resources.gridGroup.add(tacticalGrid);
	}

	resources.gridGroup.add(createBoundsFrame(index, 0xe5e7eb, 0.32));
}

function getVoxelWorldCenter(
	index: VoxelTerrainIndex,
	voxel: VoxelCoord
): THREE.Vector3 {
	const halfVoxelSize = index.voxelSize / 2;
	return new THREE.Vector3(
		voxel.x / index.resolution - index.width / 2 + halfVoxelSize,
		(voxel.y + 0.5) / index.resolution - 0.5,
		voxel.z / index.resolution - index.length / 2 + halfVoxelSize
	);
}

function getHoverColor(colorIndex: number): THREE.Color {
	const color = new THREE.Color(
		terrainPaletteIndexToVoxelColor(normalizeVoxelPaletteIndex(colorIndex))
	);
	const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;

	if (luminance > 0.62) {
		return color.multiplyScalar(0.48);
	}

	return color.lerp(new THREE.Color(0xffffff), 0.5);
}

function addVoxelFaceToGeometry(
	positions: number[],
	colors: number[],
	indices: number[],
	center: THREE.Vector3,
	voxelSize: number,
	face: (typeof VOXEL_FACE_DEFINITIONS)[number],
	color: THREE.Color,
	offset: number
): void {
	const vertexIndex = positions.length / 3;
	const [nx, ny, nz] = face.normal;

	for (const [cx, cy, cz] of face.corners) {
		positions.push(
			center.x + cx * voxelSize + nx * offset,
			center.y + cy * voxelSize + ny * offset,
			center.z + cz * voxelSize + nz * offset
		);
		colors.push(color.r, color.g, color.b);
	}

	indices.push(
		vertexIndex,
		vertexIndex + 1,
		vertexIndex + 2,
		vertexIndex,
		vertexIndex + 2,
		vertexIndex + 3
	);
}

function createHoverSurfaceGeometry(
	index: VoxelTerrainIndex,
	overlay: VoxelOverlay,
	coords: VoxelCoord[]
): THREE.BufferGeometry | null {
	const positions: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];
	const selectedKeys = new Set(coords.map((c) => packVoxelKey(c.x, c.y, c.z)));

	for (const key of selectedKeys) {
		const { x, y, z } = unpackVoxelKey(key);
		const colorIndex = peekVoxelColor(index, overlay, x, y, z);
		if (colorIndex === null) continue;

		const center = getVoxelWorldCenter(index, { x, y, z });
		const color = getHoverColor(colorIndex);

		for (const face of VOXEL_FACE_DEFINITIONS) {
			const [dx, dy, dz] = face.neighborOffset;
			if (peekHasVoxel(index, overlay, x + dx, y + dy, z + dz)) continue;

			addVoxelFaceToGeometry(
				positions,
				colors,
				indices,
				center,
				index.voxelSize,
				face,
				color,
				HOVER_FACE_OFFSET
			);
		}
	}

	if (positions.length === 0) return null;

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
	geometry.setIndex(indices);
	geometry.computeBoundingSphere();

	return geometry;
}

function createPlaceGhostGeometry(
	index: VoxelTerrainIndex,
	overlay: VoxelOverlay,
	coords: VoxelCoord[]
): THREE.BufferGeometry | null {
	const positions: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];
	const ghostKeys = new Set<number>();

	for (const coord of coords) {
		if (!isVoxelInBounds(index, coord)) continue;
		if (peekHasVoxel(index, overlay, coord.x, coord.y, coord.z)) continue;
		ghostKeys.add(packVoxelKey(coord.x, coord.y, coord.z));
	}

	const color = new THREE.Color(0xffffff);
	for (const key of ghostKeys) {
		const { x, y, z } = unpackVoxelKey(key);
		const center = getVoxelWorldCenter(index, { x, y, z });

		for (const face of VOXEL_FACE_DEFINITIONS) {
			const [dx, dy, dz] = face.neighborOffset;
			const neighborKey = packVoxelKey(x + dx, y + dy, z + dz);
			// Cull faces against either an existing voxel or another ghost in the same brush.
			if (ghostKeys.has(neighborKey)) continue;
			if (peekHasVoxel(index, overlay, x + dx, y + dy, z + dz)) continue;

			addVoxelFaceToGeometry(
				positions,
				colors,
				indices,
				center,
				index.voxelSize,
				face,
				color,
				0
			);
		}
	}

	if (positions.length === 0) return null;

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
	geometry.setIndex(indices);
	geometry.computeBoundingSphere();

	return geometry;
}

function updateHoverIndicator(
	resources: EditorSceneResources,
	index: VoxelTerrainIndex,
	overlay: VoxelOverlay,
	pick: PickInfo | null,
	tool: EditorTool,
	granularity: EditGranularity,
	brushSize: number,
	colorIndex: number
): void {
	clearObjectGroup(resources.hoverGroup);
	if (!pick) return;

	const coords =
		tool === "sample"
			? [pick.voxel]
			: collectAffectedCoords(index, pick, tool, granularity, brushSize);
	const geometry =
		tool === "place"
			? createPlaceGhostGeometry(index, overlay, coords)
			: createHoverSurfaceGeometry(index, overlay, coords);

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

function resizeRenderer(resources: EditorSceneResources, container: HTMLDivElement): void {
	const width = container.clientWidth || 1;
	const height = container.clientHeight || 1;
	const aspect = width / height;
	const halfSize = resources.camera.top;

	resources.camera.left = -halfSize * aspect;
	resources.camera.right = halfSize * aspect;
	resources.camera.updateProjectionMatrix();
	resources.renderer.setSize(width, height);
}

function frameCamera(
	resources: EditorSceneResources,
	terrain: VoxelTerrain,
	container: HTMLDivElement
): void {
	const halfSize = Math.max(
		6,
		((terrain.Width + terrain.Length) / Math.SQRT2 / 2) * 1.15,
		terrain.Height * 0.9
	);
	const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
	const camera = resources.camera;
	const controls = resources.controls;
	const terrainCenterY = Math.max(0, terrain.Height / 2 - 0.5);
	const cameraDistance = halfSize * CAMERA_DISTANCE_MULTIPLIER;

	camera.left = -halfSize * aspect;
	camera.right = halfSize * aspect;
	camera.top = halfSize;
	camera.bottom = -halfSize;
	camera.position.set(cameraDistance, cameraDistance, cameraDistance);
	camera.zoom = 1;
	camera.updateProjectionMatrix();
	controls.target.set(0, terrainCenterY, 0);
	controls.cursor.set(0, terrainCenterY, 0);
	controls.maxTargetRadius = Math.max(8, Math.sqrt(terrain.Width ** 2 + terrain.Length ** 2));
	controls.update();
}

function isTextInputTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tagName = target.tagName.toLowerCase();

	return (
		tagName === "input" ||
		tagName === "textarea" ||
		tagName === "select" ||
		target.isContentEditable
	);
}

export default function VoxelTerrainEditor({
	terrain,
	onChange,
	readOnly = false,
	actors,
}: VoxelTerrainEditorProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const resourcesRef = useRef<EditorSceneResources | null>(null);
	// Canonical committed terrain for the editor session. Updated on rAF flush
	// (stroke commit), undo/redo, and external prop changes.
	const terrainRef = useRef(terrain);
	// Pending stroke edits not yet folded into terrainRef. Cleared on rAF flush.
	const inflightOverlayRef = useRef<VoxelOverlay>(new Map());
	const toolRef = useRef<EditorTool>("place");
	const granularityRef = useRef<EditGranularity>("tactical");
	const brushSizeRef = useRef(1);
	const selectedColorRef = useRef(DEFAULT_TERRAIN_COLOR_INDEX);
	const readOnlyRef = useRef(readOnly);
	const actorsRef = useRef<ActorOverlayInfo[]>(actors ?? []);
	const showActorsRef = useRef(true);
	const actorMarkerElemsRef = useRef<Map<string, HTMLDivElement>>(new Map());
	const actorOverlayRef = useRef<HTMLDivElement>(null);
	const activeStrokeRef = useRef<ActiveStroke | null>(null);
	const strokeStartedRef = useRef(false);
	const strokeStartVoxelsRef = useRef<string | null>(null);
	const lastEditKeyRef = useRef<string | null>(null);
	const lastShapeSignatureRef = useRef<string | null>(null);
	const pendingChangeFrameRef = useRef<number | null>(null);
	const hasPendingVoxelChangeRef = useRef(false);
	// Last terrain.Voxels we emitted via onChange. Used to recognise our own
	// echo in the terrain prop useEffect (so we don't re-adopt our own emit).
	const lastEmittedVoxelsRef = useRef(terrain.Voxels);

	const [activeView, setActiveView] = useState<EditorView>("edit");
	const [tool, setTool] = useState<EditorTool>("place");
	const [granularity, setGranularity] = useState<EditGranularity>("tactical");
	const [brushSize, setBrushSize] = useState(1);
	const [selectedColorIndex, setSelectedColorIndex] = useState(DEFAULT_TERRAIN_COLOR_INDEX);
	const [showTacticalGrid, setShowTacticalGrid] = useState(true);
	const [showVoxelGrid, setShowVoxelGrid] = useState(true);
	const [showActors, setShowActors] = useState(true);
	const [undoStack, setUndoStack] = useState<string[]>([]);
	const [redoStack, setRedoStack] = useState<string[]>([]);
	const [voxImportModal, setVoxImportModal] = useState<VoxImportModal | null>(null);
	const voxFileInputRef = useRef<HTMLInputElement>(null);
	// editGen ticks whenever terrainRef.current changes (stroke commit, undo,
	// redo, external prop). Geometry + grid useEffects key on it. Refs alone
	// would be invisible to React; this is the single change-trigger.
	const [editGen, setEditGen] = useState(0);
	const bumpEditGen = useCallback(() => setEditGen((g) => g + 1), []);

	// terrainRef.current is the committed terrain. The sidebar reflects it
	// (overlay-in-progress voxels appear after the next rAF flush, at most a
	// frame later -- the same cadence the editor used previously).
	// `editGen` is read here purely to opt this expression into React's
	// re-render cycle whenever the terrain changes.
	void editGen;
	const displayedTerrain = terrainRef.current;
	const voxelCount = getVoxelTerrainIndex(displayedTerrain).voxelCount;
	const selectedTool = TOOL_BUTTONS.find((button) => button.id === tool) ?? TOOL_BUTTONS[0];
	const resolution = getVoxelTerrainResolution(displayedTerrain);
	const tileDimensions = `${displayedTerrain.Width} x ${displayedTerrain.Length} x ${displayedTerrain.Height}`;
	const voxelDimensions = `${displayedTerrain.Width * resolution} x ${displayedTerrain.Length * resolution} x ${
		displayedTerrain.Height * resolution
	}`;
	const brushModeLabel = granularity === "tactical" ? "Tile Brush" : "Voxel Brush";

	useEffect(() => {
		// Adopt the prop only when it's a genuinely external change. After our
		// own rAF flush, terrain.Voxels === lastEmittedVoxelsRef.current and the
		// shape signature matches terrainRef -- skip then.
		if (
			createTerrainRevision(terrain) === createTerrainRevision(terrainRef.current) &&
			terrain.Voxels === lastEmittedVoxelsRef.current
		) {
			return;
		}

		// External change (resize, VOX import, initial mount on prop swap):
		// drop any pending stroke and adopt the new terrain.
		if (pendingChangeFrameRef.current !== null) {
			cancelAnimationFrame(pendingChangeFrameRef.current);
			pendingChangeFrameRef.current = null;
		}
		hasPendingVoxelChangeRef.current = false;
		inflightOverlayRef.current.clear();
		terrainRef.current = terrain;
		lastEmittedVoxelsRef.current = terrain.Voxels;
		bumpEditGen();
	}, [terrain, bumpEditGen]);

	useEffect(() => {
		toolRef.current = tool;
		granularityRef.current = granularity;
		brushSizeRef.current = brushSize;
		selectedColorRef.current = selectedColorIndex;
		readOnlyRef.current = readOnly;
	}, [tool, granularity, brushSize, selectedColorIndex, readOnly]);

	useEffect(() => { actorsRef.current = actors ?? []; }, [actors]);
	useEffect(() => { showActorsRef.current = showActors; }, [showActors]);

	useEffect(() => {
		setUndoStack([]);
		setRedoStack([]);
		lastShapeSignatureRef.current = null;
	}, [terrain.Id]);

	const recordUndo = useCallback((voxels: string) => {
		setUndoStack((current) => [...current.slice(-(UNDO_LIMIT - 1)), voxels]);
		setRedoStack([]);
	}, []);

	const flushPendingTerrainChange = useCallback(() => {
		if (pendingChangeFrameRef.current !== null) {
			cancelAnimationFrame(pendingChangeFrameRef.current);
			pendingChangeFrameRef.current = null;
		}
		if (!hasPendingVoxelChangeRef.current) return;

		hasPendingVoxelChangeRef.current = false;
		const nextTerrain = commitOverlayToTerrain(
			terrainRef.current,
			inflightOverlayRef.current
		);
		inflightOverlayRef.current.clear();
		terrainRef.current = nextTerrain;
		lastEmittedVoxelsRef.current = nextTerrain.Voxels;
		bumpEditGen();
		onChange(nextTerrain);
	}, [bumpEditGen, onChange]);

	const schedulePendingTerrainChange = useCallback(() => {
		hasPendingVoxelChangeRef.current = true;
		if (pendingChangeFrameRef.current !== null) return;

		pendingChangeFrameRef.current = requestAnimationFrame(() => {
			pendingChangeFrameRef.current = null;
			flushPendingTerrainChange();
		});
	}, [flushPendingTerrainChange]);

	const undo = useCallback(() => {
		if (undoStack.length === 0) return;
		flushPendingTerrainChange();
		const currentTerrain = terrainRef.current;
		const previousVoxels = undoStack[undoStack.length - 1];
		const nextTerrain = { ...currentTerrain, Voxels: previousVoxels };

		inflightOverlayRef.current.clear();
		terrainRef.current = nextTerrain;
		lastEmittedVoxelsRef.current = previousVoxels;
		setUndoStack((current) => current.slice(0, -1));
		setRedoStack((current) => [currentTerrain.Voxels, ...current].slice(0, UNDO_LIMIT));
		bumpEditGen();
		onChange(nextTerrain);
	}, [bumpEditGen, flushPendingTerrainChange, onChange, undoStack]);

	const redo = useCallback(() => {
		if (redoStack.length === 0) return;
		flushPendingTerrainChange();
		const currentTerrain = terrainRef.current;
		const nextVoxels = redoStack[0];
		const nextTerrain = { ...currentTerrain, Voxels: nextVoxels };

		inflightOverlayRef.current.clear();
		terrainRef.current = nextTerrain;
		lastEmittedVoxelsRef.current = nextVoxels;
		setRedoStack((current) => current.slice(1));
		setUndoStack((current) => [...current.slice(-(UNDO_LIMIT - 1)), currentTerrain.Voxels]);
		bumpEditGen();
		onChange(nextTerrain);
	}, [bumpEditGen, flushPendingTerrainChange, onChange, redoStack]);

	// Rebuild imperative actor marker elements whenever the actors list changes.
	// Position updates happen in the rAF loop (updateActorMarkers) so React
	// re-renders are not needed at 60 fps.
	useEffect(() => {
		const overlay = actorOverlayRef.current;
		if (!overlay) return;

		while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
		const newMap = new Map<string, HTMLDivElement>();

		for (const actor of actors ?? []) {
			const wrapper = document.createElement("div");
			// DaisyUI tooltip: show actor name on hover without any extra JS
			wrapper.className = "tooltip tooltip-top";
			wrapper.setAttribute("data-tip", actor.name);
			wrapper.style.position = "absolute";
			wrapper.style.left = "0";
			wrapper.style.top = "0";
			wrapper.style.display = "none";
			// allow hover for the tooltip but keep the dot small so it
			// rarely blocks editing clicks
			wrapper.style.pointerEvents = "auto";
			wrapper.style.zIndex = "10";

			const dot = document.createElement("div");
			dot.style.width = "14px";
			dot.style.height = "14px";
			dot.style.borderRadius = "50%";
			dot.style.background = "rgba(167, 139, 250, 0.65)";
			dot.style.border = "1.5px solid rgba(167, 139, 250, 0.9)";
			dot.style.boxShadow = "0 1px 3px rgba(0,0,0,0.45)";

			wrapper.appendChild(dot);
			overlay.appendChild(wrapper);
			newMap.set(actor.id, wrapper);
		}

		actorMarkerElemsRef.current = newMap;
	}, [actors]);

	const getPickInfo = useCallback((event: PointerEvent): PickInfo | null => {
		const resources = resourcesRef.current;
		const container = containerRef.current;
		if (!resources || !container) return null;

		const index = getVoxelTerrainIndex(terrainRef.current);

		const rect = resources.renderer.domElement.getBoundingClientRect();
		const mouse = new THREE.Vector2(
			((event.clientX - rect.left) / rect.width) * 2 - 1,
			-((event.clientY - rect.top) / rect.height) * 2 + 1
		);

		resources.raycaster.setFromCamera(mouse, resources.camera);

		if (resources.terrainMesh) {
			const intersections = resources.raycaster.intersectObject(resources.terrainMesh, false);
			const hit = intersections[0];

			if (hit?.face) {
				const normal = hit.face.normal.clone().normalize();
				const insidePoint = hit.point
					.clone()
					.addScaledVector(normal, -PICK_EPSILON);
				const voxel = pointToVoxelCoord(insidePoint, index);

				if (isVoxelInBounds(index, voxel)) {
					return {
						voxel,
						normal: normalToCoord(normal),
						ground: false,
						plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point),
					};
				}
			}
		}

		const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.5);
		const groundPoint = new THREE.Vector3();
		if (!resources.raycaster.ray.intersectPlane(groundPlane, groundPoint)) {
			return null;
		}

		const voxel = {
			x: Math.floor((groundPoint.x + index.width / 2) * index.resolution),
			y: 0,
			z: Math.floor((groundPoint.z + index.length / 2) * index.resolution),
		};

		if (!isVoxelInBounds(index, voxel)) return null;

		return {
			voxel,
			normal: { x: 0, y: 1, z: 0 },
			ground: true,
			plane: groundPlane.clone(),
		};
	}, []);

	const getLockedPlanePickInfo = useCallback((
		event: PointerEvent,
		lockedPlane: LockedStrokePlane
	): PickInfo | null => {
		const resources = resourcesRef.current;
		if (!resources) return null;

		const index = getVoxelTerrainIndex(terrainRef.current);

		const rect = resources.renderer.domElement.getBoundingClientRect();
		const mouse = new THREE.Vector2(
			((event.clientX - rect.left) / rect.width) * 2 - 1,
			-((event.clientY - rect.top) / rect.height) * 2 + 1
		);

		resources.raycaster.setFromCamera(mouse, resources.camera);

		const intersectionPoint = new THREE.Vector3();
		if (!resources.raycaster.ray.intersectPlane(lockedPlane.plane, intersectionPoint)) {
			return null;
		}

		const voxel = lockedPlane.ground
			? {
				x: Math.floor((intersectionPoint.x + index.width / 2) * index.resolution),
				y: 0,
				z: Math.floor((intersectionPoint.z + index.length / 2) * index.resolution),
			}
			: pointToVoxelCoord(
				intersectionPoint
					.clone()
					.addScaledVector(
						new THREE.Vector3(
							lockedPlane.normal.x,
							lockedPlane.normal.y,
							lockedPlane.normal.z
						).normalize(),
						-PICK_EPSILON
					),
				index
			);

		if (!isVoxelInBounds(index, voxel)) return null;

		return {
			voxel,
			normal: { ...lockedPlane.normal },
			ground: lockedPlane.ground,
			plane: lockedPlane.plane.clone(),
		};
	}, []);

	const applyEdit = useCallback((pick: PickInfo): boolean => {
		if (readOnlyRef.current) return false;

		const currentTerrain = terrainRef.current;
		const result = applyVoxelEdit(
			getVoxelTerrainIndex(currentTerrain),
			inflightOverlayRef.current,
			pick,
			toolRef.current,
			granularityRef.current,
			brushSizeRef.current,
			selectedColorRef.current
		);

		if (result.sampledColor !== null) {
			selectedColorRef.current = result.sampledColor;
			setSelectedColorIndex(result.sampledColor);
			toolRef.current = "paint";
			setTool("paint");
			return false;
		}

		if (!result.changed) return false;

		if (!strokeStartedRef.current) {
			recordUndo(strokeStartVoxelsRef.current ?? currentTerrain.Voxels);
			strokeStartedRef.current = true;
		}

		schedulePendingTerrainChange();
		return true;
	}, [recordUndo, schedulePendingTerrainChange]);

	const getEditKey = useCallback((pick: PickInfo): string => {
		return [
			toolRef.current,
			granularityRef.current,
			brushSizeRef.current,
			pick.voxel.x,
			pick.voxel.y,
			pick.voxel.z,
			pick.normal.x,
			pick.normal.y,
			pick.normal.z,
		].join(":");
	}, []);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const renderer = new THREE.WebGLRenderer({
			antialias: false,
			alpha: true,
			powerPreference: "high-performance",
		});
		renderer.setPixelRatio(EDITOR_PIXEL_RATIO);
		renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.domElement.style.touchAction = "none";
		renderer.domElement.style.cursor = readOnlyRef.current ? "default" : "crosshair";
		container.appendChild(renderer.domElement);

		const scene = new THREE.Scene();
		scene.background = null;

		const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
		const camera = new THREE.OrthographicCamera(
			-INITIAL_CAMERA_HALF_SIZE * aspect,
			INITIAL_CAMERA_HALF_SIZE * aspect,
			INITIAL_CAMERA_HALF_SIZE,
			-INITIAL_CAMERA_HALF_SIZE,
			-100,
			1000
		);
		const initialDistance = INITIAL_CAMERA_HALF_SIZE * CAMERA_DISTANCE_MULTIPLIER;
		camera.position.set(initialDistance, initialDistance, initialDistance);

		const hemi = new THREE.HemisphereLight(0xffffff, 0x94a3b8, Math.PI * 0.75);
		scene.add(hemi);

		const directional = new THREE.DirectionalLight(0xffffff, Math.PI * 1.6);
		directional.position.set(18, 32, 22);
		scene.add(directional);

		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		controls.dampingFactor = 0.08;
		controls.minZoom = 0.4;
		controls.maxZoom = 10;
		controls.mouseButtons.LEFT = null as unknown as THREE.MOUSE;
		controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
		controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
		controls.update();

		const gridGroup = new THREE.Group();
		scene.add(gridGroup);

		const hoverGroup = new THREE.Group();
		scene.add(hoverGroup);

		const terrainMaterial = new THREE.MeshStandardMaterial({
			roughness: 0.78,
			metalness: 0,
			vertexColors: true,
		});

		const resources: EditorSceneResources = {
			scene,
			camera,
			renderer,
			controls,
			raycaster: new THREE.Raycaster(),
			gridGroup,
			hoverGroup,
			terrainMesh: null,
			terrainMaterial,
		};
		resourcesRef.current = resources;

		// Projects actor world positions to screen space and moves the
		// imperative marker elements. Called every rAF frame so they track
		// camera orbits and zooms with no React re-renders.
		const updateActorMarkers = () => {
			const overlay = actorOverlayRef.current;
			const markerElems = actorMarkerElemsRef.current;
			const currentActors = actorsRef.current;
			const shouldShow = showActorsRef.current;

			if (!overlay || markerElems.size === 0) return;

			if (!shouldShow) {
				markerElems.forEach(el => { el.style.display = "none"; });
				return;
			}

			const currentTerrain = terrainRef.current;
			const canvasW = renderer.domElement.clientWidth || 1;
			const canvasH = renderer.domElement.clientHeight || 1;

			for (const actor of currentActors) {
				const el = markerElems.get(actor.id);
				if (!el) continue;

				// Convert tactical coords to world space. Position.x/y are tile
				// col/row; h is tactical height level. Use the same helper the
				// main 3D map uses so we stay in sync with future offset changes.
				const worldX = actor.position.x + 0.5 - currentTerrain.Width / 2;
				const worldZ = actor.position.y + 0.5 - currentTerrain.Length / 2;
				const worldY = terrainHeightToWorldY(actor.position.h) + ACTOR_OVERLAY_FLOAT_Y;

				const vec = new THREE.Vector3(worldX, worldY, worldZ);
				vec.project(camera);

				// Behind the near plane - hide
				if (vec.z > 1) {
					el.style.display = "none";
					continue;
				}

				const screenX = ((vec.x + 1) / 2) * canvasW;
				const screenY = ((-vec.y + 1) / 2) * canvasH;

				el.style.display = "";
				el.style.transform = `translate(calc(${screenX}px - 50%), calc(${screenY}px - 50%))`;
			}
		};

		let rafId = 0;
		const animate = () => {
			rafId = requestAnimationFrame(animate);
			controls.update();
			renderer.render(scene, camera);
			updateActorMarkers();
		};
		animate();

		const resizeObserver = new ResizeObserver(() => {
			resizeRenderer(resources, container);
		});
		resizeObserver.observe(container);

		const refreshHover = (pick: PickInfo | null) => {
			updateHoverIndicator(
				resources,
				getVoxelTerrainIndex(terrainRef.current),
				inflightOverlayRef.current,
				pick,
				toolRef.current,
				granularityRef.current,
				brushSizeRef.current,
				selectedColorRef.current
			);
		};

		const getPickForStroke = (
			event: PointerEvent,
			activeStroke: ActiveStroke | null
		): PickInfo | null => {
			if (activeStroke && !event.shiftKey) {
				return getLockedPlanePickInfo(event, activeStroke.lockedPlane);
			}

			return getPickInfo(event);
		};

		const hasMovedPastDragThreshold = (
			event: PointerEvent,
			activeStroke: ActiveStroke
		): boolean => {
			const dx = event.clientX - activeStroke.startClientX;
			const dy = event.clientY - activeStroke.startClientY;

			return dx * dx + dy * dy >= STROKE_DRAG_THRESHOLD_PX ** 2;
		};

		const clearStrokeState = () => {
			activeStrokeRef.current = null;
			strokeStartedRef.current = false;
			strokeStartVoxelsRef.current = null;
			lastEditKeyRef.current = null;
		};

		const handlePointerMove = (event: PointerEvent) => {
			const activeStroke =
				activeStrokeRef.current?.pointerId === event.pointerId
					? activeStrokeRef.current
					: null;
			const pick = getPickForStroke(event, activeStroke);
			refreshHover(pick);
			if (!activeStroke || !pick || toolRef.current === "sample") return;

			if (!activeStroke.dragStarted) {
				if (!hasMovedPastDragThreshold(event, activeStroke)) return;
				activeStroke.dragStarted = true;
			}

			const editKey = getEditKey(pick);
			if (lastEditKeyRef.current === editKey) return;
			lastEditKeyRef.current = editKey;

			applyEdit(pick);
			refreshHover(getPickForStroke(event, activeStroke));
		};

		const handlePointerDown = (event: PointerEvent) => {
			if (event.button === 1) {
				event.preventDefault();
				return;
			}
			if (event.button !== 0 || readOnlyRef.current) return;

			event.preventDefault();
			flushPendingTerrainChange();
			const pick = getPickInfo(event);
			if (!pick) return;

			renderer.domElement.setPointerCapture(event.pointerId);
			const activeStroke: ActiveStroke = {
				pointerId: event.pointerId,
				startClientX: event.clientX,
				startClientY: event.clientY,
				dragStarted: false,
				lockedPlane: {
					plane: pick.plane.clone(),
					normal: { ...pick.normal },
					ground: pick.ground,
				},
			};
			activeStrokeRef.current = activeStroke;
			strokeStartedRef.current = false;
			strokeStartVoxelsRef.current = terrainRef.current.Voxels;
			lastEditKeyRef.current = null;

			const wasSampleTool = toolRef.current === "sample";
			lastEditKeyRef.current = getEditKey(pick);
			applyEdit(pick);
			refreshHover(getPickForStroke(event, activeStroke));
			if (wasSampleTool) {
				renderer.domElement.releasePointerCapture(event.pointerId);
				clearStrokeState();
			}
		};

		const finishStroke = (event: PointerEvent) => {
			if (
				activeStrokeRef.current &&
				activeStrokeRef.current.pointerId !== event.pointerId
			) {
				return;
			}

			if (renderer.domElement.hasPointerCapture(event.pointerId)) {
				renderer.domElement.releasePointerCapture(event.pointerId);
			}

			flushPendingTerrainChange();
			clearStrokeState();
		};

		const handlePointerLeave = () => {
			if (!activeStrokeRef.current) {
				refreshHover(null);
			}
		};

		const preventContextMenu = (event: MouseEvent) => event.preventDefault();
		const preventMiddleMouseScroll = (event: MouseEvent) => {
			if (event.button === 1) event.preventDefault();
		};

		renderer.domElement.addEventListener("pointermove", handlePointerMove);
		renderer.domElement.addEventListener("pointerdown", handlePointerDown, true);
		renderer.domElement.addEventListener("pointerup", finishStroke);
		renderer.domElement.addEventListener("pointercancel", finishStroke);
		renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
		renderer.domElement.addEventListener("mousedown", preventMiddleMouseScroll, true);
		renderer.domElement.addEventListener("auxclick", preventMiddleMouseScroll);
		renderer.domElement.addEventListener("contextmenu", preventContextMenu);

		return () => {
			cancelAnimationFrame(rafId);
			resizeObserver.disconnect();
			renderer.domElement.removeEventListener("pointermove", handlePointerMove);
			renderer.domElement.removeEventListener("pointerdown", handlePointerDown, true);
			renderer.domElement.removeEventListener("pointerup", finishStroke);
			renderer.domElement.removeEventListener("pointercancel", finishStroke);
			renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
			renderer.domElement.removeEventListener("mousedown", preventMiddleMouseScroll, true);
			renderer.domElement.removeEventListener("auxclick", preventMiddleMouseScroll);
			renderer.domElement.removeEventListener("contextmenu", preventContextMenu);
			controls.dispose();
			if (resources.terrainMesh) {
				resources.scene.remove(resources.terrainMesh);
				resources.terrainMesh.geometry.dispose();
			}
			terrainMaterial.dispose();
			disposeObjectTree(gridGroup);
			disposeObjectTree(hoverGroup);
			renderer.dispose();
			if (renderer.domElement.parentElement === container) {
				container.removeChild(renderer.domElement);
			}
			if (pendingChangeFrameRef.current !== null) {
				cancelAnimationFrame(pendingChangeFrameRef.current);
				pendingChangeFrameRef.current = null;
			}
			activeStrokeRef.current = null;
			resourcesRef.current = null;
		};
	}, [applyEdit, flushPendingTerrainChange, getEditKey, getLockedPlanePickInfo, getPickInfo]);

	useEffect(() => {
		const resources = resourcesRef.current;
		const container = containerRef.current;
		if (!resources || !container) return;

		const terrain = terrainRef.current;
		const index = getVoxelTerrainIndex(terrain);
		const shapeSignature = `${index.width}:${index.length}:${index.height}:${index.resolution}`;
		const shapeChanged = lastShapeSignatureRef.current !== shapeSignature;

		if (shapeChanged) {
			clearObjectGroup(resources.hoverGroup);
		}

		if (resources.terrainMesh) {
			resources.scene.remove(resources.terrainMesh);
			resources.terrainMesh.geometry.dispose();
			resources.terrainMesh = null;
		}

		if (index.voxelCount > 0) {
			const geometry = buildEditorTerrainGeometry(terrain);
			const mesh = new THREE.Mesh(geometry, resources.terrainMaterial);
			mesh.raycast = acceleratedRaycast;
			resources.scene.add(mesh);
			resources.terrainMesh = mesh;
		}

		if (shapeChanged) {
			frameCamera(resources, terrain, container);
			lastShapeSignatureRef.current = shapeSignature;
		}
	}, [editGen]);

	useEffect(() => {
		const resources = resourcesRef.current;
		if (!resources) return;
		rebuildGrid(
			resources,
			terrainRef.current,
			showTacticalGrid,
			showVoxelGrid
		);
	}, [editGen, showTacticalGrid, showVoxelGrid]);

	useEffect(() => {
		const resources = resourcesRef.current;
		const container = containerRef.current;
		if (!resources || !container || activeView !== "edit") return;
		resizeRenderer(resources, container);
	}, [activeView]);

	useEffect(() => {
		const resources = resourcesRef.current;
		if (!resources) return;
		resources.renderer.domElement.style.cursor = readOnly ? "default" : "crosshair";
	}, [readOnly]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (isTextInputTarget(event.target)) return;

			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
				event.preventDefault();
				if (event.shiftKey) redo();
				else undo();
				return;
			}

			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
				event.preventDefault();
				redo();
				return;
			}

			if (event.ctrlKey || event.metaKey || event.altKey) return;

			switch (event.key.toLowerCase()) {
				case "p":
				case "t":
					setTool("place");
					break;
				case "r":
					setTool("erase");
					break;
				case "g":
					setTool("paint");
					break;
				case "i":
					setTool("sample");
					break;
				case "1":
					setGranularity("tactical");
					break;
				case "2":
					setGranularity("voxel");
					break;
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [redo, undo]);

	const handleBrushSizeChange = (value: number) => {
		setBrushSize(clamp(Math.floor(value) || MIN_BRUSH_SIZE, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE));
	};

	// VOX import handlers -----------------------------------------------------

	const handleVoxImportClick = () => {
		voxFileInputRef.current?.click();
	};

	const handleVoxFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		e.target.value = ""; // allow re-selecting the same file

		try {
			const buffer = await file.arrayBuffer();
			const parsed = parseVoxFile(buffer);
			const options = getVoxResolutionOptions(parsed);
			const validOptions = options.filter((o) => o.fits);

			if (validOptions.length === 0) {
				setVoxImportModal({
					kind: "error",
					message: `This file's dimensions (${parsed.voxWidth}×${parsed.voxLength}×${parsed.voxHeight} voxels) are too large to import at any resolution. Maximum terrain size is 64×64×64 tactical units.`,
				});
				return;
			}

			if (validOptions.length === 1) {
				applyVoxImport(parsed, validOptions[0].resolution);
				return;
			}

			setVoxImportModal({
				kind: "pick",
				parsed,
				options,
				selected: validOptions[0].resolution,
			});
		} catch (err) {
			setVoxImportModal({
				kind: "error",
				message: err instanceof Error ? err.message : "Failed to parse .vox file.",
			});
		}
	};

	const applyVoxImport = useCallback(
		(parsed: VoxParseResult, resolution: number) => {
			const result = buildTerrainFromVox(parsed, resolution);
			const nextTerrain = { ...terrainRef.current, ...result };
			setUndoStack([]);
			setRedoStack([]);
			setVoxImportModal(null);
			onChange(nextTerrain);
		},
		[onChange],
	);

	// -------------------------------------------------------------------------

	return (
		<>
		<div className="border-2 rounded-lg bg-base-100 min-h-152 h-[72dvh] flex overflow-hidden">
			<div className="flex-1 min-w-0 flex flex-col">
				<div className="min-h-16 shrink-0 border-b-2 bg-base-100 px-3 py-2 flex flex-wrap items-center justify-between gap-3">
					<div className="flex flex-wrap items-center gap-3">
						<div className="join">
							{TOOL_BUTTONS.map((button) => (
								<button
									key={button.id}
									type="button"
									className={`btn btn-square btn-sm join-item ${tool === button.id ? "btn-neutral" : "btn-outline"}`}
									onClick={() => setTool(button.id)}
									title={`${button.label} (${button.shortcut})`}
									aria-label={`${button.label} (shortcut ${button.shortcut})`}
								>
									<span className={`${button.icon} w-5 h-5`} />
								</button>
							))}
						</div>

						<div className="flex items-center gap-2">
							<span className="text-xs font-medium text-base-content/70">Brush</span>
							<input
								type="range"
								min={MIN_BRUSH_SIZE}
								max={MAX_BRUSH_SIZE}
								value={brushSize}
								onChange={(event) => handleBrushSizeChange(Number(event.target.value))}
								className="range range-sm range-primary w-28"
								disabled={readOnly}
								title="Brush size"
							/>
							<input
								type="number"
								min={MIN_BRUSH_SIZE}
								max={MAX_BRUSH_SIZE}
								value={brushSize}
								onChange={(event) => handleBrushSizeChange(Number(event.target.value))}
								className="input input-bordered input-sm w-14"
								disabled={readOnly}
								readOnly={readOnly}
								aria-label="Brush size"
							/>
						</div>

						<div className="join">
							<button
								type="button"
								className={`btn btn-sm join-item ${granularity === "tactical" ? "btn-primary" : "btn-outline"}`}
								onClick={() => setGranularity("tactical")}
								title="Tile Brush (1)"
							>
								Tile Brush
							</button>
							<button
								type="button"
								className={`btn btn-sm join-item ${granularity === "voxel" ? "btn-primary" : "btn-outline"}`}
								onClick={() => setGranularity("voxel")}
								title="Voxel Brush (2)"
							>
								Voxel Brush
							</button>
						</div>

						<div className="join">
							<button
								type="button"
								className="btn btn-square btn-sm join-item btn-outline"
								onClick={undo}
								disabled={undoStack.length === 0 || readOnly}
								title={`Undo (${MOD_KEY_LABEL}+Z)`}
								aria-label={`Undo (${MOD_KEY_LABEL}+Z)`}
							>
								<span className="icon-[mdi--undo] w-5 h-5" />
							</button>
							<button
								type="button"
								className="btn btn-square btn-sm join-item btn-outline"
								onClick={redo}
								disabled={redoStack.length === 0 || readOnly}
								title={`Redo (${MOD_KEY_LABEL}+Shift+Z or ${MOD_KEY_LABEL}+Y)`}
								aria-label={`Redo (${MOD_KEY_LABEL}+Shift+Z or ${MOD_KEY_LABEL}+Y)`}
							>
								<span className="icon-[mdi--redo] w-5 h-5" />
							</button>
						</div>

						<div className="dropdown dropdown-bottom dropdown-end">
							<div
								tabIndex={0}
								role="button"
								className="btn btn-square btn-sm btn-outline"
								title="Keyboard shortcuts"
								aria-label="Keyboard shortcuts"
							>
								<span className="icon-[mdi--help-circle-outline] w-5 h-5" />
							</div>
							<div
								tabIndex={0}
								className="dropdown-content z-50 mt-2 w-80 rounded-box border border-base-300 bg-base-100 p-3 shadow-lg text-sm"
							>
								<div className="font-semibold mb-2">Tools</div>
								<table className="w-full">
									<tbody>
										<tr>
											<td className="opacity-70 py-0.5">Place</td>
											<td className="text-right"><kbd className="kbd kbd-sm">P</kbd></td>
										</tr>
										<tr>
											<td className="opacity-70 py-0.5">Erase</td>
											<td className="text-right"><kbd className="kbd kbd-sm">R</kbd></td>
										</tr>
										<tr>
											<td className="opacity-70 py-0.5">Paint</td>
											<td className="text-right"><kbd className="kbd kbd-sm">G</kbd></td>
										</tr>
										<tr>
											<td className="opacity-70 py-0.5">Sample (eyedropper)</td>
											<td className="text-right"><kbd className="kbd kbd-sm">I</kbd></td>
										</tr>
										<tr>
											<td className="opacity-70 py-0.5">Tile brush</td>
											<td className="text-right"><kbd className="kbd kbd-sm">1</kbd></td>
										</tr>
										<tr>
											<td className="opacity-70 py-0.5">Voxel brush</td>
											<td className="text-right"><kbd className="kbd kbd-sm">2</kbd></td>
										</tr>
										<tr>
											<td className="opacity-70 py-0.5">Undo</td>
											<td className="text-right whitespace-nowrap">
												<kbd className="kbd kbd-sm">{MOD_KEY_LABEL}</kbd>
												<span className="mx-1 opacity-50">+</span>
												<kbd className="kbd kbd-sm">Z</kbd>
											</td>
										</tr>
										<tr>
											<td className="opacity-70 py-0.5">Redo</td>
											<td className="text-right whitespace-nowrap">
												<kbd className="kbd kbd-sm">{MOD_KEY_LABEL}</kbd>
												<span className="mx-1 opacity-50">+</span>
												<kbd className="kbd kbd-sm">Y</kbd>
											</td>
										</tr>
									</tbody>
								</table>

								<div className="mt-3 pt-2 border-t border-base-300">
									<div className="font-semibold mb-2">Camera</div>
									<table className="w-full">
										<tbody>
											<tr>
												<td className="opacity-70 py-0.5">Paint / pick</td>
												<td className="text-right whitespace-nowrap">
													<kbd className="kbd kbd-sm">Left&nbsp;click</kbd>
												</td>
											</tr>
											<tr>
												<td className="opacity-70 py-0.5">Orbit / rotate</td>
												<td className="text-right whitespace-nowrap">
													<kbd className="kbd kbd-sm">Middle&nbsp;drag</kbd>
												</td>
											</tr>
											<tr>
												<td className="opacity-70 py-0.5">Pan</td>
												<td className="text-right whitespace-nowrap">
													<kbd className="kbd kbd-sm">Right&nbsp;drag</kbd>
												</td>
											</tr>
											<tr>
												<td className="opacity-70 py-0.5">Zoom</td>
												<td className="text-right whitespace-nowrap">
													<kbd className="kbd kbd-sm">Scroll</kbd>
												</td>
											</tr>
										</tbody>
									</table>
								</div>

								<div className="mt-3 pt-2 border-t border-base-300 text-xs leading-relaxed">
									<div className="font-semibold mb-1">Mid-stroke modifier</div>
									<div className="opacity-80">
										While dragging a stroke, hold{" "}
										<kbd className="kbd kbd-xs">Shift</kbd> to break out of the
										locked plane and paint across faces.
									</div>
								</div>
							</div>
						</div>
					</div>

					<div className="flex items-center gap-2">
						{!readOnly && (
							<>
								<button
									type="button"
									className="btn btn-sm btn-outline"
									onClick={handleVoxImportClick}
									title="Import a MagicaVoxel .vox file"
								>
									<span className="icon-[mdi--cube-send] w-4 h-4" />
									Import .vox
								</button>
								<input
									ref={voxFileInputRef}
									type="file"
									accept=".vox"
									className="hidden"
									onChange={handleVoxFileChange}
								/>
							</>
						)}
						<div className="join">
							<button
								type="button"
								className={`btn btn-sm join-item ${activeView === "edit" ? "btn-neutral" : "btn-outline"}`}
								onClick={() => setActiveView("edit")}
							>
								Edit
							</button>
							<button
								type="button"
								className={`btn btn-sm join-item ${activeView === "preview" ? "btn-neutral" : "btn-outline"}`}
								onClick={() => setActiveView("preview")}
							>
								Preview
							</button>
						</div>
					</div>
				</div>

				<div className="relative flex-1 min-h-0 bg-base-200">
					<div className={activeView === "edit" ? "absolute inset-0" : "hidden"}>
						<div ref={containerRef} className="absolute inset-0" />
						{/* Actor overlay: markers are injected imperatively in the rAF loop */}
						<div ref={actorOverlayRef} className="absolute inset-0 pointer-events-none overflow-hidden" />
					</div>
					{activeView === "preview" && (
						<div className="absolute inset-0">
							<MapStateProvider>
								<ThreeDMap terrain={terrain} />
							</MapStateProvider>
						</div>
					)}
				</div>
			</div>

			<div className="w-64 shrink-0 border-l-2 bg-base-100 p-3 overflow-y-auto">
				<div className="space-y-5">
					<div>
						<div className="text-sm font-semibold mb-2">Info</div>
						<div className="space-y-1 text-xs text-base-content/75">
							<div className="flex justify-between gap-3">
								<span>Tool</span>
								<span className="font-medium text-base-content">{selectedTool.label}</span>
							</div>
							<div className="flex justify-between gap-3">
								<span>Brush</span>
								<span className="font-medium text-base-content">
									{brushModeLabel} {brushSize}
								</span>
							</div>
							<div className="flex justify-between gap-3">
								<span>Tiles W x L x H</span>
								<span className="font-medium text-base-content">{tileDimensions}</span>
							</div>
							<div className="flex justify-between gap-3">
								<span>Voxels W x L x H</span>
								<span className="font-medium text-base-content">{voxelDimensions}</span>
							</div>
							<div className="flex justify-between gap-3">
								<span>Count</span>
								<span className="font-medium text-base-content">
									{voxelCount.toLocaleString()}
								</span>
							</div>
						</div>
					</div>

					<div>
						<div className="text-sm font-semibold mb-2">Color</div>
						<div
							className="grid"
							style={{ gridTemplateColumns: `repeat(${TERRAIN_PALETTE_ROWS}, 1fr)` }}
						>
							{TERRAIN_PALETTE.map((color, index) => (
								<button
									key={index}
									type="button"
									className={`aspect-square${selectedColorIndex === index ? " ring-2 ring-base-content ring-inset" : ""}`}
									style={{ backgroundColor: color }}
									onClick={() => setSelectedColorIndex(index)}
									title={`Color ${index}`}
									aria-label={`Color ${index}`}
								/>
							))}
						</div>
					</div>

					<div>
						<div className="text-sm font-semibold mb-2">Grid</div>
						<div className="flex flex-col gap-2">
							<label className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-base-300 px-3 py-2">
								<span className="label-text">Tile Grid</span>
								<input
									type="checkbox"
									className="toggle toggle-sm toggle-primary"
									checked={showTacticalGrid}
									onChange={(event) => setShowTacticalGrid(event.target.checked)}
								/>
							</label>
							<label className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-base-300 px-3 py-2">
								<span className="label-text">Voxel Grid</span>
								<input
									type="checkbox"
									className="toggle toggle-sm toggle-warning"
									checked={showVoxelGrid}
									onChange={(event) => setShowVoxelGrid(event.target.checked)}
								/>
							</label>
						</div>
					</div>

					{actors && actors.length > 0 && (
						<div>
							<div className="text-sm font-semibold mb-2">Actors</div>
							<div className="flex flex-col gap-2">
								<label className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-base-300 px-3 py-2">
									<span className="label-text">Show on map</span>
									<input
										type="checkbox"
										className="toggle toggle-sm toggle-secondary"
										checked={showActors}
										onChange={(event) => setShowActors(event.target.checked)}
									/>
								</label>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>

			{/* VOX import modal */}
			{voxImportModal && (
				<dialog className="modal modal-open">
					<div className="modal-box max-w-md">
						{voxImportModal.kind === "error" ? (
							<>
								<h3 className="font-bold text-lg mb-3">Import .vox — Error</h3>
								<p className="text-sm text-error">{voxImportModal.message}</p>
								<div className="modal-action">
									<button
										type="button"
										className="btn"
										onClick={() => setVoxImportModal(null)}
									>
										Close
									</button>
								</div>
							</>
						) : (
							<>
								<h3 className="font-bold text-lg mb-1">Import .vox</h3>
								<p className="text-sm text-base-content/60 mb-4">
									File dimensions:{" "}
									<span className="font-medium text-base-content">
										{voxImportModal.parsed.voxWidth}×{voxImportModal.parsed.voxLength}×{voxImportModal.parsed.voxHeight} voxels
									</span>
									. Choose a world scale:
								</p>
								<div className="flex flex-col gap-2">
									{voxImportModal.options.map((opt) => (
										<button
											key={opt.resolution}
											type="button"
											disabled={!opt.fits}
											onClick={() =>
												setVoxImportModal({ ...voxImportModal, selected: opt.resolution })
											}
											className={[
												"btn btn-sm w-full justify-between text-left normal-case",
												!opt.fits
													? "btn-disabled opacity-40"
													: opt.resolution === voxImportModal.selected
													? "btn-primary"
													: "btn-outline",
											].join(" ")}
										>
											<span className="font-semibold">
												{VOX_RESOLUTION_LABELS[opt.resolution] ?? `Resolution ${opt.resolution}`}
											</span>
											<span className="text-xs opacity-75">
												{opt.fits
													? `${opt.tacticalWidth}×${opt.tacticalLength}×${opt.tacticalHeight} tiles`
													: "Too large"}
											</span>
										</button>
									))}
								</div>
								<p className="text-xs text-base-content/50 mt-3">
									This will replace the current terrain. The previous state is saved to undo.
								</p>
								<div className="modal-action">
									<button
										type="button"
										className="btn btn-ghost"
										onClick={() => setVoxImportModal(null)}
									>
										Cancel
									</button>
									<button
										type="button"
										className="btn btn-primary"
										onClick={() =>
											applyVoxImport(voxImportModal.parsed, voxImportModal.selected)
										}
									>
										Import
									</button>
								</div>
							</>
						)}
					</div>
					<div
						className="modal-backdrop"
						onClick={() => setVoxImportModal(null)}
					/>
				</dialog>
			)}
		</>
	);
}
