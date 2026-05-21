import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
	DEFAULT_VOXEL_TERRAIN_BACKGROUND_COLOR,
	type VoxelTerrain,
	type VoxelTerrainBackground,
	type VoxelTerrainLighting,
} from "../../domains/VoxelTerrain/VoxelTerrain";
import { terrainHeightToWorldY } from "../Map/Actors3D/actorTokenPlacement";
import { VOXEL_FACE_DEFINITIONS } from "../Map/Terrain/geometry/VoxelTerrainGeometryConstants";
import {
	decodeVoxels,
	encodeVoxels,
} from "../../utils/terrain/data/VoxelDataUtils";
import {
	DEFAULT_TERRAIN_COLOR_INDEX,
	TERRAIN_PALETTE,
	TERRAIN_PALETTE_ROWS,
} from "../../utils/terrain/palette/TerrainPaletteUtils";
import {
	MAX_VOXEL_TERRAIN_LENGTH,
	MAX_VOXEL_TERRAIN_WIDTH,
	clampVoxelTerrainHeight,
	clampVoxelTerrainResolution,
	normalizeVoxelPaletteIndex,
	terrainPaletteIndexToVoxelColor,
} from "../../utils/terrain/editor/VoxelTerrainEditorUtils";
import {
	IDENTITY_STAMP_TRANSFORM,
	iterateStampVoxels,
	mirrorStampTransform,
	rotateStampTransform,
	type StampTransform,
} from "../../utils/terrain/editor/VoxelStampUtils";
import {
	createTerrainRevision,
	getVoxelTerrainIndex,
	getVoxelTerrainResolution,
	packVoxelKey,
	unpackVoxelKey,
	type VoxelTerrainIndex,
} from "../../utils/terrain/data/VoxelTerrainIndex";
import {
	buildTerrainFromVox,
	getVoxResolutionOptions,
	parseVoxFile,
	type VoxParseResult,
	type VoxResolutionOption,
} from "../../utils/terrain/import/VoxImportUtils";
import { raycastVoxelGrid } from "../../utils/terrain/raycast/VoxelRaycast";
import { useFormContext } from "../Form/Form";
import ThreeDMap from "../Map/3DMap";
import { MapStateProvider } from "../Map/MapStateProvider";

export interface ActorOverlayInfo {
	id: string;
	name: string;
	position: { x: number; y: number; h: number };
}

type EditorView = "edit" | "preview";
type EditorTool = "place" | "erase" | "paint" | "sample" | "stamp";
type EditGranularity = "tactical" | "voxel";

interface VoxelTerrainEditorProps {
	terrain: VoxelTerrain;
	onChange: (terrain: VoxelTerrain) => void;
	readOnly?: boolean;
	actors?: ActorOverlayInfo[];
	/** Stamp-tagged terrains available for the Insert Stamp dropdown.
	 *  May be unhydrated; the editor calls `loadStampVoxels` before use.
	 */
	stampSources?: VoxelTerrain[];
	/** Returns the fully hydrated voxel data for a stamp source by id. */
	loadStampVoxels?: (terrainId: string) => Promise<VoxelTerrain | null>;
}

export interface VoxelTerrainEditorHandle {
	materializeTerrain: () => VoxelTerrain;
	reshapeDraft: (nextShape: {
		width: number;
		length: number;
		height: number;
		resolution: number;
	}) => VoxelTerrain;
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
	gridGroup: THREE.Group;
	hoverGroup: THREE.Group;
	chunkGroup: THREE.Group;
	terrainMaterial: THREE.MeshStandardMaterial;
}

// ---------------------------------------------------------------------------
// Voxel chunk dimensions
// ---------------------------------------------------------------------------

interface ChunkDims {
	chunksX: number;
	chunksY: number;
	chunksZ: number;
	vW: number;        // voxel grid width
	vH: number;        // voxel grid height
	vL: number;        // voxel grid length
	resolution: number;
	tW: number;        // terrain width (tactical units)
	tL: number;        // terrain length (tactical units)
}

// ---------------------------------------------------------------------------
// VOX import modal
// ---------------------------------------------------------------------------

type VoxImportModal =
	| { kind: "pick"; parsed: VoxParseResult; options: VoxResolutionOption[]; selected: number }
	| { kind: "error"; message: string };

const VOX_RESOLUTION_LABELS: Record<number, string> = {
	1: "Basic",
	2: "Detailed",
	3: "Very Detailed",
	4: "Extreme",
};

// ---------------------------------------------------------------------------
// Constants
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
const ACTOR_OVERLAY_FLOAT_Y = 0.2;
const LIGHTING_INTENSITY_MIN = 0;
const LIGHTING_INTENSITY_MAX = 3;
const LIGHTING_INTENSITY_STEP = 0.05;
const LIGHTING_ROTATION_MIN = 0;
const LIGHTING_ROTATION_MAX = 360;
const LIGHTING_ELEVATION_MIN = 0;
const LIGHTING_ELEVATION_MAX = 90;

