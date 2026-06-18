// Surface grid lines and bounds frames for the voxel terrain editor.
//
// Grid lines outline the top-exposed faces of the terrain so the player can
// tell at a glance how high a tile is. They come in two flavors:
//   - tactical grid: lines on the outer edges of each tactical tile (1u box)
//   - voxel grid:    lines on every voxel face (subdivides each tactical tile)
// The editor shows one or the other based on the current granularity.
//
// PERF: grid line meshes are kept per-chunk (parallel to the chunk mesh map).
// When the editor's rAF loop rebuilds a dirty chunk's geometry, it also
// rebuilds that chunk's grid lines. A small edit only touches the 1-2 chunks
// holding the changed voxel, so the per-frame grid line rebuild cost stays
// O(chunk volume) instead of O(whole terrain volume).

import * as THREE from "three";
import {
	editGridHasVoxelAtIndex,
	editGridIndex,
	type EditGrid,
} from "../../../utils/terrain/editor/EditGridUtils";
import {
	getChunkVoxelBounds,
	type ChunkDims,
} from "../../../utils/terrain/editor/EditGridChunkUtils";
import type { VoxelSelectionBounds } from "../../../utils/terrain/editor/VoxelTerrainSelectionUtils";

const GRID_LINE_OFFSET = 0.008;

const VOXEL_GRID_COLOR     = 0xf59e0b;
const VOXEL_GRID_OPACITY   = 0.38;
const TACTICAL_GRID_COLOR  = 0x14b8a6;
const TACTICAL_GRID_OPACITY = 0.68;
const BOUNDS_FRAME_COLOR   = 0xe5e7eb;
const BOUNDS_FRAME_OPACITY = 0.32;

export interface EditorGridGroup {
	root: THREE.Group;
	// Per-chunk line meshes. Two sub-meshes per chunk: tactical (key cx,cy,cz)
	// and voxel. A null value means the chunk emitted no lines this rebuild.
	tacticalChunkLines: Map<number, THREE.LineSegments | null>;
	voxelChunkLines:    Map<number, THREE.LineSegments | null>;
	boundsFrame: THREE.LineSegments | null;
}

export function createEditorGridGroup(root: THREE.Group): EditorGridGroup {
	return {
		root,
		tacticalChunkLines: new Map(),
		voxelChunkLines: new Map(),
		boundsFrame: null,
	};
}

