import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { acceleratedRaycast } from "three-mesh-bvh";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Voxel, VoxelTerrain } from "../../domains/VoxelTerrain/VoxelTerrain";
import { VOXEL_FACE_DEFINITIONS } from "../../utils/VoxelTerrainGeometryConstants";
import { createVoxelTerrainGeometry } from "../../utils/VoxelTerrainGeometryUtils";
import {
	decodeVoxels,
	encodeVoxels,
	getVoxelCount,
} from "../../utils/VoxelDataUtils";
import {
	DEFAULT_TERRAIN_COLOR_INDEX,
	getTerrainColorByIndex,
	getTerrainPaletteIndex,
	TERRAIN_PALETTE_FAMILIES,
	TERRAIN_PALETTE_LEVELS,
} from "../../utils/TerrainPaletteUtils";
import {
	normalizeVoxelPaletteIndex,
	terrainPaletteIndexToVoxelColor,
} from "../../utils/VoxelTerrainEditorUtils";
import { getVoxelTerrainResolution } from "../../utils/VoxelTerrainUtils";
import ThreeDMap from "../Map/3DMap";
import { MapStateProvider } from "../Map/MapStateProvider";

type EditorView = "edit" | "preview";
type EditorTool = "place" | "erase" | "paint" | "sample";
type EditGranularity = "tactical" | "voxel";

interface VoxelTerrainEditorProps {
	terrain: VoxelTerrain;
	onChange: (terrain: VoxelTerrain) => void;
	readOnly?: boolean;
}

interface VoxelCoord {
	x: number;
	y: number;
	z: number;
}

interface TerrainBounds {
	resolution: number;
	resolvedWidth: number;
	resolvedLength: number;
	resolvedHeight: number;
}

interface PickInfo {
	voxel: VoxelCoord;
	normal: VoxelCoord;
	ground: boolean;
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
}

const UNDO_LIMIT = 50;
const MIN_BRUSH_SIZE = 1;
const MAX_BRUSH_SIZE = 8;
const PICK_EPSILON = 0.0001;
const GRID_LINE_OFFSET = 0.008;
const HOVER_FACE_OFFSET = 0.014;
const INITIAL_CAMERA_HALF_SIZE = 14;
const CAMERA_DISTANCE_MULTIPLIER = 1.65;

const TOOL_BUTTONS: Array<{
	id: EditorTool;
	label: string;
	icon: string;
}> = [
	{
		id: "place",
		label: "Place",
		icon: "icon-[mdi--cube-outline]",
	},
	{
		id: "erase",
		label: "Erase",
		icon: "icon-[mdi--eraser]",
	},
	{
		id: "paint",
		label: "Paint",
		icon: "icon-[mdi--palette]",
	},
	{
		id: "sample",
		label: "Sample",
		icon: "icon-[mdi--eyedropper]",
	},
];

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function voxelKey(x: number, y: number, z: number): number {
	return x + y * 256 + z * 65536;
}

function unpackVoxelKey(key: number): Voxel {
	const color = key & 0xff;
	const position = Math.floor(key / 256);

	return {
		x: position & 0xff,
		y: (position >>> 8) & 0xff,
		z: (position >>> 16) & 0xff,
		color,
	};
}

function unpackVoxelPositionKey(key: number): VoxelCoord {
	return {
		x: key & 0xff,
		y: (key >>> 8) & 0xff,
		z: (key >>> 16) & 0xff,
	};
}

function createVoxelMap(encoded: string): Map<number, number> {
	const map = new Map<number, number>();

	for (const voxel of decodeVoxels(encoded)) {
		map.set(voxelKey(voxel.x, voxel.y, voxel.z), normalizeVoxelPaletteIndex(voxel.color));
	}

	return map;
}

function voxelMapToEncoded(map: Map<number, number>): string {
	const voxels: Voxel[] = [];

	for (const [key, color] of map) {
		const voxel = unpackVoxelKey(key * 256 + (color & 0xff));
		voxels.push({
			x: voxel.x,
			y: voxel.y,
			z: voxel.z,
			color,
		});
	}

	return encodeVoxels(voxels);
}