function clampNumber(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function numberInputValue(value: string, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

// Chunk size in voxels per axis. 8^3 = 512 voxels max per chunk, giving
// ~80 chunks for a 40x40x16 voxel grid. A single-voxel edit touches 1-2 chunks.
const CHUNK_SIZE = 8;

const TOOL_BUTTONS: Array<{
	id: EditorTool;
	label: string;
	icon: string;
	shortcut: string;
}> = [
	{ id: "place",  label: "Place",  icon: "icon-[mdi--cube-outline]", shortcut: "P" },
	{ id: "erase",  label: "Erase",  icon: "icon-[mdi--eraser]",       shortcut: "R" },
	{ id: "paint",  label: "Paint",  icon: "icon-[mdi--palette]",       shortcut: "G" },
	{ id: "sample", label: "Sample", icon: "icon-[mdi--eyedropper]",    shortcut: "I" },
];

const IS_MAC =
	typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
const MOD_KEY_LABEL = IS_MAC ? "⌘" : "Ctrl";

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// Edit grid -- flat Uint8Array
//
// Encoding: index = vx + vz * vW + vy * vW * vL
//   0        = empty
//   color+1  = occupied with palette index `color` (0..254)
//
// Reads and writes are O(1). The grid is decoded from terrain.Voxels once on
// mount (or on shape change) so strokes do not mutate the encoded SVO payload
// directly. The draft is re-encoded only at commit boundaries.
// ---------------------------------------------------------------------------

type EditGrid = Uint8Array;

function editGridIndex(vx: number, vy: number, vz: number, vW: number, vL: number): number {
	return vx + vz * vW + vy * vW * vL;
}

function editGridHasVoxel(
	grid: EditGrid,
	vx: number, vy: number, vz: number,
	vW: number, vH: number, vL: number,
): boolean {
	if (vx < 0 || vx >= vW || vy < 0 || vy >= vH || vz < 0 || vz >= vL) return false;
	return grid[editGridIndex(vx, vy, vz, vW, vL)] !== 0;
}

function editGridGetColor(
	grid: EditGrid,
	vx: number, vy: number, vz: number,
	vW: number, vH: number, vL: number,
): number | null {
	if (vx < 0 || vx >= vW || vy < 0 || vy >= vH || vz < 0 || vz >= vL) return null;
	const val = grid[editGridIndex(vx, vy, vz, vW, vL)];
	return val === 0 ? null : val - 1;
}

function buildEditGrid(terrain: VoxelTerrain, index: VoxelTerrainIndex): EditGrid {
	const { voxelWidth: vW, voxelHeight: vH, voxelLength: vL } = index;
	const grid = new Uint8Array(vW * vH * vL);
	for (const v of decodeVoxels(terrain.Voxels)) {
		if (v.x < 0 || v.x >= vW || v.y < 0 || v.y >= vH || v.z < 0 || v.z >= vL) continue;
		grid[editGridIndex(v.x, v.y, v.z, vW, vL)] = normalizeVoxelPaletteIndex(v.color) + 1;
	}
	return grid;
}

function encodeEditGrid(grid: EditGrid, vW: number, vH: number, vL: number): string {
	const voxels = [];
	for (let y = 0; y < vH; y++) {
		for (let z = 0; z < vL; z++) {
			for (let x = 0; x < vW; x++) {
				const val = grid[editGridIndex(x, y, z, vW, vL)];
				if (val !== 0) voxels.push({ x, y, z, color: val - 1 });
			}
		}
	}
	return encodeVoxels(voxels);
}

function countEditGridVoxels(grid: EditGrid): number {
	let count = 0;
	for (let i = 0; i < grid.length; i++) {
		if (grid[i] !== 0) count++;
	}
	return count;
}

function computeChunkDimsForShape(
	width: number,
	length: number,
	height: number,
	resolution: number,
): ChunkDims {
	const vW = width * resolution;
	const vH = height * resolution;
	const vL = length * resolution;
	return {
		chunksX:    Math.ceil(vW / CHUNK_SIZE),
		chunksY:    Math.ceil(vH / CHUNK_SIZE),
		chunksZ:    Math.ceil(vL / CHUNK_SIZE),
		vW,
		vH,
		vL,
		resolution,
		tW: width,
		tL: length,
	};
}

function getRescaledVoxelRange(
	index: number,
	oldResolution: number,
	newResolution: number,
	maxExclusive: number,
): { start: number; end: number } | null {
	const start = Math.floor((index * newResolution) / oldResolution);
	const end = Math.ceil(((index + 1) * newResolution) / oldResolution);
	const clampedStart = clamp(start, 0, maxExclusive);
	const clampedEnd = clamp(end, clampedStart, maxExclusive);
	if (clampedStart >= clampedEnd) return null;
	return { start: clampedStart, end: clampedEnd };
}

function normalizeDraftShape(nextShape: {
	width: number;
	length: number;
	height: number;
	resolution: number;
}): {
	width: number;
	length: number;
	height: number;
	resolution: number;
} {
	return {
		width: clamp(Math.floor(nextShape.width) || 1, 1, MAX_VOXEL_TERRAIN_WIDTH),
		length: clamp(Math.floor(nextShape.length) || 1, 1, MAX_VOXEL_TERRAIN_LENGTH),
		height: clampVoxelTerrainHeight(nextShape.height),
		resolution: clampVoxelTerrainResolution(nextShape.resolution),
	};
}

function reshapeEditGrid(
	grid: EditGrid,
	oldDims: ChunkDims,
	nextShape: {
		width: number;
		length: number;
		height: number;
		resolution: number;
	},
): { grid: EditGrid; dims: ChunkDims; count: number; shape: ReturnType<typeof normalizeDraftShape> } {
	const shape = normalizeDraftShape(nextShape);
	const nextDims = computeChunkDimsForShape(
		shape.width,
		shape.length,
		shape.height,
		shape.resolution
	);
	const nextGrid = new Uint8Array(nextDims.vW * nextDims.vH * nextDims.vL);
	let count = 0;

	for (let y = 0; y < oldDims.vH; y++) {
		for (let z = 0; z < oldDims.vL; z++) {
			for (let x = 0; x < oldDims.vW; x++) {
				const val = grid[editGridIndex(x, y, z, oldDims.vW, oldDims.vL)];
				if (val === 0) continue;

				const xRange = getRescaledVoxelRange(
					x,
					oldDims.resolution,
					shape.resolution,
					nextDims.vW
				);
				const yRange = getRescaledVoxelRange(
					y,
					oldDims.resolution,
					shape.resolution,
					nextDims.vH
				);
				const zRange = getRescaledVoxelRange(
					z,
					oldDims.resolution,
					shape.resolution,
					nextDims.vL
				);
				if (!xRange || !yRange || !zRange) continue;

				for (let nz = zRange.start; nz < zRange.end; nz++) {
					for (let ny = yRange.start; ny < yRange.end; ny++) {
						for (let nx = xRange.start; nx < xRange.end; nx++) {
							const nextIdx = editGridIndex(nx, ny, nz, nextDims.vW, nextDims.vL);
							if (nextGrid[nextIdx] === 0) count++;
							nextGrid[nextIdx] = val;
						}
					}
				}
			}
		}
	}

	return { grid: nextGrid, dims: nextDims, count, shape };
}

// ---------------------------------------------------------------------------
// Chunk system
// ---------------------------------------------------------------------------

function computeChunkDims(index: VoxelTerrainIndex): ChunkDims {
	return computeChunkDimsForShape(
		index.width,
		index.length,
		index.height,
		index.resolution
	);
}

function markAllChunksDirty(dirtyChunks: Set<number>, dims: ChunkDims): void {
	const { chunksX, chunksY, chunksZ } = dims;
	for (let cy = 0; cy < chunksY; cy++) {
		for (let cz = 0; cz < chunksZ; cz++) {
			for (let cx = 0; cx < chunksX; cx++) {
				dirtyChunks.add(cx + cz * chunksX + cy * chunksX * chunksZ);
			}
		}
	}
}

function markVoxelDirtyChunks(
	vx: number, vy: number, vz: number,
	dirtyChunks: Set<number>,
	dims: ChunkDims,
): void {
	const { chunksX, chunksY, chunksZ } = dims;

	const addIfValid = (cx: number, cy: number, cz: number) => {
		if (cx >= 0 && cx < chunksX && cy >= 0 && cy < chunksY && cz >= 0 && cz < chunksZ) {
			dirtyChunks.add(cx + cz * chunksX + cy * chunksX * chunksZ);
		}
	};

	const mainCx = Math.floor(vx / CHUNK_SIZE);
	const mainCy = Math.floor(vy / CHUNK_SIZE);
	const mainCz = Math.floor(vz / CHUNK_SIZE);
	addIfValid(mainCx, mainCy, mainCz);

	// When a voxel sits on a chunk boundary, the adjacent chunk's face culling
	// is also affected. Mark it dirty so it rebuilds on the next rAF frame.
	if (vx % CHUNK_SIZE === 0)          addIfValid(mainCx - 1, mainCy, mainCz);
	if ((vx + 1) % CHUNK_SIZE === 0)    addIfValid(mainCx + 1, mainCy, mainCz);
	if (vy % CHUNK_SIZE === 0)          addIfValid(mainCx, mainCy - 1, mainCz);
	if ((vy + 1) % CHUNK_SIZE === 0)    addIfValid(mainCx, mainCy + 1, mainCz);
	if (vz % CHUNK_SIZE === 0)          addIfValid(mainCx, mainCy, mainCz - 1);
	if ((vz + 1) % CHUNK_SIZE === 0)    addIfValid(mainCx, mainCy, mainCz + 1);
}

// Reused across buildChunkGeometry calls to avoid per-voxel Color allocations.
const CHUNK_VOXEL_COLOR = new THREE.Color();

function buildChunkGeometry(
	grid: EditGrid,
	dims: ChunkDims,
	chunkX: number,
	chunkY: number,
	chunkZ: number,
): THREE.BufferGeometry | null {
	const { vW, vH, vL, resolution, tW, tL } = dims;
	const halfW = tW / 2;
	const halfL = tL / 2;
	const voxelSize = 1 / resolution;
	const halfVoxelSize = voxelSize / 2;

	const positions: number[] = [];
	const normals:   number[] = [];
	const colors:    number[] = [];
	const indices:   number[] = [];

	const startX = chunkX * CHUNK_SIZE;
	const startY = chunkY * CHUNK_SIZE;
	const startZ = chunkZ * CHUNK_SIZE;
	const endX = Math.min(startX + CHUNK_SIZE, vW);
	const endY = Math.min(startY + CHUNK_SIZE, vH);
	const endZ = Math.min(startZ + CHUNK_SIZE, vL);

	for (let vy = startY; vy < endY; vy++) {
		for (let vz = startZ; vz < endZ; vz++) {
			for (let vx = startX; vx < endX; vx++) {
				const val = grid[editGridIndex(vx, vy, vz, vW, vL)];
				if (val === 0) continue;

				CHUNK_VOXEL_COLOR.set(
					terrainPaletteIndexToVoxelColor(normalizeVoxelPaletteIndex(val - 1))
				);

				// Center of this voxel in world space.
				const cx = vx / resolution - halfW + halfVoxelSize;
				const cy = (vy + 0.5) / resolution - 0.5;
				const cz = vz / resolution - halfL + halfVoxelSize;

				for (const face of VOXEL_FACE_DEFINITIONS) {
					const [dnx, dny, dnz] = face.neighborOffset;
					const nx2 = vx + dnx;
					const ny2 = vy + dny;
					const nz2 = vz + dnz;

					// Cull face if neighbor is occupied (or out-of-bounds = no face).
					const neighborOccupied =
						nx2 >= 0 && nx2 < vW && ny2 >= 0 && ny2 < vH && nz2 >= 0 && nz2 < vL &&
						grid[editGridIndex(nx2, ny2, nz2, vW, vL)] !== 0;
					if (neighborOccupied) continue;

					const vertexIndex = positions.length / 3;
					const [fnx, fny, fnz] = face.normal;

					for (const [fcx, fcy, fcz] of face.corners) {
						positions.push(
							cx + fcx * voxelSize,
							cy + fcy * voxelSize,
							cz + fcz * voxelSize,
						);
						normals.push(fnx, fny, fnz);
						colors.push(CHUNK_VOXEL_COLOR.r, CHUNK_VOXEL_COLOR.g, CHUNK_VOXEL_COLOR.b);
					}

					indices.push(
						vertexIndex,
						vertexIndex + 1,
						vertexIndex + 2,
						vertexIndex,
						vertexIndex + 2,
						vertexIndex + 3,
					);
				}
			}
		}
	}

	if (positions.length === 0) return null;

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute("normal",   new THREE.Float32BufferAttribute(normals,   3));
	geometry.setAttribute("color",    new THREE.Float32BufferAttribute(colors,    3));
	geometry.setIndex(indices);
	geometry.computeBoundingSphere();
	return geometry;
}

function rebuildChunk(
	chunkIdx: number,
	cx: number, cy: number, cz: number,
	grid: EditGrid,
	dims: ChunkDims,
	chunkGroup: THREE.Group,
	material: THREE.MeshStandardMaterial,
	chunkMeshes: Map<number, THREE.Mesh | null>,
): void {
	const old = chunkMeshes.get(chunkIdx);
	if (old) {
		chunkGroup.remove(old);
		old.geometry.dispose();
	}

	const geometry = buildChunkGeometry(grid, dims, cx, cy, cz);
	if (!geometry) {
		chunkMeshes.set(chunkIdx, null);
		return;
	}

	const mesh = new THREE.Mesh(geometry, material);
	chunkGroup.add(mesh);
	chunkMeshes.set(chunkIdx, mesh);
}

function clearAllChunkMeshes(
	chunkGroup: THREE.Group,
	chunkMeshes: Map<number, THREE.Mesh | null>,
): void {
	for (const mesh of chunkMeshes.values()) {
		if (mesh) {
			chunkGroup.remove(mesh);
			mesh.geometry.dispose();
		}
	}
	chunkMeshes.clear();
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function isVoxelInBounds(index: VoxelTerrainIndex, coord: VoxelCoord): boolean {
	return (
		coord.x >= 0 && coord.x < index.voxelWidth &&
		coord.y >= 0 && coord.y < index.voxelHeight &&
		coord.z >= 0 && coord.z < index.voxelLength
	);
}

function pointToVoxelCoord(point: THREE.Vector3, index: VoxelTerrainIndex): VoxelCoord {
	return {
		x: Math.floor((point.x + index.width  / 2) * index.resolution),
		y: Math.floor((point.y + 0.5)          * index.resolution),
		z: Math.floor((point.z + index.length / 2) * index.resolution),
	};
}

function getBrushOffsets(size: number): number[] {
	const safeSize = clamp(Math.floor(size) || MIN_BRUSH_SIZE, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
	const start = -Math.floor((safeSize - 1) / 2);
	return Array.from({ length: safeSize }, (_, i) => start + i);
}

function getPlaneBrushCoords(
	origin: VoxelCoord,
	normal: VoxelCoord,
	brushSize: number,
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
	index: VoxelTerrainIndex,
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
	brushSize: number,
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
		return getPlaneBrushCoords(origin, normal, brushSize).filter((c) =>
			isVoxelInBounds(index, c)
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

// ---------------------------------------------------------------------------
// Apply stamp -- writes the stamp source into the editGrid at an anchor coord
//
// Anchor = the destination voxel the source's bottom-center maps to. The
// caller picks this from PickInfo (typically pick.voxel + pick.normal so the
// stamp sits *on top* of the clicked face). Source-solid voxels paint over
// destination (additive only). Out-of-bounds offsets clip silently. Pulls
// transformed offsets from VoxelStampUtils.iterateStampVoxels so this routine
// only handles the grid write.
// ---------------------------------------------------------------------------

function applyStampToGrid(
	grid: EditGrid,
	dirtyChunks: Set<number>,
	dims: ChunkDims,
	anchor: VoxelCoord,
	source: VoxelTerrain,
	transform: StampTransform,
): { changed: boolean; countDelta: number } {
	const { vW, vH, vL, resolution } = dims;
	let changed = false;
	let countDelta = 0;

	for (const offset of iterateStampVoxels(source, resolution, transform)) {
		const x = anchor.x + offset.x;
		const y = anchor.y + offset.y;
		const z = anchor.z + offset.z;
		if (x < 0 || x >= vW || y < 0 || y >= vH || z < 0 || z >= vL) continue;

		const gIdx = editGridIndex(x, y, z, vW, vL);
		const next = offset.color + 1;
		if (grid[gIdx] === next) continue;
		if (grid[gIdx] === 0) countDelta++;
		grid[gIdx] = next;
		markVoxelDirtyChunks(x, y, z, dirtyChunks, dims);
		changed = true;
	}

	return { changed, countDelta };
}

// ---------------------------------------------------------------------------
// Apply edit -- writes directly to the editGrid (O(1) per voxel)
// ---------------------------------------------------------------------------

function applyVoxelEdit(
	grid: EditGrid,
	index: VoxelTerrainIndex,
	dirtyChunks: Set<number>,
	dims: ChunkDims,
	pick: PickInfo,
	tool: EditorTool,
	granularity: EditGranularity,
	brushSize: number,
	colorIndex: number,
): { changed: boolean; sampledColor: number | null; countDelta: number } {
	const { vW, vH, vL } = dims;

	if (tool === "sample") {
		const sampledColor = editGridGetColor(grid, pick.voxel.x, pick.voxel.y, pick.voxel.z, vW, vH, vL);
		return { changed: false, sampledColor, countDelta: 0 };
	}

	const coords = collectAffectedCoords(index, pick, tool, granularity, brushSize);
	let changed = false;
	let countDelta = 0;

	for (const { x, y, z } of coords) {
		if (x < 0 || x >= vW || y < 0 || y >= vH || z < 0 || z >= vL) continue;
		const gIdx = editGridIndex(x, y, z, vW, vL);

		if (tool === "erase") {
			if (grid[gIdx] !== 0) {
				grid[gIdx] = 0;
				markVoxelDirtyChunks(x, y, z, dirtyChunks, dims);
				changed = true;
				countDelta--;
			}
			continue;
		}

		if (tool === "paint") {
			const cur = grid[gIdx];
			if (cur !== 0 && cur - 1 !== colorIndex) {
				grid[gIdx] = colorIndex + 1;
				markVoxelDirtyChunks(x, y, z, dirtyChunks, dims);
				changed = true;
			}
			continue;
		}

		// place
		if (grid[gIdx] === 0) {
			grid[gIdx] = colorIndex + 1;
			markVoxelDirtyChunks(x, y, z, dirtyChunks, dims);
			changed = true;
			countDelta++;
		}
	}

	return { changed, sampledColor: null, countDelta };
}

// ---------------------------------------------------------------------------
// Three.js scene helpers
// ---------------------------------------------------------------------------

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
	if (Array.isArray(material)) {
		for (const m of material) m.dispose();
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
	opacity: number,
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
	tW: number,
	tH: number,
	tL: number,
	color: number,
	opacity: number,
): THREE.LineSegments {
	const minX = -tW / 2, maxX = tW / 2;
	const minY = -0.5,    maxY = tH - 0.5;
	const minZ = -tL / 2, maxZ = tL / 2;
	const corners = [
		[minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ],
		[minX, maxY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ], [minX, maxY, maxZ],
	];
	const edges = [
		[0,1],[1,2],[2,3],[3,0],
		[4,5],[5,6],[6,7],[7,4],
		[0,4],[1,5],[2,6],[3,7],
	];
	const points: number[] = [];
	for (const [a, b] of edges) {
		points.push(...corners[a], ...corners[b]);
	}
	return createGridLineSegments(points, color, opacity);
}

function addTopRectangle(
	points: number[],
	minX: number, maxX: number,
	y: number,
	minZ: number, maxZ: number,
): void {
	points.push(minX, y, minZ, maxX, y, minZ);
	points.push(maxX, y, minZ, maxX, y, maxZ);
	points.push(maxX, y, maxZ, minX, y, maxZ);
	points.push(minX, y, maxZ, minX, y, minZ);
}

// Iterate voxels whose +Y neighbor is empty (top-exposed surfaces).
function* iterateTopExposedVoxels(
	grid: EditGrid,
	dims: ChunkDims,
): Generator<{ x: number; y: number; z: number }> {
	const { vW, vH, vL } = dims;
	for (let y = 0; y < vH; y++) {
		for (let z = 0; z < vL; z++) {
			for (let x = 0; x < vW; x++) {
				if (grid[editGridIndex(x, y, z, vW, vL)] === 0) continue;
				const atTop = y + 1 >= vH || grid[editGridIndex(x, y + 1, z, vW, vL)] === 0;
				if (atTop) yield { x, y, z };
			}
		}
	}
}

function createVoxelSurfaceGrid(
	grid: EditGrid,
	dims: ChunkDims,
	color: number,
	opacity: number,
): THREE.LineSegments | null {
	const { resolution: r, tW, tL } = dims;
	const halfW = tW / 2;
	const halfL = tL / 2;
	const points: number[] = [];

	for (const { x, y, z } of iterateTopExposedVoxels(grid, dims)) {
		const minX = x / r - halfW;
		const maxX = (x + 1) / r - halfW;
		const yy   = (y + 1) / r - 0.5 + GRID_LINE_OFFSET;
		const minZ = z / r - halfL;
		const maxZ = (z + 1) / r - halfL;
		addTopRectangle(points, minX, maxX, yy, minZ, maxZ);
	}

	if (points.length === 0) return null;
	return createGridLineSegments(points, color, opacity);
}

function createTacticalSurfaceGrid(
	grid: EditGrid,
	dims: ChunkDims,
	color: number,
	opacity: number,
): THREE.LineSegments | null {
	const { resolution: r, tW, tL } = dims;
	const halfW = tW / 2;
	const halfL = tL / 2;
	const points: number[] = [];

	for (const { x, y, z } of iterateTopExposedVoxels(grid, dims)) {
		const minX = x / r - halfW;
		const maxX = (x + 1) / r - halfW;
		const yy   = (y + 1) / r - 0.5 + GRID_LINE_OFFSET * 2;
		const minZ = z / r - halfL;
		const maxZ = (z + 1) / r - halfL;

		if (x % r === 0)       points.push(minX, yy, minZ, minX, yy, maxZ);
		if ((x + 1) % r === 0) points.push(maxX, yy, minZ, maxX, yy, maxZ);
		if (z % r === 0)       points.push(minX, yy, minZ, maxX, yy, minZ);
		if ((z + 1) % r === 0) points.push(minX, yy, maxZ, maxX, yy, maxZ);
	}

	if (points.length === 0) return null;
	return createGridLineSegments(points, color, opacity);
}

function rebuildGrid(
	resources: EditorSceneResources,
	grid: EditGrid,
	dims: ChunkDims,
	showTacticalGrid: boolean,
	showVoxelGrid: boolean,
): void {
	clearObjectGroup(resources.gridGroup);

	if (showVoxelGrid && dims.resolution > 1) {
		const voxelGrid = createVoxelSurfaceGrid(grid, dims, 0xf59e0b, 0.38);
		if (voxelGrid) resources.gridGroup.add(voxelGrid);
	}

	if (showTacticalGrid) {
		const tacticalGrid = createTacticalSurfaceGrid(grid, dims, 0x14b8a6, 0.68);
		if (tacticalGrid) resources.gridGroup.add(tacticalGrid);
	}

	resources.gridGroup.add(
		createBoundsFrame(dims.tW, dims.vH / dims.resolution, dims.tL, 0xe5e7eb, 0.32)
	);
}

// ---------------------------------------------------------------------------
// Hover indicator geometry
// ---------------------------------------------------------------------------

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
		terrainPaletteIndexToVoxelColor(normalizeVoxelPaletteIndex(colorIndex))
	);
	const lum = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
	return lum > 0.62
		? color.multiplyScalar(0.48)
		: color.lerp(new THREE.Color(0xffffff), 0.5);
}

function addVoxelFaceToGeometry(
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
			addVoxelFaceToGeometry(positions, colors, indices, center, index.voxelSize, face, color, HOVER_FACE_OFFSET);
		}
	}

	if (positions.length === 0) return null;

	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geo.setAttribute("color",    new THREE.Float32BufferAttribute(colors, 3));
	geo.setIndex(indices);
	geo.computeBoundingSphere();
	return geo;
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
			addVoxelFaceToGeometry(positions, colors, indices, center, index.voxelSize, face, white, 0);
		}
	}

	if (positions.length === 0) return null;

	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geo.setAttribute("color",    new THREE.Float32BufferAttribute(colors, 3));
	geo.setIndex(indices);
	geo.computeBoundingSphere();
	return geo;
}

