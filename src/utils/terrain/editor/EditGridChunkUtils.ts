// Chunk system for the EditGrid.
//
// The edit grid is partitioned into CHUNK_SIZE^3 chunks. The editor's rAF loop
// rebuilds chunk meshes lazily from a dirty set, so a per-voxel edit only
// re-meshes the 1-2 chunks that contain or border the touched voxel.

import type { VoxelTerrainIndex } from "../data/VoxelTerrainIndex";
import {
	clampVoxelTerrainHeight,
	clampVoxelTerrainResolution,
	MAX_VOXEL_TERRAIN_LENGTH,
	MAX_VOXEL_TERRAIN_WIDTH,
	getRescaledVoxelRange,
	normalizeVoxelPaletteIndex,
} from "./VoxelTerrainEditorUtils";
import type { VoxelSelectionBounds } from "./VoxelTerrainSelectionUtils";
import {
	createEditGrid,
	editGridHasVoxelAtIndex,
	editGridIndex,
	editGridSetOccupiedAtIndex,
	type EditGrid,
} from "./EditGridUtils";

// 8^3 = 512 voxels max per chunk, giving ~80 chunks for a 40x40x16 voxel grid.
// A single-voxel edit touches 1-2 chunks.
export const CHUNK_SIZE = 8;

export interface ChunkDims {
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

export interface DraftShape {
	width: number;
	length: number;
	height: number;
	resolution: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function computeChunkDimsForShape(
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

export function computeChunkDims(index: VoxelTerrainIndex): ChunkDims {
	return computeChunkDimsForShape(
		index.width,
		index.length,
		index.height,
		index.resolution,
	);
}

export function chunkIndex(cx: number, cy: number, cz: number, dims: ChunkDims): number {
	return cx + cz * dims.chunksX + cy * dims.chunksX * dims.chunksZ;
}

export function unpackChunkIndex(
	idx: number,
	dims: ChunkDims,
): { cx: number; cy: number; cz: number } {
	const cx = idx % dims.chunksX;
	const rem = Math.floor(idx / dims.chunksX);
	const cz = rem % dims.chunksZ;
	const cy = Math.floor(rem / dims.chunksZ);
	return { cx, cy, cz };
}

export function markAllChunksDirty(dirtyChunks: Set<number>, dims: ChunkDims): void {
	const { chunksX, chunksY, chunksZ } = dims;
	for (let cy = 0; cy < chunksY; cy++) {
		for (let cz = 0; cz < chunksZ; cz++) {
			for (let cx = 0; cx < chunksX; cx++) {
				dirtyChunks.add(chunkIndex(cx, cy, cz, dims));
			}
		}
	}
}

export function markVoxelDirtyChunks(
	vx: number, vy: number, vz: number,
	dirtyChunks: Set<number>,
	dims: ChunkDims,
): void {
	const { chunksX, chunksY, chunksZ } = dims;

	const addIfValid = (cx: number, cy: number, cz: number) => {
		if (cx >= 0 && cx < chunksX && cy >= 0 && cy < chunksY && cz >= 0 && cz < chunksZ) {
			dirtyChunks.add(chunkIndex(cx, cy, cz, dims));
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

export function markVoxelRangeDirtyChunks(
	bounds: VoxelSelectionBounds,
	dirtyChunks: Set<number>,
	dims: ChunkDims,
): void {
	const minX = clamp(bounds.min.x - 1, 0, Math.max(0, dims.vW - 1));
	const minY = clamp(bounds.min.y - 1, 0, Math.max(0, dims.vH - 1));
	const minZ = clamp(bounds.min.z - 1, 0, Math.max(0, dims.vL - 1));
	const maxX = clamp(bounds.max.x + 1, 0, Math.max(0, dims.vW - 1));
	const maxY = clamp(bounds.max.y + 1, 0, Math.max(0, dims.vH - 1));
	const maxZ = clamp(bounds.max.z + 1, 0, Math.max(0, dims.vL - 1));

	const startCx = Math.floor(minX / CHUNK_SIZE);
	const startCy = Math.floor(minY / CHUNK_SIZE);
	const startCz = Math.floor(minZ / CHUNK_SIZE);
	const endCx = Math.floor(maxX / CHUNK_SIZE);
	const endCy = Math.floor(maxY / CHUNK_SIZE);
	const endCz = Math.floor(maxZ / CHUNK_SIZE);

	for (let cy = startCy; cy <= endCy; cy++) {
		for (let cz = startCz; cz <= endCz; cz++) {
			for (let cx = startCx; cx <= endCx; cx++) {
				if (
					cx >= 0 && cx < dims.chunksX &&
					cy >= 0 && cy < dims.chunksY &&
					cz >= 0 && cz < dims.chunksZ
				) {
					dirtyChunks.add(chunkIndex(cx, cy, cz, dims));
				}
			}
		}
	}
}

/**
 * Compute the world-space voxel bounds of a single chunk, clamped to grid.
 */
export function getChunkVoxelBounds(
	cx: number, cy: number, cz: number,
	dims: ChunkDims,
): { startX: number; startY: number; startZ: number; endX: number; endY: number; endZ: number } {
	const startX = cx * CHUNK_SIZE;
	const startY = cy * CHUNK_SIZE;
	const startZ = cz * CHUNK_SIZE;
	return {
		startX,
		startY,
		startZ,
		endX: Math.min(startX + CHUNK_SIZE, dims.vW),
		endY: Math.min(startY + CHUNK_SIZE, dims.vH),
		endZ: Math.min(startZ + CHUNK_SIZE, dims.vL),
	};
}

export function normalizeDraftShape(nextShape: DraftShape): DraftShape {
	return {
		width: clamp(Math.floor(nextShape.width) || 1, 1, MAX_VOXEL_TERRAIN_WIDTH),
		length: clamp(Math.floor(nextShape.length) || 1, 1, MAX_VOXEL_TERRAIN_LENGTH),
		height: clampVoxelTerrainHeight(nextShape.height),
		resolution: clampVoxelTerrainResolution(nextShape.resolution),
	};
}

export interface ReshapeResult {
	grid: EditGrid;
	dims: ChunkDims;
	count: number;
	shape: DraftShape;
}

export function reshapeEditGrid(
	grid: EditGrid,
	oldDims: ChunkDims,
	nextShape: DraftShape,
): ReshapeResult {
	const shape = normalizeDraftShape(nextShape);
	const nextDims = computeChunkDimsForShape(
		shape.width,
		shape.length,
		shape.height,
		shape.resolution,
	);
	const nextGrid = createEditGrid(nextDims.vW * nextDims.vH * nextDims.vL);
	let count = 0;

	for (let y = 0; y < oldDims.vH; y++) {
		for (let z = 0; z < oldDims.vL; z++) {
			for (let x = 0; x < oldDims.vW; x++) {
				const oldIndex = editGridIndex(x, y, z, oldDims.vW, oldDims.vL);
				if (!editGridHasVoxelAtIndex(grid, oldIndex)) continue;
				const color = normalizeVoxelPaletteIndex(grid.colors[oldIndex]);

				const xRange = getRescaledVoxelRange(x, oldDims.resolution, shape.resolution, nextDims.vW);
				const yRange = getRescaledVoxelRange(y, oldDims.resolution, shape.resolution, nextDims.vH);
				const zRange = getRescaledVoxelRange(z, oldDims.resolution, shape.resolution, nextDims.vL);
				if (!xRange || !yRange || !zRange) continue;

				for (let nz = zRange.start; nz < zRange.end; nz++) {
					for (let ny = yRange.start; ny < yRange.end; ny++) {
						for (let nx = xRange.start; nx < xRange.end; nx++) {
							const nextIdx = editGridIndex(nx, ny, nz, nextDims.vW, nextDims.vL);
							if (!editGridHasVoxelAtIndex(nextGrid, nextIdx)) {
								count++;
								editGridSetOccupiedAtIndex(nextGrid, nextIdx, true);
							}
							nextGrid.colors[nextIdx] = color;
						}
					}
				}
			}
		}
	}

	return { grid: nextGrid, dims: nextDims, count, shape };
}