function getTerrainBounds(terrain: VoxelTerrain): TerrainBounds {
	const resolution = getVoxelTerrainResolution(terrain);

	return {
		resolution,
		resolvedWidth: terrain.Width * resolution,
		resolvedLength: terrain.Length * resolution,
		resolvedHeight: terrain.Height * resolution,
	};
}

function isInBounds(coord: VoxelCoord, bounds: TerrainBounds): boolean {
	return (
		coord.x >= 0 &&
		coord.x < bounds.resolvedWidth &&
		coord.y >= 0 &&
		coord.y < bounds.resolvedHeight &&
		coord.z >= 0 &&
		coord.z < bounds.resolvedLength
	);
}

function pointToVoxelCoord(
	point: THREE.Vector3,
	terrain: VoxelTerrain,
	bounds: TerrainBounds
): VoxelCoord {
	return {
		x: Math.floor((point.x + terrain.Width / 2) * bounds.resolution),
		y: Math.floor((point.y + 0.5) * bounds.resolution),
		z: Math.floor((point.z + terrain.Length / 2) * bounds.resolution),
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
	terrain: VoxelTerrain
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
				unit.x >= 0 &&
				unit.x < terrain.Width &&
				unit.y >= 0 &&
				unit.y < terrain.Height &&
				unit.z >= 0 &&
				unit.z < terrain.Length
			) {
				units.push(unit);
			}
		}
	}

	return units;
}

function getTacticalUnitFromVoxel(coord: VoxelCoord, bounds: TerrainBounds): VoxelCoord {
	return {
		x: Math.floor(coord.x / bounds.resolution),
		y: Math.floor(coord.y / bounds.resolution),
		z: Math.floor(coord.z / bounds.resolution),
	};
}

function getTacticalBlockCoords(unit: VoxelCoord, bounds: TerrainBounds): VoxelCoord[] {
	const coords: VoxelCoord[] = [];
	const startX = unit.x * bounds.resolution;
	const startY = unit.y * bounds.resolution;
	const startZ = unit.z * bounds.resolution;

	for (let z = startZ; z < startZ + bounds.resolution; z++) {
		for (let y = startY; y < startY + bounds.resolution; y++) {
			for (let x = startX; x < startX + bounds.resolution; x++) {
				const coord = { x, y, z };
				if (isInBounds(coord, bounds)) coords.push(coord);
			}
		}
	}

	return coords;
}

function collectAffectedCoords(
	terrain: VoxelTerrain,
	pick: PickInfo,
	tool: EditorTool,
	granularity: EditGranularity,
	brushSize: number
): VoxelCoord[] {
	const bounds = getTerrainBounds(terrain);

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
			isInBounds(coord, bounds)
		);
	}

	const baseUnit = getTacticalUnitFromVoxel(pick.voxel, bounds);
	const origin =
		tool === "place" && !pick.ground
			? {
				x: baseUnit.x + pick.normal.x,
				y: baseUnit.y + pick.normal.y,
				z: baseUnit.z + pick.normal.z,
			}
			: baseUnit;
	const normal = pick.ground ? { x: 0, y: 1, z: 0 } : pick.normal;
	const units = getTacticalBrushUnits(origin, normal, brushSize, terrain);

	return units.flatMap((unit) => getTacticalBlockCoords(unit, bounds));
}

function applyVoxelEdit(
	terrain: VoxelTerrain,
	map: Map<number, number>,
	pick: PickInfo,
	tool: EditorTool,
	granularity: EditGranularity,
	brushSize: number,
	colorIndex: number
): { terrain: VoxelTerrain; changed: boolean; sampledColor: number | null } {
	const coords =
		tool === "sample"
			? [pick.voxel]
			: collectAffectedCoords(terrain, pick, tool, granularity, brushSize);
	const nextMap = new Map(map);
	let changed = false;
	let sampledColor: number | null = null;

	if (tool === "sample") {
		for (const coord of coords) {
			const color = map.get(voxelKey(coord.x, coord.y, coord.z));
			if (color !== undefined) {
				sampledColor = color;
				break;
			}
		}

		return { terrain, changed: false, sampledColor };
	}

	for (const coord of coords) {
		const key = voxelKey(coord.x, coord.y, coord.z);

		if (tool === "erase") {
			if (nextMap.delete(key)) changed = true;
			continue;
		}

		if (tool === "paint") {
			if (nextMap.has(key) && nextMap.get(key) !== colorIndex) {
				nextMap.set(key, colorIndex);
				changed = true;
			}
			continue;
		}

		if (!nextMap.has(key)) {
			nextMap.set(key, colorIndex);
			changed = true;
		}
	}

	if (!changed) return { terrain, changed: false, sampledColor: null };

	return {
		terrain: {
			...terrain,
			Voxels: voxelMapToEncoded(nextMap),
		},
		changed,
		sampledColor: null,
	};
}