function createStampGhostGeometry(
	source: VoxelTerrain,
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
			addVoxelFaceToGeometry(
				positions, colors, indices,
				center, index.voxelSize, face, tmpColor, HOVER_FACE_OFFSET,
			);
		}
	}

	if (positions.length === 0) return null;

	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geo.setAttribute("color",    new THREE.Float32BufferAttribute(colors, 3));
	geo.setIndex(indices);
	geo.computeBoundingSphere();
	return geo;
}

function updateHoverIndicator(
	resources: EditorSceneResources,
	grid: EditGrid,
	dims: ChunkDims,
	index: VoxelTerrainIndex,
	pick: PickInfo | null,
	tool: EditorTool,
	granularity: EditGranularity,
	brushSize: number,
	colorIndex: number,
	stampSource: VoxelTerrain | null,
	stampTransform: StampTransform,
): void {
	clearObjectGroup(resources.hoverGroup);
	if (!pick) return;

	// Stamp ghost: render the (transformed) source at the bottom-center anchor
	// implied by the pick. No-op until a stamp source has been chosen.
	if (tool === "stamp") {
		if (!stampSource) return;
		const anchor: VoxelCoord = pick.ground
			? { ...pick.voxel }
			: {
				x: pick.voxel.x + pick.normal.x,
				y: pick.voxel.y + pick.normal.y,
				z: pick.voxel.z + pick.normal.z,
			};
		const geometry = createStampGhostGeometry(stampSource, stampTransform, anchor, dims, index);
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

// ---------------------------------------------------------------------------
// Camera / renderer helpers
// ---------------------------------------------------------------------------

function resizeRenderer(resources: EditorSceneResources, container: HTMLDivElement): void {
	const width  = container.clientWidth  || 1;
	const height = container.clientHeight || 1;
	const aspect = width / height;
	const halfSize = resources.camera.top;
	resources.camera.left  = -halfSize * aspect;
	resources.camera.right =  halfSize * aspect;
	resources.camera.updateProjectionMatrix();
	resources.renderer.setSize(width, height);
}

function frameCamera(
	resources: EditorSceneResources,
	terrain: VoxelTerrain,
	container: HTMLDivElement,
): void {
	const halfSize = Math.max(
		6,
		((terrain.Width + terrain.Length) / Math.SQRT2 / 2) * 1.15,
		terrain.Height * 0.9,
	);
	const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
	const camera   = resources.camera;
	const controls = resources.controls;
	const centerY  = Math.max(0, terrain.Height / 2 - 0.5);
	const dist     = halfSize * CAMERA_DISTANCE_MULTIPLIER;

	camera.left   = -halfSize * aspect;
	camera.right  =  halfSize * aspect;
	camera.top    =  halfSize;
	camera.bottom = -halfSize;
	camera.position.set(dist, dist, dist);
	camera.zoom = 1;
	camera.updateProjectionMatrix();
	controls.target.set(0, centerY, 0);
	controls.cursor.set(0, centerY, 0);
	controls.maxTargetRadius = Math.max(8, Math.sqrt(terrain.Width ** 2 + terrain.Length ** 2));
	controls.update();
}

function isTextInputTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName.toLowerCase();
	return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const VoxelTerrainEditor = forwardRef<VoxelTerrainEditorHandle, VoxelTerrainEditorProps>(function VoxelTerrainEditor({
	terrain,
	onChange,
	readOnly = false,
	actors,
	stampSources,
	loadStampVoxels,
}: VoxelTerrainEditorProps, ref) {
	const { setDirty } = useFormContext();
	const containerRef   = useRef<HTMLDivElement>(null);
	const resourcesRef   = useRef<EditorSceneResources | null>(null);
	// Canonical committed terrain. Updated at stroke end, undo/redo, external prop.
	const terrainRef     = useRef(terrain);
	// Live voxel state. Written per-voxel during editing; never re-encoded mid-stroke.
	const editGridRef    = useRef<EditGrid>(new Uint8Array(0));
	const occupiedVoxelCountRef = useRef(0);
	// Chunk system: meshes + pending rebuild set.
	const chunkMeshesRef = useRef<Map<number, THREE.Mesh | null>>(new Map());
	const dirtyChunksRef = useRef<Set<number>>(new Set());
	const chunkDimsRef   = useRef<ChunkDims | null>(null);
	// Undo history stored as flat-array snapshots (~25 KB each at 40x40x16 voxels).
	const undoStackRef   = useRef<Uint8Array[]>([]);
	const redoStackRef   = useRef<Uint8Array[]>([]);
	// Tool/brush state mirrors kept as refs for the event-handler hot path.
	const toolRef          = useRef<EditorTool>("place");
	const granularityRef   = useRef<EditGranularity>("tactical");
	const brushSizeRef     = useRef(1);
	const selectedColorRef = useRef(DEFAULT_TERRAIN_COLOR_INDEX);
	const readOnlyRef      = useRef(readOnly);
	const actorsRef        = useRef<ActorOverlayInfo[]>(actors ?? []);
	const showActorsRef        = useRef(true);
	const showTacticalGridRef  = useRef(true);
	const showVoxelGridRef     = useRef(true);
	const activeViewRef        = useRef<EditorView>("edit");
	const actorMarkerElemsRef = useRef<Map<string, HTMLDivElement>>(new Map());
	const actorOverlayRef  = useRef<HTMLDivElement>(null);
	// Stroke state.
	const activeStrokeRef         = useRef<ActiveStroke | null>(null);
	const strokeStartedRef        = useRef(false);
	const strokeStartSnapshotRef  = useRef<Uint8Array | null>(null);
	const lastEditKeyRef          = useRef<string | null>(null);
	// Shape change detection for camera framing.
	const lastShapeSignatureRef   = useRef<string | null>(null);
	// Tracks the last Voxels string we emitted so we can ignore our own echoes
	// when the terrain prop bounces back from the parent after onChange.
	const lastEmittedVoxelsRef    = useRef(terrain.Voxels);
	// Stable onChange ref so event-handler closures don't stale-capture the prop.
	const onChangeRef = useRef(onChange);
	// Stamp state. The hydrated source lives in a ref so the pointer/key
	// handlers can read it without re-binding; React state mirrors it for UI.
	const stampSourceRef    = useRef<VoxelTerrain | null>(null);
	const stampTransformRef = useRef<StampTransform>(IDENTITY_STAMP_TRANSFORM);
	const loadStampVoxelsRef = useRef(loadStampVoxels);
	const previousToolRef   = useRef<EditorTool>("place");
	// Hover ghost needs to refresh when the stamp transform or source changes
	// even if the cursor hasn't moved. Scene useEffect assigns to this ref so
	// the keybind effects can call back into the scene-bound closure.
	const refreshHoverRef   = useRef<(() => void) | null>(null);

	// -------------------------------------------------------------------------
	// React state
	// -------------------------------------------------------------------------

	const [activeView,        setActiveView]        = useState<EditorView>("edit");
	const [tool,              setTool]              = useState<EditorTool>("place");
	const [granularity,       setGranularity]       = useState<EditGranularity>("tactical");
	const [brushSize,         setBrushSize]         = useState(1);
	const [selectedColorIndex, setSelectedColorIndex] = useState(DEFAULT_TERRAIN_COLOR_INDEX);
	const [showTacticalGrid,  setShowTacticalGrid]  = useState(true);
	const [showVoxelGrid,     setShowVoxelGrid]      = useState(true);
	const [showActors,        setShowActors]         = useState(true);
	const [undoDepth,         setUndoDepth]          = useState(0);
	const [redoDepth,         setRedoDepth]          = useState(0);
	const [voxImportModal,    setVoxImportModal]     = useState<VoxImportModal | null>(null);
	const voxFileInputRef = useRef<HTMLInputElement>(null);
	const [stampSource,    setStampSource]    = useState<VoxelTerrain | null>(null);
	const [stampTransform, setStampTransform] = useState<StampTransform>(IDENTITY_STAMP_TRANSFORM);
	const [stampLoadingId, setStampLoadingId] = useState<string | null>(null);
	const [previewTerrain, setPreviewTerrain] = useState<VoxelTerrain | null>(null);
	// editGen ticks on stroke end, undo/redo, and external prop changes.
	// It gates React-visible updates (sidebar voxel count, grid lines, camera framing).
	// It is NEVER bumped per-voxel; Three.js geometry updates happen in the rAF loop.
	const [editGen, setEditGen] = useState(0);
	const bumpEditGen = useCallback(() => setEditGen((g) => g + 1), []);
	const markDraftDirty = useCallback(() => {
		if (!readOnlyRef.current) setDirty(true);
	}, [setDirty]);

	// Sidebar reads terrainRef for voxel count and dimensions. editGen opts the
	// expression into React's re-render cycle without re-encoding.
	void editGen;
	const displayedTerrain  = terrainRef.current;
	const voxelCount        = occupiedVoxelCountRef.current;
	const selectedTool      = TOOL_BUTTONS.find((b) => b.id === tool) ?? TOOL_BUTTONS[0];
	const resolution        = getVoxelTerrainResolution(displayedTerrain);
	const tileDimensions    = `${displayedTerrain.Width} x ${displayedTerrain.Length} x ${displayedTerrain.Height}`;
	const voxelDimensions   =
		`${displayedTerrain.Width * resolution} x ${displayedTerrain.Length * resolution} x ` +
		`${displayedTerrain.Height * resolution}`;
	const brushModeLabel    = granularity === "tactical" ? "Tile Brush" : "Voxel Brush";
	const lighting = terrain.Lighting;
	const background = terrain.Background;
	const backgroundColor = background.Color ?? DEFAULT_VOXEL_TERRAIN_BACKGROUND_COLOR;

	const createDraftTerrainSnapshot = useCallback((): VoxelTerrain => {
		const dims = chunkDimsRef.current;
		if (!dims) return terrainRef.current;
		return {
			...terrainRef.current,
			Voxels: encodeEditGrid(editGridRef.current, dims.vW, dims.vH, dims.vL),
			VoxelsLoaded: true,
		};
	}, []);

	const refreshPreviewTerrain = useCallback(() => {
		setPreviewTerrain(createDraftTerrainSnapshot());
	}, [createDraftTerrainSnapshot]);

	const emitTerrainUpdate = (nextTerrain: VoxelTerrain) => {
		terrainRef.current = nextTerrain;
		lastEmittedVoxelsRef.current = nextTerrain.Voxels;
		onChangeRef.current(nextTerrain);
	};

	const updateLighting = (updates: Partial<VoxelTerrainLighting>) => {
		if (readOnly) return;
		const nextTerrain = {
			...terrain,
			Lighting: {
				...lighting,
				...updates,
			},
		};
		emitTerrainUpdate(nextTerrain);
		if (activeViewRef.current === "preview") refreshPreviewTerrain();
	};

	const updateBackground = (updates: VoxelTerrainBackground) => {
		if (readOnly) return;
		const nextTerrain = {
			...terrain,
			Background: updates,
		};
		emitTerrainUpdate(nextTerrain);
		if (activeViewRef.current === "preview") refreshPreviewTerrain();
	};

	// -------------------------------------------------------------------------
	// Sync refs from props/state
	// -------------------------------------------------------------------------

	useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

	useEffect(() => {
		toolRef.current          = tool;
		granularityRef.current   = granularity;
		brushSizeRef.current     = brushSize;
		selectedColorRef.current = selectedColorIndex;
		readOnlyRef.current      = readOnly;
		// Tool/brush changes affect the hover ghost; reflect them without
		// waiting for the next pointer move (matters when leaving stamp mode).
		refreshHoverRef.current?.();
	}, [tool, granularity, brushSize, selectedColorIndex, readOnly]);

	useEffect(() => { actorsRef.current    = actors ?? []; }, [actors]);
	useEffect(() => { showActorsRef.current = showActors;  }, [showActors]);
	useEffect(() => { showTacticalGridRef.current = showTacticalGrid; }, [showTacticalGrid]);
	useEffect(() => { showVoxelGridRef.current    = showVoxelGrid;    }, [showVoxelGrid]);
	useEffect(() => { activeViewRef.current = activeView; }, [activeView]);
	useEffect(() => {
		stampSourceRef.current = stampSource;
		// Repaint the ghost so a new source's preview appears immediately.
		refreshHoverRef.current?.();
	}, [stampSource]);
	useEffect(() => {
		stampTransformRef.current = stampTransform;
		// R/M presses don't move the cursor, so push the new orientation.
		refreshHoverRef.current?.();
	}, [stampTransform]);
	useEffect(() => { loadStampVoxelsRef.current = loadStampVoxels; }, [loadStampVoxels]);

	// -------------------------------------------------------------------------
	// Terrain prop adoption
	// -------------------------------------------------------------------------

	useEffect(() => {
		// Skip our own echo: the parent re-renders after our onChange call and
		// passes back the same Voxels string we just emitted.
		if (
			createTerrainRevision(terrain) === createTerrainRevision(terrainRef.current) &&
			terrain.Voxels === lastEmittedVoxelsRef.current
		) {
			terrainRef.current = terrain;
			return;
		}

		// External change (network sync, resize, VOX import, initial mount swap).
		terrainRef.current = terrain;
		lastEmittedVoxelsRef.current = terrain.Voxels;

		const index = getVoxelTerrainIndex(terrain);
		const newDims = computeChunkDims(index);
		const oldDims = chunkDimsRef.current;
		const shapeChanged =
			!oldDims ||
			oldDims.vW !== newDims.vW ||
			oldDims.vH !== newDims.vH ||
			oldDims.vL !== newDims.vL;

		chunkDimsRef.current = newDims;

		// Rebuild editGrid (or resize it if grid dimensions changed).
		const newGrid = buildEditGrid(terrain, index);
		if (editGridRef.current.length === newGrid.length) {
			editGridRef.current.set(newGrid);
		} else {
			editGridRef.current = newGrid;
		}
		occupiedVoxelCountRef.current = countEditGridVoxels(newGrid);

		const resources = resourcesRef.current;
		if (shapeChanged && resources) {
			clearAllChunkMeshes(resources.chunkGroup, chunkMeshesRef.current);
			clearObjectGroup(resources.hoverGroup);
			const container = containerRef.current;
			if (container) frameCamera(resources, terrain, container);
		}

		markAllChunksDirty(dirtyChunksRef.current, newDims);
		bumpEditGen();
	}, [terrain, bumpEditGen]);

	// Clear undo history when switching to a different terrain entirely.
	useEffect(() => {
		undoStackRef.current = [];
		redoStackRef.current = [];
		setUndoDepth(0);
		setRedoDepth(0);
		lastShapeSignatureRef.current = null;
	}, [terrain.Id]);

	// -------------------------------------------------------------------------
	// Draft commit (called once at stroke end -- never per-rAF)
	// -------------------------------------------------------------------------

	const commitDraftChange = useCallback(() => {
		bumpEditGen();
		markDraftDirty();
		if (activeViewRef.current === "preview") refreshPreviewTerrain();
	}, [bumpEditGen, markDraftDirty, refreshPreviewTerrain]);

	const materializeTerrain = useCallback((): VoxelTerrain => {
		const nextTerrain = createDraftTerrainSnapshot();
		terrainRef.current = nextTerrain;
		lastEmittedVoxelsRef.current = nextTerrain.Voxels;
		return nextTerrain;
	}, [createDraftTerrainSnapshot]);

	const reshapeDraft = useCallback(
		(nextShape: {
			width: number;
			length: number;
			height: number;
			resolution: number;
		}): VoxelTerrain => {
			const oldDims =
				chunkDimsRef.current ??
				computeChunkDimsForShape(
					terrainRef.current.Width,
					terrainRef.current.Length,
					terrainRef.current.Height,
					getVoxelTerrainResolution(terrainRef.current)
				);
			const result = reshapeEditGrid(editGridRef.current, oldDims, nextShape);

			editGridRef.current = result.grid;
			chunkDimsRef.current = result.dims;
			occupiedVoxelCountRef.current = result.count;
			undoStackRef.current = [];
			redoStackRef.current = [];
			setUndoDepth(0);
			setRedoDepth(0);

			const nextTerrain: VoxelTerrain = {
				...terrainRef.current,
				Width: result.shape.width,
				Length: result.shape.length,
				Height: result.shape.height,
				Resolution: result.shape.resolution,
			};
			terrainRef.current = nextTerrain;

			const resources = resourcesRef.current;
			if (resources) {
				clearAllChunkMeshes(resources.chunkGroup, chunkMeshesRef.current);
				clearObjectGroup(resources.hoverGroup);
				markAllChunksDirty(dirtyChunksRef.current, result.dims);
				const container = containerRef.current;
				if (container) frameCamera(resources, nextTerrain, container);
				rebuildGrid(
					resources,
					editGridRef.current,
					result.dims,
					activeViewRef.current === "edit" && showTacticalGridRef.current,
					activeViewRef.current === "edit" && showVoxelGridRef.current
				);
			}

			lastShapeSignatureRef.current = null;
			commitDraftChange();
			return nextTerrain;
		},
		[commitDraftChange]
	);

	useImperativeHandle(
		ref,
		() => ({
			materializeTerrain,
			reshapeDraft,
		}),
		[materializeTerrain, reshapeDraft]
	);

	// -------------------------------------------------------------------------
	// Undo / Redo
	// -------------------------------------------------------------------------

	const recordUndo = useCallback(() => {
		const snapshot = strokeStartSnapshotRef.current;
		if (!snapshot) return;
		undoStackRef.current = [...undoStackRef.current.slice(-(UNDO_LIMIT - 1)), snapshot];
		redoStackRef.current = [];
		setUndoDepth(undoStackRef.current.length);
		setRedoDepth(0);
	}, []);

	const undo = useCallback(() => {
		if (undoStackRef.current.length === 0) return;
		const dims = chunkDimsRef.current;
		if (!dims) return;

		const currentSnapshot  = editGridRef.current.slice();
		const previousSnapshot = undoStackRef.current[undoStackRef.current.length - 1];

		redoStackRef.current = [currentSnapshot, ...redoStackRef.current].slice(0, UNDO_LIMIT);
		undoStackRef.current = undoStackRef.current.slice(0, -1);
		setUndoDepth(undoStackRef.current.length);
		setRedoDepth(redoStackRef.current.length);

		editGridRef.current.set(previousSnapshot);
		markAllChunksDirty(dirtyChunksRef.current, dims);
		occupiedVoxelCountRef.current = countEditGridVoxels(previousSnapshot);

		bumpEditGen();
		markDraftDirty();
	}, [bumpEditGen, markDraftDirty]);

	const redo = useCallback(() => {
		if (redoStackRef.current.length === 0) return;
		const dims = chunkDimsRef.current;
		if (!dims) return;

		const currentSnapshot = editGridRef.current.slice();
		const nextSnapshot    = redoStackRef.current[0];

		undoStackRef.current = [...undoStackRef.current.slice(-(UNDO_LIMIT - 1)), currentSnapshot];
		redoStackRef.current = redoStackRef.current.slice(1);
		setUndoDepth(undoStackRef.current.length);
		setRedoDepth(redoStackRef.current.length);

		editGridRef.current.set(nextSnapshot);
		markAllChunksDirty(dirtyChunksRef.current, dims);
		occupiedVoxelCountRef.current = countEditGridVoxels(nextSnapshot);

		bumpEditGen();
		markDraftDirty();
	}, [bumpEditGen, markDraftDirty]);

	// -------------------------------------------------------------------------
	// Apply edit (writes directly to editGrid -- no React, no encode)
	// -------------------------------------------------------------------------

	const applyEdit = useCallback((pick: PickInfo): boolean => {
		if (readOnlyRef.current) return false;

		const index = getVoxelTerrainIndex(terrainRef.current);
		const dims  = chunkDimsRef.current;
		if (!dims) return false;

		// Stamp tool diverges from the brush flow: it writes the hydrated
		// source's voxels at a bottom-center anchor derived from the pick.
		if (toolRef.current === "stamp") {
			const source = stampSourceRef.current;
			if (!source) return false;
			const anchor: VoxelCoord = pick.ground
				? { ...pick.voxel }
				: {
					x: pick.voxel.x + pick.normal.x,
					y: pick.voxel.y + pick.normal.y,
					z: pick.voxel.z + pick.normal.z,
				};
			const stampResult = applyStampToGrid(
				editGridRef.current,
				dirtyChunksRef.current,
				dims,
				anchor,
				source,
				stampTransformRef.current,
			);
			if (!stampResult.changed) return false;
			occupiedVoxelCountRef.current += stampResult.countDelta;
			if (!strokeStartedRef.current) {
				recordUndo();
				strokeStartedRef.current = true;
			}
			return true;
		}

		const result = applyVoxelEdit(
			editGridRef.current,
			index,
			dirtyChunksRef.current,
			dims,
			pick,
			toolRef.current,
			granularityRef.current,
			brushSizeRef.current,
			selectedColorRef.current,
		);

		if (result.sampledColor !== null) {
			selectedColorRef.current = result.sampledColor;
			setSelectedColorIndex(result.sampledColor);
			toolRef.current = "paint";
			setTool("paint");
			return false;
		}

		if (!result.changed) return false;
		occupiedVoxelCountRef.current += result.countDelta;

		if (!strokeStartedRef.current) {
			recordUndo();
			strokeStartedRef.current = true;
		}

		// No schedulePendingTerrainChange here. The rAF loop rebuilds dirty chunks
		// automatically; persisted encoding is deferred until the form saves.
		return true;
	}, [recordUndo]);

	// -------------------------------------------------------------------------
	// Stamp mode entry/exit
	// -------------------------------------------------------------------------

	const exitStampMode = useCallback(() => {
		// Restore the brush tool the user was on before they opened a stamp.
		// previousToolRef defaults to "place" so we always have a sensible fallback.
		setTool(previousToolRef.current);
		setStampSource(null);
		setStampTransform(IDENTITY_STAMP_TRANSFORM);
		setStampLoadingId(null);
	}, []);

	const selectStamp = useCallback(async (terrainId: string) => {
		const loader = loadStampVoxelsRef.current;
		if (!loader) return;
		// Remember the brush tool so ESC can return to it.
		if (toolRef.current !== "stamp") {
			previousToolRef.current = toolRef.current;
		}
		setStampLoadingId(terrainId);
		try {
			const hydrated = await loader(terrainId);
			if (!hydrated) {
				console.warn(`[VoxelTerrainEditor] Failed to load stamp source: ${terrainId}`);
				setStampLoadingId(null);
				return;
			}
			setStampSource(hydrated);
			setStampTransform(IDENTITY_STAMP_TRANSFORM);
			setTool("stamp");
		} finally {
			setStampLoadingId((current) => (current === terrainId ? null : current));
		}
	}, []);

	const getEditKey = useCallback((pick: PickInfo): string => {
		// In stamp mode the brush params are irrelevant; the orientation and
		// source identity matter instead, so each anchor + transform pair is a
		// distinct edit.
		if (toolRef.current === "stamp") {
			const source = stampSourceRef.current;
			const transform = stampTransformRef.current;
			return [
				"stamp",
				source?.Id ?? "none",
				transform.rotation,
				transform.mirror ? 1 : 0,
				pick.voxel.x, pick.voxel.y, pick.voxel.z,
				pick.normal.x, pick.normal.y, pick.normal.z,
			].join(":");
		}
		return [
			toolRef.current,
			granularityRef.current,
			brushSizeRef.current,
			pick.voxel.x, pick.voxel.y, pick.voxel.z,
			pick.normal.x, pick.normal.y, pick.normal.z,
		].join(":");
	}, []);

	// -------------------------------------------------------------------------
	// Picking -- DDA raycasting replaces BVH mesh intersection
	// -------------------------------------------------------------------------

	const getPickInfo = useCallback((event: PointerEvent): PickInfo | null => {
		const resources = resourcesRef.current;
		if (!resources) return null;

		const dims = chunkDimsRef.current;
		if (!dims) return null;

		const rect = resources.renderer.domElement.getBoundingClientRect();
		const mouse = new THREE.Vector2(
			((event.clientX - rect.left) / rect.width)  *  2 - 1,
			-((event.clientY - rect.top)  / rect.height) *  2 + 1,
		);

		const raycaster = new THREE.Raycaster();
		raycaster.setFromCamera(mouse, resources.camera);

		const hit = raycastVoxelGrid(
			raycaster.ray,
			editGridRef.current,
			dims.vW, dims.vH, dims.vL,
			dims.resolution,
			dims.tW, dims.tL,
		);

		if (hit) {
			const { vx, vy, vz, nx, ny, nz } = hit;
			const normal = new THREE.Vector3(nx, ny, nz);
			const voxelCenter = new THREE.Vector3(
				(vx + 0.5) / dims.resolution - dims.tW / 2,
				(vy + 0.5) / dims.resolution - 0.5,
				(vz + 0.5) / dims.resolution - dims.tL / 2,
			);
			const facePoint = voxelCenter.clone().addScaledVector(normal, 0.5 / dims.resolution);
			return {
				voxel:  { x: vx, y: vy, z: vz },
				normal: { x: nx, y: ny, z: nz },
				ground: false,
				plane:  new THREE.Plane().setFromNormalAndCoplanarPoint(normal, facePoint),
			};
		}

		// Fall back to ground plane hit.
		const index = getVoxelTerrainIndex(terrainRef.current);
		const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.5);
		const groundPoint = new THREE.Vector3();
		if (!raycaster.ray.intersectPlane(groundPlane, groundPoint)) return null;

		const voxel = {
			x: Math.floor((groundPoint.x + index.width  / 2) * index.resolution),
			y: 0,
			z: Math.floor((groundPoint.z + index.length / 2) * index.resolution),
		};
		if (!isVoxelInBounds(index, voxel)) return null;

		return {
			voxel,
			normal: { x: 0, y: 1, z: 0 },
			ground: true,
			plane:  groundPlane.clone(),
		};
	}, []);

	const getLockedPlanePickInfo = useCallback((
		event: PointerEvent,
		lockedPlane: LockedStrokePlane,
	): PickInfo | null => {
		const resources = resourcesRef.current;
		if (!resources) return null;

		const index = getVoxelTerrainIndex(terrainRef.current);
		const rect  = resources.renderer.domElement.getBoundingClientRect();
		const mouse = new THREE.Vector2(
			((event.clientX - rect.left) / rect.width)  *  2 - 1,
			-((event.clientY - rect.top)  / rect.height) *  2 + 1,
		);

		const raycaster = new THREE.Raycaster();
		raycaster.setFromCamera(mouse, resources.camera);

		const pt = new THREE.Vector3();
		if (!raycaster.ray.intersectPlane(lockedPlane.plane, pt)) return null;

		const voxel = lockedPlane.ground
			? {
				x: Math.floor((pt.x + index.width  / 2) * index.resolution),
				y: 0,
				z: Math.floor((pt.z + index.length / 2) * index.resolution),
			}
			: pointToVoxelCoord(
				pt.clone().addScaledVector(
					new THREE.Vector3(lockedPlane.normal.x, lockedPlane.normal.y, lockedPlane.normal.z).normalize(),
					-PICK_EPSILON,
				),
				index,
			);

		if (!isVoxelInBounds(index, voxel)) return null;

		return {
			voxel,
			normal: { ...lockedPlane.normal },
			ground: lockedPlane.ground,
			plane:  lockedPlane.plane.clone(),
		};
	}, []);

	// -------------------------------------------------------------------------
	// Imperative actor overlay
	// -------------------------------------------------------------------------

	useEffect(() => {
		const overlay = actorOverlayRef.current;
		if (!overlay) return;
		while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
		const newMap = new Map<string, HTMLDivElement>();
		for (const actor of actors ?? []) {
			const wrapper = document.createElement("div");
			wrapper.className = "tooltip tooltip-top";
			wrapper.setAttribute("data-tip", actor.name);
			wrapper.style.cssText = "position:absolute;left:0;top:0;display:none;pointer-events:auto;z-index:10";
			const dot = document.createElement("div");
			dot.style.cssText =
				"width:14px;height:14px;border-radius:50%;background:rgba(167,139,250,0.65);" +
				"border:1.5px solid rgba(167,139,250,0.9);box-shadow:0 1px 3px rgba(0,0,0,0.45)";
			wrapper.appendChild(dot);
			overlay.appendChild(wrapper);
			newMap.set(actor.id, wrapper);
		}
		actorMarkerElemsRef.current = newMap;
	}, [actors]);

	// -------------------------------------------------------------------------
	// Three.js mount (runs once)
	// -------------------------------------------------------------------------

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		// --- Renderer ---
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

		// --- Scene ---
		const scene = new THREE.Scene();
		scene.background = null;

		// --- Camera ---
		const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
		const camera = new THREE.OrthographicCamera(
			-INITIAL_CAMERA_HALF_SIZE * aspect,
			 INITIAL_CAMERA_HALF_SIZE * aspect,
			 INITIAL_CAMERA_HALF_SIZE,
			-INITIAL_CAMERA_HALF_SIZE,
			-100, 1000,
		);
		const initialDist = INITIAL_CAMERA_HALF_SIZE * CAMERA_DISTANCE_MULTIPLIER;
		camera.position.set(initialDist, initialDist, initialDist);

		// --- Lighting ---
		scene.add(new THREE.HemisphereLight(0xffffff, 0x94a3b8, Math.PI * 0.75));
		const directional = new THREE.DirectionalLight(0xffffff, Math.PI * 1.6);
		directional.position.set(18, 32, 22);
		scene.add(directional);

		// --- Controls ---
		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		controls.dampingFactor = 0.08;
		controls.minZoom = 0.4;
		controls.maxZoom = 10;
		controls.mouseButtons.LEFT   = null as unknown as THREE.MOUSE;
		controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
		controls.mouseButtons.RIGHT  = THREE.MOUSE.PAN;
		controls.update();

		// --- Scene groups ---
		const gridGroup  = new THREE.Group();
		const hoverGroup = new THREE.Group();
		const chunkGroup = new THREE.Group();
		scene.add(gridGroup, hoverGroup, chunkGroup);

		const terrainMaterial = new THREE.MeshStandardMaterial({
			roughness: 0.78,
			metalness: 0,
			vertexColors: true,
		});

		const resources: EditorSceneResources = {
			scene, camera, renderer, controls,
			gridGroup, hoverGroup, chunkGroup,
			terrainMaterial,
		};
		resourcesRef.current = resources;

		// --- Initialize edit grid and chunk system from current terrain ---
		const initTerrain = terrainRef.current;
		const initIndex   = getVoxelTerrainIndex(initTerrain);
		const initDims    = computeChunkDims(initIndex);
		chunkDimsRef.current  = initDims;
		editGridRef.current   = buildEditGrid(initTerrain, initIndex);
		occupiedVoxelCountRef.current = countEditGridVoxels(editGridRef.current);
		markAllChunksDirty(dirtyChunksRef.current, initDims);
		frameCamera(resources, initTerrain, container);
		lastShapeSignatureRef.current =
			`${initIndex.width}:${initIndex.length}:${initIndex.height}:${initIndex.resolution}`;

		// --- Actor marker projection (rAF, imperative) ---
		const updateActorMarkers = () => {
			const overlay     = actorOverlayRef.current;
			const markerElems = actorMarkerElemsRef.current;
			const currActors  = actorsRef.current;
			const shouldShow  = showActorsRef.current;
			if (!overlay || markerElems.size === 0) return;

			if (!shouldShow) {
				markerElems.forEach((el) => { el.style.display = "none"; });
				return;
			}

			const currTerrain = terrainRef.current;
			const canvasW = renderer.domElement.clientWidth  || 1;
			const canvasH = renderer.domElement.clientHeight || 1;

			for (const actor of currActors) {
				const el = markerElems.get(actor.id);
				if (!el) continue;
				const worldX = actor.position.x + 0.5 - currTerrain.Width  / 2;
				const worldZ = actor.position.y + 0.5 - currTerrain.Length / 2;
				const worldY = terrainHeightToWorldY(actor.position.h) + ACTOR_OVERLAY_FLOAT_Y;
				const vec = new THREE.Vector3(worldX, worldY, worldZ);
				vec.project(camera);
				if (vec.z > 1) { el.style.display = "none"; continue; }
				const sx = ((vec.x + 1) / 2) * canvasW;
				const sy = ((-vec.y + 1) / 2) * canvasH;
				el.style.display = "";
				el.style.transform = `translate(calc(${sx}px - 50%), calc(${sy}px - 50%))`;
			}
		};

		// --- rAF loop: rebuild dirty chunks, then render ---
		let rafId = 0;
		const animate = () => {
			rafId = requestAnimationFrame(animate);

			// Rebuild any chunks dirtied by edits this frame.
			const dirty = dirtyChunksRef.current;
			if (dirty.size > 0) {
				const grid = editGridRef.current;
				const dims = chunkDimsRef.current;
				if (dims) {
					for (const idx of dirty) {
						const cx =  idx % dims.chunksX;
						const rem = Math.floor(idx / dims.chunksX);
						const cz = rem % dims.chunksZ;
						const cy = Math.floor(rem / dims.chunksZ);
						rebuildChunk(
							idx, cx, cy, cz,
							grid, dims,
							chunkGroup, terrainMaterial,
							chunkMeshesRef.current,
						);
					}
					dirty.clear();
					// Grid lines follow the same dirty cadence as chunks so they stay
					// flush with the terrain surface during a stroke, not floating at
					// the last-committed state.
					rebuildGrid(
						resources, grid, dims,
						activeViewRef.current === "edit" && showTacticalGridRef.current,
						activeViewRef.current === "edit" && showVoxelGridRef.current,
					);
				}
			}

			controls.update();
			renderer.render(scene, camera);
			updateActorMarkers();
		};
		animate();

		// --- Resize observer ---
		const resizeObserver = new ResizeObserver(() => {
			resizeRenderer(resources, container);
		});
		resizeObserver.observe(container);

		// --- Shared hover refresh helper ---
		// Caches the most recent pick so external callers (stamp R/M presses)
		// can re-render the ghost without a new pointer event.
		let lastHoverPick: PickInfo | null = null;
		const refreshHover = (pick: PickInfo | null) => {
			lastHoverPick = pick;
			const dims = chunkDimsRef.current;
			if (!dims) return;
			if (activeViewRef.current !== "edit") {
				clearObjectGroup(resources.hoverGroup);
				return;
			}
			updateHoverIndicator(
				resources,
				editGridRef.current,
				dims,
				getVoxelTerrainIndex(terrainRef.current),
				pick,
				toolRef.current,
				granularityRef.current,
				brushSizeRef.current,
				selectedColorRef.current,
				stampSourceRef.current,
				stampTransformRef.current,
			);
		};
		refreshHoverRef.current = () => refreshHover(lastHoverPick);

		const getPickForStroke = (
			event: PointerEvent,
			activeStroke: ActiveStroke | null,
		): PickInfo | null => {
			if (activeStroke && !event.shiftKey) {
				return getLockedPlanePickInfo(event, activeStroke.lockedPlane);
			}
			return getPickInfo(event);
		};

		const hasMovedPastDragThreshold = (
			event: PointerEvent,
			stroke: ActiveStroke,
		): boolean => {
			const dx = event.clientX - stroke.startClientX;
			const dy = event.clientY - stroke.startClientY;
			return dx * dx + dy * dy >= STROKE_DRAG_THRESHOLD_PX ** 2;
		};

		const clearStrokeState = () => {
			activeStrokeRef.current        = null;
			strokeStartedRef.current       = false;
			strokeStartSnapshotRef.current = null;
			lastEditKeyRef.current         = null;
		};

		// --- Pointer handlers ---
		const handlePointerMove = (event: PointerEvent) => {
			if (activeViewRef.current !== "edit") return;
			const activeStroke =
				activeStrokeRef.current?.pointerId === event.pointerId
					? activeStrokeRef.current : null;
			const pick = getPickForStroke(event, activeStroke);
			refreshHover(pick);
			// Sample is one-shot; stamp is one-per-click. Both skip drag-painting.
			if (
				!activeStroke ||
				!pick ||
				toolRef.current === "sample" ||
				toolRef.current === "stamp"
			) return;

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
			if (activeViewRef.current !== "edit") return;
			if (event.button === 1) { event.preventDefault(); return; }
			if (event.button !== 0 || readOnlyRef.current) return;
			event.preventDefault();

			const pick = getPickInfo(event);
			if (!pick) return;

			renderer.domElement.setPointerCapture(event.pointerId);

			const activeStroke: ActiveStroke = {
				pointerId:    event.pointerId,
				startClientX: event.clientX,
				startClientY: event.clientY,
				dragStarted:  false,
				lockedPlane: {
					plane:  pick.plane.clone(),
					normal: { ...pick.normal },
					ground: pick.ground,
				},
			};
			activeStrokeRef.current        = activeStroke;
			strokeStartedRef.current       = false;
			strokeStartSnapshotRef.current = editGridRef.current.slice();
			lastEditKeyRef.current         = getEditKey(pick);

			const wasSampleTool = toolRef.current === "sample";
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
			if (strokeStartedRef.current) {
				commitDraftChange();
			}
			clearStrokeState();
		};

		const handlePointerLeave = () => {
			if (!activeStrokeRef.current) refreshHover(null);
		};

		const preventContextMenu       = (e: MouseEvent) => e.preventDefault();
		const preventMiddleMouseScroll = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };

		renderer.domElement.addEventListener("pointermove",  handlePointerMove);
		renderer.domElement.addEventListener("pointerdown",  handlePointerDown, true);
		renderer.domElement.addEventListener("pointerup",    finishStroke);
		renderer.domElement.addEventListener("pointercancel", finishStroke);
		renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
		renderer.domElement.addEventListener("mousedown",    preventMiddleMouseScroll, true);
		renderer.domElement.addEventListener("auxclick",     preventMiddleMouseScroll);
		renderer.domElement.addEventListener("contextmenu",  preventContextMenu);

		return () => {
			cancelAnimationFrame(rafId);
			resizeObserver.disconnect();
			renderer.domElement.removeEventListener("pointermove",   handlePointerMove);
			renderer.domElement.removeEventListener("pointerdown",   handlePointerDown, true);
			renderer.domElement.removeEventListener("pointerup",     finishStroke);
			renderer.domElement.removeEventListener("pointercancel", finishStroke);
			renderer.domElement.removeEventListener("pointerleave",  handlePointerLeave);
			renderer.domElement.removeEventListener("mousedown",     preventMiddleMouseScroll, true);
			renderer.domElement.removeEventListener("auxclick",      preventMiddleMouseScroll);
			renderer.domElement.removeEventListener("contextmenu",   preventContextMenu);
			controls.dispose();
			clearAllChunkMeshes(chunkGroup, chunkMeshesRef.current);
			terrainMaterial.dispose();
			disposeObjectTree(gridGroup);
			disposeObjectTree(hoverGroup);
			renderer.dispose();
			if (renderer.domElement.parentElement === container) {
				container.removeChild(renderer.domElement);
			}
			activeStrokeRef.current = null;
			resourcesRef.current    = null;
			refreshHoverRef.current = null;
		};
	}, [applyEdit, commitDraftChange, getEditKey, getLockedPlanePickInfo, getPickInfo]);

	// -------------------------------------------------------------------------
	// editGen effects (React-visible changes: camera framing, grid lines)
	// -------------------------------------------------------------------------

	useEffect(() => {
		const resources = resourcesRef.current;
		const container = containerRef.current;
		if (!resources || !container) return;

		const t = terrainRef.current;
		const index = getVoxelTerrainIndex(t);
		const sig = `${index.width}:${index.length}:${index.height}:${index.resolution}`;

		if (lastShapeSignatureRef.current !== sig) {
			clearObjectGroup(resources.hoverGroup);
			frameCamera(resources, t, container);
			lastShapeSignatureRef.current = sig;
		}
	}, [editGen]);

	useEffect(() => {
		const resources = resourcesRef.current;
		const dims = chunkDimsRef.current;
		if (!resources || !dims) return;
		rebuildGrid(
			resources,
			editGridRef.current,
			dims,
			activeView === "edit" && showTacticalGrid,
			activeView === "edit" && showVoxelGrid
		);
		if (activeView !== "edit") clearObjectGroup(resources.hoverGroup);
		if (activeView === "preview") {
			refreshPreviewTerrain();
		}
	}, [activeView, refreshPreviewTerrain, showTacticalGrid, showVoxelGrid]);

	useEffect(() => {
		const resources = resourcesRef.current;
		const container = containerRef.current;
		if (!resources || !container) return;
		resizeRenderer(resources, container);
	}, [activeView]);

	useEffect(() => {
		const resources = resourcesRef.current;
		if (!resources) return;
		resources.renderer.domElement.style.cursor =
			readOnly || activeView !== "edit" ? "default" : "crosshair";
	}, [activeView, readOnly]);

	// -------------------------------------------------------------------------
	// Keyboard shortcuts
	// -------------------------------------------------------------------------

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (isTextInputTarget(event.target)) return;

			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
				event.preventDefault();
				if (event.shiftKey) redo(); else undo();
				return;
			}
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
				event.preventDefault();
				redo();
				return;
			}
			if (event.ctrlKey || event.metaKey || event.altKey) return;

			const key = event.key.toLowerCase();

			// In stamp mode, R/M/Escape steer the stamp instead of the brush tools.
			if (toolRef.current === "stamp") {
				if (key === "r") {
					event.preventDefault();
					setStampTransform((t) => rotateStampTransform(t));
					return;
				}
				if (key === "m") {
					event.preventDefault();
					setStampTransform((t) => mirrorStampTransform(t));
					return;
				}
				if (key === "escape") {
					event.preventDefault();
					exitStampMode();
					return;
				}
			}

			switch (key) {
				case "p": case "t": setTool("place");  break;
				case "r":           setTool("erase");  break;
				case "g":           setTool("paint");  break;
				case "i":           setTool("sample"); break;
				case "1":           setGranularity("tactical"); break;
				case "2":           setGranularity("voxel");    break;
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [exitStampMode, redo, undo]);

	// -------------------------------------------------------------------------
	// VOX import
	// -------------------------------------------------------------------------

	const handleBrushSizeChange = (value: number) => {
		setBrushSize(clamp(Math.floor(value) || MIN_BRUSH_SIZE, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE));
	};

	const showPreview = () => {
		refreshPreviewTerrain();
		setActiveView("preview");
	};

	const handleVoxImportClick = () => { voxFileInputRef.current?.click(); };

	const handleVoxFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		e.target.value = "";
		try {
			const buffer  = await file.arrayBuffer();
			const parsed  = parseVoxFile(buffer);
			const options = getVoxResolutionOptions(parsed);
			const valid   = options.filter((o) => o.fits);
			if (valid.length === 0) {
				setVoxImportModal({
					kind: "error",
					message: `This file's dimensions (${parsed.voxWidth}x${parsed.voxLength}x${parsed.voxHeight} voxels) are too large to import at any resolution. Maximum terrain size is 64x64x64 tactical units.`,
				});
				return;
			}
			if (valid.length === 1) { applyVoxImport(parsed, valid[0].resolution); return; }
			setVoxImportModal({ kind: "pick", parsed, options, selected: valid[0].resolution });
		} catch (err) {
			setVoxImportModal({
				kind: "error",
				message: err instanceof Error ? err.message : "Failed to parse .vox file.",
			});
		}
	};

	const applyVoxImport = useCallback(
		(parsed: VoxParseResult, res: number) => {
			const result     = buildTerrainFromVox(parsed, res);
			const nextTerrain = { ...terrainRef.current, ...result };
			undoStackRef.current = [];
			redoStackRef.current = [];
			setUndoDepth(0);
			setRedoDepth(0);
			setVoxImportModal(null);
			onChangeRef.current(nextTerrain);
		},
		[],
	);

	// -------------------------------------------------------------------------
	// Render
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
								onChange={(e) => handleBrushSizeChange(Number(e.target.value))}
								className="range range-sm range-primary w-28"
								disabled={readOnly}
								title="Brush size"
							/>
							<input
								type="number"
								min={MIN_BRUSH_SIZE}
								max={MAX_BRUSH_SIZE}
								value={brushSize}
								onChange={(e) => handleBrushSizeChange(Number(e.target.value))}
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

						{!readOnly && loadStampVoxels && (
							tool === "stamp" ? (
								<button
									type="button"
									className="btn btn-sm btn-warning"
									onClick={exitStampMode}
									title="Stop stamping (Esc)"
								>
									<span className="icon-[mdi--stamper] w-5 h-5" />
									ESC to stop
								</button>
							) : (
								<div className="dropdown dropdown-bottom">
									<div
										tabIndex={0}
										role="button"
										className="btn btn-sm btn-outline"
										title="Insert a stamp terrain (R rotate, M mirror, Esc stop)"
									>
										<span className="icon-[mdi--stamper] w-5 h-5" />
										Insert Stamp
										<span className="icon-[mdi--chevron-down] w-4 h-4 opacity-60" />
									</div>
									<div
										tabIndex={0}
										className="dropdown-content z-50 mt-2 w-64 max-h-80 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
									>
										{stampSources && stampSources.length > 0 ? (
											<ul className="menu menu-sm p-0">
												{stampSources.map((source) => {
													const isLoading = stampLoadingId === source.Id;
													return (
														<li key={source.Id}>
															<button
																type="button"
																onClick={() => {
																	void selectStamp(source.Id);
																	(document.activeElement as HTMLElement | null)?.blur();
																}}
																disabled={isLoading}
																className="flex items-center gap-2"
															>
																{isLoading && (
																	<span className="loading loading-spinner loading-xs" />
																)}
																<span className="truncate">{source.Name}</span>
																<span className="ml-auto text-xs opacity-60 whitespace-nowrap">
																	{source.Width}×{source.Height}×{source.Length}
																</span>
															</button>
														</li>
													);
												})}
											</ul>
										) : (
											<div className="px-2 py-1 text-xs opacity-70 leading-relaxed">
												No stamps available. Tag a terrain{" "}
												<code className="text-[0.7rem]">path:stamps</code>{" "}
												to see it here.
											</div>
										)}
									</div>
								</div>
							)
						)}

						<div className="join">
							<button
								type="button"
								className="btn btn-square btn-sm join-item btn-outline"
								onClick={undo}
								disabled={undoDepth === 0 || readOnly}
								title={`Undo (${MOD_KEY_LABEL}+Z)`}
								aria-label={`Undo (${MOD_KEY_LABEL}+Z)`}
							>
								<span className="icon-[mdi--undo] w-5 h-5" />
							</button>
							<button
								type="button"
								className="btn btn-square btn-sm join-item btn-outline"
								onClick={redo}
								disabled={redoDepth === 0 || readOnly}
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
										<tr><td className="opacity-70 py-0.5">Place</td><td className="text-right"><kbd className="kbd kbd-sm">P</kbd></td></tr>
										<tr><td className="opacity-70 py-0.5">Erase</td><td className="text-right"><kbd className="kbd kbd-sm">R</kbd></td></tr>
										<tr><td className="opacity-70 py-0.5">Paint</td><td className="text-right"><kbd className="kbd kbd-sm">G</kbd></td></tr>
										<tr><td className="opacity-70 py-0.5">Sample (eyedropper)</td><td className="text-right"><kbd className="kbd kbd-sm">I</kbd></td></tr>
										<tr><td className="opacity-70 py-0.5">Tile brush</td><td className="text-right"><kbd className="kbd kbd-sm">1</kbd></td></tr>
										<tr><td className="opacity-70 py-0.5">Voxel brush</td><td className="text-right"><kbd className="kbd kbd-sm">2</kbd></td></tr>
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
											<tr><td className="opacity-70 py-0.5">Paint / pick</td><td className="text-right whitespace-nowrap"><kbd className="kbd kbd-sm">Left&nbsp;click</kbd></td></tr>
											<tr><td className="opacity-70 py-0.5">Orbit / rotate</td><td className="text-right whitespace-nowrap"><kbd className="kbd kbd-sm">Middle&nbsp;drag</kbd></td></tr>
											<tr><td className="opacity-70 py-0.5">Pan</td><td className="text-right whitespace-nowrap"><kbd className="kbd kbd-sm">Right&nbsp;drag</kbd></td></tr>
											<tr><td className="opacity-70 py-0.5">Zoom</td><td className="text-right whitespace-nowrap"><kbd className="kbd kbd-sm">Scroll</kbd></td></tr>
										</tbody>
									</table>
								</div>

								<div className="mt-3 pt-2 border-t border-base-300">
									<div className="font-semibold mb-2">Stamps</div>
									<table className="w-full">
										<tbody>
											<tr>
												<td className="opacity-70 py-0.5">Rotate stamp 90&deg;</td>
												<td className="text-right"><kbd className="kbd kbd-sm">R</kbd></td>
											</tr>
											<tr>
												<td className="opacity-70 py-0.5">Mirror stamp</td>
												<td className="text-right"><kbd className="kbd kbd-sm">M</kbd></td>
											</tr>
											<tr>
												<td className="opacity-70 py-0.5">Stop stamping</td>
												<td className="text-right"><kbd className="kbd kbd-sm">Esc</kbd></td>
											</tr>
										</tbody>
									</table>
									<div className="mt-1 text-xs opacity-70 leading-relaxed">
										Tag a terrain <code className="text-[0.7rem]">path:stamps</code>{" "}
										to use it as a stamp.
									</div>
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
								onClick={showPreview}
							>
								Preview
							</button>
						</div>
					</div>
				</div>

				<div className="relative flex-1 min-h-0 bg-base-200">
					<div className={activeView === "edit" ? "absolute inset-0" : "hidden"}>
						<div ref={containerRef} className="absolute inset-0" />
						<div ref={actorOverlayRef} className="absolute inset-0 pointer-events-none overflow-hidden" />
					</div>
					{activeView === "preview" && (
						<div className="absolute inset-0">
							<MapStateProvider>
								<ThreeDMap terrain={previewTerrain ?? terrain} />
							</MapStateProvider>
						</div>
					)}
				</div>
			</div>

			<div className="w-64 shrink-0 border-l-2 bg-base-100 p-3 overflow-y-auto">
				<div className="space-y-5">
					{activeView === "preview" ? (
						<>
							<div>
								<div className="text-sm font-semibold mb-2">Lighting</div>
								<div className="space-y-3">
									<label className="flex items-center justify-between gap-3">
										<span className="label-text">Color</span>
										<input
											type="color"
											className="h-9 w-12 cursor-pointer rounded border border-base-300 bg-base-100 p-1"
											value={lighting.Color}
											onChange={(e) => updateLighting({ Color: e.target.value })}
											disabled={readOnly}
										/>
									</label>
									<label className="block">
										<div className="mb-1 flex items-center justify-between gap-3">
											<span className="label-text">Intensity</span>
											<span className="text-xs tabular-nums text-base-content/70">
												{lighting.Intensity.toFixed(2)}
											</span>
										</div>
										<input
											type="range"
											className="range range-sm"
											min={LIGHTING_INTENSITY_MIN}
											max={LIGHTING_INTENSITY_MAX}
											step={LIGHTING_INTENSITY_STEP}
											value={lighting.Intensity}
											onChange={(e) =>
												updateLighting({
													Intensity: clampNumber(
														numberInputValue(e.target.value, lighting.Intensity),
														LIGHTING_INTENSITY_MIN,
														LIGHTING_INTENSITY_MAX
													),
												})
											}
											disabled={readOnly}
										/>
									</label>
									<label className="block">
										<div className="mb-1 flex items-center justify-between gap-3">
											<span className="label-text">Rotation</span>
											<span className="text-xs tabular-nums text-base-content/70">
												{Math.round(lighting.Rotation)} deg
											</span>
										</div>
										<input
											type="range"
											className="range range-sm"
											min={LIGHTING_ROTATION_MIN}
											max={LIGHTING_ROTATION_MAX}
											step={1}
											value={lighting.Rotation}
											onChange={(e) =>
												updateLighting({
													Rotation: clampNumber(
														numberInputValue(e.target.value, lighting.Rotation),
														LIGHTING_ROTATION_MIN,
														LIGHTING_ROTATION_MAX
													),
												})
											}
											disabled={readOnly}
										/>
									</label>
									<label className="block">
										<div className="mb-1 flex items-center justify-between gap-3">
											<span className="label-text">Elevation</span>
											<span className="text-xs tabular-nums text-base-content/70">
												{Math.round(lighting.Elevation)} deg
											</span>
										</div>
										<input
											type="range"
											className="range range-sm"
											min={LIGHTING_ELEVATION_MIN}
											max={LIGHTING_ELEVATION_MAX}
											step={1}
											value={lighting.Elevation}
											onChange={(e) =>
												updateLighting({
													Elevation: clampNumber(
														numberInputValue(e.target.value, lighting.Elevation),
														LIGHTING_ELEVATION_MIN,
														LIGHTING_ELEVATION_MAX
													),
												})
											}
											disabled={readOnly}
										/>
									</label>
								</div>
							</div>

							<div>
								<div className="text-sm font-semibold mb-2">Background</div>
								<div className="space-y-3">
									<label className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-base-300 px-3 py-2">
										<span className="label-text">Color</span>
										<input
											type="checkbox"
											className="toggle toggle-sm toggle-primary"
											checked={!!background.Color}
											onChange={(e) =>
												updateBackground(
													e.target.checked
														? { Color: backgroundColor }
														: {}
												)
											}
											disabled={readOnly}
										/>
									</label>
									<input
										type="color"
										className="h-10 w-full cursor-pointer rounded border border-base-300 bg-base-100 p-1 disabled:cursor-not-allowed disabled:opacity-50"
										value={backgroundColor}
										onChange={(e) => updateBackground({ Color: e.target.value })}
										disabled={readOnly || !background.Color}
									/>
								</div>
							</div>
						</>
					) : (
						<>
					<div>
						<div className="text-sm font-semibold mb-2">Info</div>
						<div className="space-y-1 text-xs text-base-content/75">
							<div className="flex justify-between gap-3">
								<span>Tool</span>
								<span className="font-medium text-base-content">{selectedTool.label}</span>
							</div>
							<div className="flex justify-between gap-3">
								<span>Brush</span>
								<span className="font-medium text-base-content">{brushModeLabel} {brushSize}</span>
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
							{TERRAIN_PALETTE.map((color, idx) => (
								<button
									key={idx}
									type="button"
									className={`aspect-square${selectedColorIndex === idx ? " ring-2 ring-base-content ring-inset" : ""}`}
									style={{ backgroundColor: color }}
									onClick={() => setSelectedColorIndex(idx)}
									title={`Color ${idx}`}
									aria-label={`Color ${idx}`}
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
									onChange={(e) => setShowTacticalGrid(e.target.checked)}
								/>
							</label>
							<label className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-base-300 px-3 py-2">
								<span className="label-text">Voxel Grid</span>
								<input
									type="checkbox"
									className="toggle toggle-sm toggle-warning"
									checked={showVoxelGrid}
									onChange={(e) => setShowVoxelGrid(e.target.checked)}
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
										onChange={(e) => setShowActors(e.target.checked)}
									/>
								</label>
							</div>
						</div>
					)}
						</>
					)}
				</div>
			</div>
		</div>

		{voxImportModal && (
			<dialog className="modal modal-open">
				<div className="modal-box max-w-md">
					{voxImportModal.kind === "error" ? (
						<>
							<h3 className="font-bold text-lg mb-3">Import .vox — Error</h3>
							<p className="text-sm text-error">{voxImportModal.message}</p>
							<div className="modal-action">
								<button type="button" className="btn" onClick={() => setVoxImportModal(null)}>
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
									{voxImportModal.parsed.voxWidth}x{voxImportModal.parsed.voxLength}x{voxImportModal.parsed.voxHeight} voxels
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
												? `${opt.tacticalWidth}x${opt.tacticalLength}x${opt.tacticalHeight} tiles`
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
									onClick={() => applyVoxImport(voxImportModal.parsed, voxImportModal.selected)}
								>
									Import
								</button>
							</div>
						</>
					)}
				</div>
				<div className="modal-backdrop" onClick={() => setVoxImportModal(null)} />
			</dialog>
		)}
		</>
	);
});

export default VoxelTerrainEditor;