function buildLineSegments(
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

function disposeLineSegments(line: THREE.LineSegments | null): void {
	if (!line) return;
	line.geometry.dispose();
	const mat = line.material;
	if (Array.isArray(mat)) for (const m of mat) m.dispose();
	else mat.dispose();
}

function addBoxEdges(points: number[], corners: number[][]): void {
	const edges: Array<[number, number]> = [
		[0,1],[1,2],[2,3],[3,0],
		[4,5],[5,6],[6,7],[7,4],
		[0,4],[1,5],[2,6],[3,7],
	];
	for (const [a, b] of edges) {
		points.push(...corners[a], ...corners[b]);
	}
}

export function createBoundsFrame(
	tW: number,
	tH: number,
	tL: number,
): THREE.LineSegments {
	const minX = -tW / 2, maxX = tW / 2;
	const minY = -0.5,    maxY = tH - 0.5;
	const minZ = -tL / 2, maxZ = tL / 2;
	const corners = [
		[minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ],
		[minX, maxY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ], [minX, maxY, maxZ],
	];
	const points: number[] = [];
	addBoxEdges(points, corners);
	return buildLineSegments(points, BOUNDS_FRAME_COLOR, BOUNDS_FRAME_OPACITY);
}

export function createSelectionBoundsFrame(
	bounds: VoxelSelectionBounds,
	dims: ChunkDims,
	color: number,
	opacity: number,
): THREE.LineSegments {
	const { resolution: r, tW, tL } = dims;
	const minX = bounds.min.x / r - tW / 2;
	const maxX = (bounds.max.x + 1) / r - tW / 2;
	const minY = bounds.min.y / r - 0.5;
	const maxY = (bounds.max.y + 1) / r - 0.5;
	const minZ = bounds.min.z / r - tL / 2;
	const maxZ = (bounds.max.z + 1) / r - tL / 2;
	const corners = [
		[minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ],
		[minX, maxY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ], [minX, maxY, maxZ],
	];
	const points: number[] = [];
	addBoxEdges(points, corners);
	const frame = buildLineSegments(points, color, opacity);
	frame.renderOrder = 35;
	return frame;
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

interface ChunkLineBuilders {
	voxelPoints: number[];
	tacticalPoints: number[];
}

function emitTopExposedLines(
	grid: EditGrid,
	dims: ChunkDims,
	cx: number, cy: number, cz: number,
	out: ChunkLineBuilders,
	wantVoxel: boolean,
	wantTactical: boolean,
): void {
	const { vW, vH, vL, resolution: r, tW, tL } = dims;
	const halfW = tW / 2;
	const halfL = tL / 2;
	const { startX, startY, startZ, endX, endY, endZ } = getChunkVoxelBounds(cx, cy, cz, dims);

	for (let y = startY; y < endY; y++) {
		for (let z = startZ; z < endZ; z++) {
			for (let x = startX; x < endX; x++) {
				const idx = editGridIndex(x, y, z, vW, vL);
				if (!editGridHasVoxelAtIndex(grid, idx)) continue;
				const atTop =
					y + 1 >= vH ||
					!editGridHasVoxelAtIndex(grid, editGridIndex(x, y + 1, z, vW, vL));
				if (!atTop) continue;

				const minX = x / r - halfW;
				const maxX = (x + 1) / r - halfW;
				const minZ = z / r - halfL;
				const maxZ = (z + 1) / r - halfL;

				if (wantVoxel) {
					const yy = (y + 1) / r - 0.5 + GRID_LINE_OFFSET;
					addTopRectangle(out.voxelPoints, minX, maxX, yy, minZ, maxZ);
				}

				if (wantTactical) {
					const yy = (y + 1) / r - 0.5 + GRID_LINE_OFFSET * 2;
					if (x % r === 0)       out.tacticalPoints.push(minX, yy, minZ, minX, yy, maxZ);
					if ((x + 1) % r === 0) out.tacticalPoints.push(maxX, yy, minZ, maxX, yy, maxZ);
					if (z % r === 0)       out.tacticalPoints.push(minX, yy, minZ, maxX, yy, minZ);
					if ((z + 1) % r === 0) out.tacticalPoints.push(minX, yy, maxZ, maxX, yy, maxZ);
				}
			}
		}
	}
}

/**
 * Rebuild grid line meshes for a single chunk. Removes/disposes existing meshes
 * for that chunk and adds new ones (or marks null if the chunk is empty).
 */
export function rebuildGridForChunk(
	group: EditorGridGroup,
	grid: EditGrid,
	dims: ChunkDims,
	chunkIdx: number,
	cx: number, cy: number, cz: number,
	showTacticalGrid: boolean,
	showVoxelGrid: boolean,
): void {
	const wantTactical = showTacticalGrid;
	const wantVoxel = showVoxelGrid && dims.resolution > 1;

	// Replace existing tactical lines.
	const oldTactical = group.tacticalChunkLines.get(chunkIdx);
	if (oldTactical) {
		group.root.remove(oldTactical);
		disposeLineSegments(oldTactical);
	}
	const oldVoxel = group.voxelChunkLines.get(chunkIdx);
	if (oldVoxel) {
		group.root.remove(oldVoxel);
		disposeLineSegments(oldVoxel);
	}

	if (!wantTactical && !wantVoxel) {
		group.tacticalChunkLines.set(chunkIdx, null);
		group.voxelChunkLines.set(chunkIdx, null);
		return;
	}

	const builders: ChunkLineBuilders = { voxelPoints: [], tacticalPoints: [] };
	emitTopExposedLines(grid, dims, cx, cy, cz, builders, wantVoxel, wantTactical);

	if (wantVoxel && builders.voxelPoints.length > 0) {
		const lines = buildLineSegments(builders.voxelPoints, VOXEL_GRID_COLOR, VOXEL_GRID_OPACITY);
		group.root.add(lines);
		group.voxelChunkLines.set(chunkIdx, lines);
	} else {
		group.voxelChunkLines.set(chunkIdx, null);
	}

	if (wantTactical && builders.tacticalPoints.length > 0) {
		const lines = buildLineSegments(builders.tacticalPoints, TACTICAL_GRID_COLOR, TACTICAL_GRID_OPACITY);
		group.root.add(lines);
		group.tacticalChunkLines.set(chunkIdx, lines);
	} else {
		group.tacticalChunkLines.set(chunkIdx, null);
	}
}

/**
 * Replace the bounds frame mesh. Called on shape changes (terrain reshape,
 * external prop swap).
 */
export function rebuildBoundsFrame(
	group: EditorGridGroup,
	dims: ChunkDims,
): void {
	if (group.boundsFrame) {
		group.root.remove(group.boundsFrame);
		disposeLineSegments(group.boundsFrame);
	}
	const tH = dims.vH / dims.resolution;
	const frame = createBoundsFrame(dims.tW, tH, dims.tL);
	group.root.add(frame);
	group.boundsFrame = frame;
}

/**
 * Discard all per-chunk grid line meshes (e.g. on shape change so the new
 * dirty-chunk loop can rebuild them fresh).
 */
export function clearAllGridChunkLines(group: EditorGridGroup): void {
	for (const lines of group.tacticalChunkLines.values()) {
		if (lines) {
			group.root.remove(lines);
			disposeLineSegments(lines);
		}
	}
	for (const lines of group.voxelChunkLines.values()) {
		if (lines) {
			group.root.remove(lines);
			disposeLineSegments(lines);
		}
	}
	group.tacticalChunkLines.clear();
	group.voxelChunkLines.clear();
}