function createEditorTerrainColor(voxel: Voxel, isTopFace: boolean): THREE.Color {
	const color = new THREE.Color(
		terrainPaletteIndexToVoxelColor(normalizeVoxelPaletteIndex(voxel.color))
	);

	if (!isTopFace) color.multiplyScalar(0.78);
	return color;
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
	terrain: VoxelTerrain,
	color: number,
	opacity: number
): THREE.LineSegments {
	const minX = -terrain.Width / 2;
	const maxX = terrain.Width / 2;
	const minY = -0.5;
	const maxY = terrain.Height - 0.5;
	const minZ = -terrain.Length / 2;
	const maxZ = terrain.Length / 2;
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

function createVoxelSurfaceGrid(
	terrain: VoxelTerrain,
	bounds: TerrainBounds,
	map: Map<number, number>,
	color: number,
	opacity: number
): THREE.LineSegments | null {
	const points: number[] = [];

	for (const key of map.keys()) {
		const voxel = unpackVoxelPositionKey(key);
		if (map.has(voxelKey(voxel.x, voxel.y + 1, voxel.z))) continue;

		const minX = voxel.x / bounds.resolution - terrain.Width / 2;
		const maxX = (voxel.x + 1) / bounds.resolution - terrain.Width / 2;
		const y = (voxel.y + 1) / bounds.resolution - 0.5 + GRID_LINE_OFFSET;
		const minZ = voxel.z / bounds.resolution - terrain.Length / 2;
		const maxZ = (voxel.z + 1) / bounds.resolution - terrain.Length / 2;
		addTopRectangle(points, minX, maxX, y, minZ, maxZ);
	}

	if (points.length === 0) return null;
	return createGridLineSegments(points, color, opacity);
}

function createTacticalSurfaceGrid(
	terrain: VoxelTerrain,
	bounds: TerrainBounds,
	map: Map<number, number>,
	color: number,
	opacity: number
): THREE.LineSegments | null {
	const points: number[] = [];

	for (const key of map.keys()) {
		const voxel = unpackVoxelPositionKey(key);
		if (map.has(voxelKey(voxel.x, voxel.y + 1, voxel.z))) continue;

		const minX = voxel.x / bounds.resolution - terrain.Width / 2;
		const maxX = (voxel.x + 1) / bounds.resolution - terrain.Width / 2;
		const y = (voxel.y + 1) / bounds.resolution - 0.5 + GRID_LINE_OFFSET * 2;
		const minZ = voxel.z / bounds.resolution - terrain.Length / 2;
		const maxZ = (voxel.z + 1) / bounds.resolution - terrain.Length / 2;

		if (voxel.x % bounds.resolution === 0) {
			points.push(minX, y, minZ, minX, y, maxZ);
		}
		if ((voxel.x + 1) % bounds.resolution === 0) {
			points.push(maxX, y, minZ, maxX, y, maxZ);
		}
		if (voxel.z % bounds.resolution === 0) {
			points.push(minX, y, minZ, maxX, y, minZ);
		}
		if ((voxel.z + 1) % bounds.resolution === 0) {
			points.push(minX, y, maxZ, maxX, y, maxZ);
		}
	}

	if (points.length === 0) return null;
	return createGridLineSegments(points, color, opacity);
}

function rebuildGrid(
	resources: EditorSceneResources,
	terrain: VoxelTerrain,
	map: Map<number, number>,
	showTacticalGrid: boolean,
	showVoxelGrid: boolean
): void {
	clearObjectGroup(resources.gridGroup);

	const bounds = getTerrainBounds(terrain);

	if (showVoxelGrid && bounds.resolution > 1) {
		const voxelGrid = createVoxelSurfaceGrid(terrain, bounds, map, 0xf59e0b, 0.38);
		if (voxelGrid) resources.gridGroup.add(voxelGrid);
	}

	if (showTacticalGrid) {
		const tacticalGrid = createTacticalSurfaceGrid(terrain, bounds, map, 0x14b8a6, 0.68);
		if (tacticalGrid) resources.gridGroup.add(tacticalGrid);
	}

	resources.gridGroup.add(createBoundsFrame(terrain, 0xe5e7eb, 0.32));
}

function getVoxelWorldCenter(
	terrain: VoxelTerrain,
	bounds: TerrainBounds,
	voxel: VoxelCoord
): THREE.Vector3 {
	const voxelSize = 1 / bounds.resolution;
	const halfVoxelSize = voxelSize / 2;

	return new THREE.Vector3(
		voxel.x / bounds.resolution - terrain.Width / 2 + halfVoxelSize,
		(voxel.y + 0.5) / bounds.resolution - 0.5,
		voxel.z / bounds.resolution - terrain.Length / 2 + halfVoxelSize
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
	terrain: VoxelTerrain,
	bounds: TerrainBounds,
	map: Map<number, number>,
	coords: VoxelCoord[]
): THREE.BufferGeometry | null {
	const positions: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];
	const voxelSize = 1 / bounds.resolution;
	const selectedKeys = new Set(coords.map((coord) => voxelKey(coord.x, coord.y, coord.z)));

	for (const key of selectedKeys) {
		const colorIndex = map.get(key);
		if (colorIndex === undefined) continue;

		const voxel = unpackVoxelPositionKey(key);
		const center = getVoxelWorldCenter(terrain, bounds, voxel);
		const color = getHoverColor(colorIndex);

		for (const face of VOXEL_FACE_DEFINITIONS) {
			const [dx, dy, dz] = face.neighborOffset;
			if (map.has(voxelKey(voxel.x + dx, voxel.y + dy, voxel.z + dz))) continue;

			addVoxelFaceToGeometry(
				positions,
				colors,
				indices,
				center,
				voxelSize,
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
	terrain: VoxelTerrain,
	bounds: TerrainBounds,
	map: Map<number, number>,
	coords: VoxelCoord[]
): THREE.BufferGeometry | null {
	const positions: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];
	const voxelSize = 1 / bounds.resolution;
	const ghostKeys = new Set<number>();

	for (const coord of coords) {
		const key = voxelKey(coord.x, coord.y, coord.z);
		if (!isInBounds(coord, bounds) || map.has(key)) continue;
		ghostKeys.add(key);
	}

	const occupiedOrGhost = new Set<number>(map.keys());
	for (const key of ghostKeys) {
		occupiedOrGhost.add(key);
	}

	const color = new THREE.Color(0xffffff);
	for (const key of ghostKeys) {
		const voxel = unpackVoxelPositionKey(key);
		const center = getVoxelWorldCenter(terrain, bounds, voxel);

		for (const face of VOXEL_FACE_DEFINITIONS) {
			const [dx, dy, dz] = face.neighborOffset;
			if (occupiedOrGhost.has(voxelKey(voxel.x + dx, voxel.y + dy, voxel.z + dz))) {
				continue;
			}

			addVoxelFaceToGeometry(
				positions,
				colors,
				indices,
				center,
				voxelSize,
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
	terrain: VoxelTerrain,
	map: Map<number, number>,
	pick: PickInfo | null,
	tool: EditorTool,
	granularity: EditGranularity,
	brushSize: number,
	colorIndex: number
): void {
	clearObjectGroup(resources.hoverGroup);
	if (!pick) return;

	const bounds = getTerrainBounds(terrain);
	const coords =
		tool === "sample"
			? [pick.voxel]
			: collectAffectedCoords(terrain, pick, tool, granularity, brushSize);
	const geometry =
		tool === "place"
			? createPlaceGhostGeometry(terrain, bounds, map, coords)
			: createHoverSurfaceGeometry(terrain, bounds, map, coords);

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
}: VoxelTerrainEditorProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const resourcesRef = useRef<EditorSceneResources | null>(null);
	const terrainRef = useRef(terrain);
	const voxelMapRef = useRef(createVoxelMap(terrain.Voxels));
	const toolRef = useRef<EditorTool>("place");
	const granularityRef = useRef<EditGranularity>("tactical");
	const brushSizeRef = useRef(1);
	const selectedColorRef = useRef(DEFAULT_TERRAIN_COLOR_INDEX);
	const readOnlyRef = useRef(readOnly);
	const pointerDownRef = useRef(false);
	const strokeStartedRef = useRef(false);
	const strokeStartVoxelsRef = useRef<string | null>(null);
	const lastEditKeyRef = useRef<string | null>(null);
	const lastShapeSignatureRef = useRef<string | null>(null);

	const [activeView, setActiveView] = useState<EditorView>("edit");
	const [tool, setTool] = useState<EditorTool>("place");
	const [granularity, setGranularity] = useState<EditGranularity>("tactical");
	const [brushSize, setBrushSize] = useState(1);
	const [selectedColorIndex, setSelectedColorIndex] = useState(DEFAULT_TERRAIN_COLOR_INDEX);
	const [showTacticalGrid, setShowTacticalGrid] = useState(true);
	const [showVoxelGrid, setShowVoxelGrid] = useState(true);
	const [undoStack, setUndoStack] = useState<string[]>([]);
	const [redoStack, setRedoStack] = useState<string[]>([]);

	const voxelMap = useMemo(() => createVoxelMap(terrain.Voxels), [terrain.Voxels]);
	const voxelCount = getVoxelCount(terrain.Voxels);
	const selectedTool = TOOL_BUTTONS.find((button) => button.id === tool) ?? TOOL_BUTTONS[0];
	const resolution = getVoxelTerrainResolution(terrain);
	const tileDimensions = `${terrain.Width} x ${terrain.Length} x ${terrain.Height}`;
	const voxelDimensions = `${terrain.Width * resolution} x ${terrain.Length * resolution} x ${
		terrain.Height * resolution
	}`;
	const brushModeLabel = granularity === "tactical" ? "Tile Brush" : "Voxel Brush";

	useEffect(() => {
		terrainRef.current = terrain;
		voxelMapRef.current = voxelMap;
	}, [terrain, voxelMap]);

	useEffect(() => {
		toolRef.current = tool;
		granularityRef.current = granularity;
		brushSizeRef.current = brushSize;
		selectedColorRef.current = selectedColorIndex;
		readOnlyRef.current = readOnly;
	}, [tool, granularity, brushSize, selectedColorIndex, readOnly]);

	useEffect(() => {
		setUndoStack([]);
		setRedoStack([]);
		lastShapeSignatureRef.current = null;
	}, [terrain.Id]);

	const recordUndo = useCallback((voxels: string) => {
		setUndoStack((current) => [...current.slice(-(UNDO_LIMIT - 1)), voxels]);
		setRedoStack([]);
	}, []);

	const undo = useCallback(() => {
		if (undoStack.length === 0) return;
		const currentTerrain = terrainRef.current;
		const previousVoxels = undoStack[undoStack.length - 1];
		const nextTerrain = { ...currentTerrain, Voxels: previousVoxels };

		terrainRef.current = nextTerrain;
		voxelMapRef.current = createVoxelMap(previousVoxels);
		setUndoStack((current) => current.slice(0, -1));
		setRedoStack((current) => [currentTerrain.Voxels, ...current].slice(0, UNDO_LIMIT));
		onChange(nextTerrain);
	}, [onChange, undoStack]);

	const redo = useCallback(() => {
		if (redoStack.length === 0) return;
		const currentTerrain = terrainRef.current;
		const nextVoxels = redoStack[0];
		const nextTerrain = { ...currentTerrain, Voxels: nextVoxels };

		terrainRef.current = nextTerrain;
		voxelMapRef.current = createVoxelMap(nextVoxels);
		setRedoStack((current) => current.slice(1));
		setUndoStack((current) => [...current.slice(-(UNDO_LIMIT - 1)), currentTerrain.Voxels]);
		onChange(nextTerrain);
	}, [onChange, redoStack]);

	const getPickInfo = useCallback((event: PointerEvent): PickInfo | null => {
		const resources = resourcesRef.current;
		const currentTerrain = terrainRef.current;
		const container = containerRef.current;
		if (!resources || !container) return null;

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
				const bounds = getTerrainBounds(currentTerrain);
				const voxel = pointToVoxelCoord(insidePoint, currentTerrain, bounds);

				if (isInBounds(voxel, bounds)) {
					return {
						voxel,
						normal: normalToCoord(normal),
						ground: false,
					};
				}
			}
		}

		const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.5);
		const groundPoint = new THREE.Vector3();
		if (!resources.raycaster.ray.intersectPlane(groundPlane, groundPoint)) {
			return null;
		}

		const bounds = getTerrainBounds(currentTerrain);
		const voxel = {
			x: Math.floor((groundPoint.x + currentTerrain.Width / 2) * bounds.resolution),
			y: 0,
			z: Math.floor((groundPoint.z + currentTerrain.Length / 2) * bounds.resolution),
		};

		if (!isInBounds(voxel, bounds)) return null;

		return {
			voxel,
			normal: { x: 0, y: 1, z: 0 },
			ground: true,
		};
	}, []);

	const applyEdit = useCallback((pick: PickInfo): boolean => {
		if (readOnlyRef.current) return false;

		const currentTerrain = terrainRef.current;
		const currentMap = voxelMapRef.current;
		const result = applyVoxelEdit(
			currentTerrain,
			currentMap,
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

		terrainRef.current = result.terrain;
		voxelMapRef.current = createVoxelMap(result.terrain.Voxels);
		onChange(result.terrain);
		return true;
	}, [onChange, recordUndo]);

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

		const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

		const resources: EditorSceneResources = {
			scene,
			camera,
			renderer,
			controls,
			raycaster: new THREE.Raycaster(),
			gridGroup,
			hoverGroup,
			terrainMesh: null,
		};
		resourcesRef.current = resources;

		let rafId = 0;
		const animate = () => {
			rafId = requestAnimationFrame(animate);
			controls.update();
			renderer.render(scene, camera);
		};
		animate();

		const resizeObserver = new ResizeObserver(() => {
			resizeRenderer(resources, container);
		});
		resizeObserver.observe(container);

		const refreshHover = (pick: PickInfo | null) => {
			updateHoverIndicator(
				resources,
				terrainRef.current,
				voxelMapRef.current,
				pick,
				toolRef.current,
				granularityRef.current,
				brushSizeRef.current,
				selectedColorRef.current
			);
		};

		const handlePointerMove = (event: PointerEvent) => {
			const pick = getPickInfo(event);
			refreshHover(pick);
			if (!pointerDownRef.current || !pick || toolRef.current === "sample") return;

			const editKey = getEditKey(pick);
			if (lastEditKeyRef.current === editKey) return;
			lastEditKeyRef.current = editKey;

			applyEdit(pick);
			refreshHover(getPickInfo(event));
		};

		const handlePointerDown = (event: PointerEvent) => {
			if (event.button === 1) {
				event.preventDefault();
				return;
			}
			if (event.button !== 0 || readOnlyRef.current) return;

			event.preventDefault();
			renderer.domElement.setPointerCapture(event.pointerId);
			pointerDownRef.current = true;
			strokeStartedRef.current = false;
			strokeStartVoxelsRef.current = terrainRef.current.Voxels;
			lastEditKeyRef.current = null;

			const pick = getPickInfo(event);
			if (!pick) return;

			const wasSampleTool = toolRef.current === "sample";
			lastEditKeyRef.current = getEditKey(pick);
			applyEdit(pick);
			refreshHover(getPickInfo(event));
			if (wasSampleTool) {
				renderer.domElement.releasePointerCapture(event.pointerId);
				pointerDownRef.current = false;
				strokeStartedRef.current = false;
				strokeStartVoxelsRef.current = null;
				lastEditKeyRef.current = null;
			}
		};

		const finishStroke = (event: PointerEvent) => {
			if (renderer.domElement.hasPointerCapture(event.pointerId)) {
				renderer.domElement.releasePointerCapture(event.pointerId);
			}

			pointerDownRef.current = false;
			strokeStartedRef.current = false;
			strokeStartVoxelsRef.current = null;
			lastEditKeyRef.current = null;
		};

		const handlePointerLeave = () => {
			if (!pointerDownRef.current) {
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
				disposeMaterial(resources.terrainMesh.material);
			}
			disposeObjectTree(gridGroup);
			disposeObjectTree(hoverGroup);
			renderer.dispose();
			if (renderer.domElement.parentElement === container) {
				container.removeChild(renderer.domElement);
			}
			resourcesRef.current = null;
		};
	}, [applyEdit, getEditKey, getPickInfo]);

	useEffect(() => {
		const resources = resourcesRef.current;
		const container = containerRef.current;
		if (!resources || !container) return;

		clearObjectGroup(resources.hoverGroup);

		if (resources.terrainMesh) {
			resources.scene.remove(resources.terrainMesh);
			resources.terrainMesh.geometry.dispose();
			disposeMaterial(resources.terrainMesh.material);
			resources.terrainMesh = null;
		}

		if (getVoxelCount(terrain.Voxels) > 0) {
			const geometry = createVoxelTerrainGeometry(terrain, createEditorTerrainColor);
			const material = new THREE.MeshStandardMaterial({
				roughness: 0.78,
				metalness: 0,
				vertexColors: true,
			});
			const mesh = new THREE.Mesh(geometry, material);
			mesh.raycast = acceleratedRaycast;
			resources.scene.add(mesh);
			resources.terrainMesh = mesh;
		}

		const shapeSignature = [
			terrain.Id,
			terrain.Width,
			terrain.Length,
			terrain.Height,
			getVoxelTerrainResolution(terrain),
		].join(":");
		if (lastShapeSignatureRef.current !== shapeSignature) {
			frameCamera(resources, terrain, container);
			lastShapeSignatureRef.current = shapeSignature;
		}
	}, [terrain]);

	useEffect(() => {
	const resources = resourcesRef.current;
	if (!resources) return;
	rebuildGrid(resources, terrain, voxelMap, showTacticalGrid, showVoxelGrid);
}, [terrain, voxelMap, showTacticalGrid, showVoxelGrid]);

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

	return (
		<div className="border-2 rounded-lg bg-base-100 min-h-[38rem] h-[72dvh] flex overflow-hidden">
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
									title={button.label}
									aria-label={button.label}
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
							>
								Tile Brush
							</button>
							<button
								type="button"
								className={`btn btn-sm join-item ${granularity === "voxel" ? "btn-primary" : "btn-outline"}`}
								onClick={() => setGranularity("voxel")}
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
								title="Undo"
								aria-label="Undo"
							>
								<span className="icon-[mdi--undo] w-5 h-5" />
							</button>
							<button
								type="button"
								className="btn btn-square btn-sm join-item btn-outline"
								onClick={redo}
								disabled={redoStack.length === 0 || readOnly}
								title="Redo"
								aria-label="Redo"
							>
								<span className="icon-[mdi--redo] w-5 h-5" />
							</button>
						</div>
					</div>

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

				<div className="relative flex-1 min-h-0 bg-base-200">
					<div className={activeView === "edit" ? "absolute inset-0" : "hidden"}>
						<div ref={containerRef} className="absolute inset-0" />
					</div>
					<div className={activeView === "preview" ? "absolute inset-0" : "hidden"}>
						<MapStateProvider>
							<ThreeDMap terrain={terrain} />
						</MapStateProvider>
					</div>
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
						<div className="space-y-1">
							{TERRAIN_PALETTE_FAMILIES.map((family, familyIndex) => (
								<div key={family.id} className="grid grid-cols-5 gap-1">
									{Array.from({ length: TERRAIN_PALETTE_LEVELS }, (_, levelIndex) => {
										const index = getTerrainPaletteIndex(familyIndex, levelIndex);
										const color = getTerrainColorByIndex(index);

										return (
											<button
												key={index}
												type="button"
												className={`h-7 border-2 ${
													selectedColorIndex === index
														? "border-base-content"
														: "border-base-300/30"
												}`}
												style={{ backgroundColor: color }}
												onClick={() => setSelectedColorIndex(index)}
												title={`${family.label} ${levelIndex + 1}`}
												aria-label={`${family.label} ${levelIndex + 1}`}
											/>
										);
									})}
								</div>
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
				</div>
			</div>
		</div>
	);
}
