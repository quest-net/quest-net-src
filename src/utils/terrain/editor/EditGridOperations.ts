// Edit grid mutation operations: brush, selection, stamp, smooth.
//
// Each operation:
//   - writes directly to the EditGrid (O(1) per voxel)
//   - marks affected chunks dirty so the rAF loop rebuilds them
//   - optionally calls a beforeMutation hook so the editor can record pre-edit
//     state for undo/redo deltas
//   - reports the change count delta (for occupied-voxel running total)

import type { VoxelTerrainIndex } from "../data/VoxelTerrainIndex";
import type { EditableVoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import {
	iterateStampVoxels,
	type StampTransform,
} from "./VoxelStampUtils";
import {
	iterateVoxelSelectionSpace,
	type TerrainSelection,
	type VoxelCoord,
	type VoxelSelectionBounds,
} from "./VoxelTerrainSelectionUtils";
import { normalizeVoxelPaletteIndex } from "./VoxelTerrainEditorUtils";
import { DEFAULT_TERRAIN_COLOR_INDEX } from "../palette/TerrainPaletteUtils";
import {
	editGridGetColor,
	editGridHasVoxelAtIndex,
	editGridIndex,
	editGridSetOccupiedAtIndex,
	getColumnTopInRange,
	inGridBounds,
	type EditGrid,
} from "./EditGridUtils";
import {
	markVoxelDirtyChunks,
	markVoxelRangeDirtyChunks,
	type ChunkDims,
} from "./EditGridChunkUtils";
import {
	collectAffectedCoords,
	type BrushTool,
	type EditGranularity,
	type PickInfo,
} from "./VoxelBrushUtils";
import { clamp } from "../../math";

export type SelectionEditTool = "place" | "fill" | "erase" | "paint";
export type VoxelEditTool = BrushTool;

export interface VoxelEditResult {
	changed: boolean;
	sampledColor: number | null;
	countDelta: number;
}

export interface MutationResult {
	changed: boolean;
	countDelta: number;
}

/**
 * Writes a stamp source into the edit grid at the given anchor.
 *
 * Anchor = the destination voxel the source's bottom-center maps to. The
 * caller picks this from PickInfo (typically pick.voxel + pick.normal so the
 * stamp sits *on top* of the clicked face). Source-solid voxels paint over
 * destination (additive only). Out-of-bounds offsets clip silently.
 */
export function applyStampToGrid(
	grid: EditGrid,
	dirtyChunks: Set<number>,
	dims: ChunkDims,
	anchor: VoxelCoord,
	source: EditableVoxelTerrain,
	transform: StampTransform,
	beforeMutation?: (gIdx: number) => void,
): MutationResult {
	const { vW, vH, vL, resolution } = dims;
	let changed = false;
	let countDelta = 0;

	for (const offset of iterateStampVoxels(source, resolution, transform)) {
		const x = anchor.x + offset.x;
		const y = anchor.y + offset.y;
		const z = anchor.z + offset.z;
		if (!inGridBounds(x, y, z, vW, vH, vL)) continue;

		const gIdx = editGridIndex(x, y, z, vW, vL);
		const next = normalizeVoxelPaletteIndex(offset.color);
		const occupied = editGridHasVoxelAtIndex(grid, gIdx);
		if (occupied && grid.colors[gIdx] === next) continue;
		beforeMutation?.(gIdx);
		if (!occupied) {
			countDelta++;
			editGridSetOccupiedAtIndex(grid, gIdx, true);
		}
		grid.colors[gIdx] = next;
		markVoxelDirtyChunks(x, y, z, dirtyChunks, dims);
		changed = true;
	}

	return { changed, countDelta };
}

/**
 * Apply a brush-tool edit at the picked location. Returns the sampled palette
 * index when the tool is `sample`.
 */
export function applyVoxelEdit(
	grid: EditGrid,
	index: VoxelTerrainIndex,
	dirtyChunks: Set<number>,
	dims: ChunkDims,
	pick: PickInfo,
	tool: VoxelEditTool,
	granularity: EditGranularity,
	brushSize: number,
	colorIndex: number,
	beforeMutation?: (gIdx: number) => void,
): VoxelEditResult {
	const { vW, vH, vL } = dims;

	if (tool === "sample") {
		const sampledColor = editGridGetColor(grid, pick.voxel.x, pick.voxel.y, pick.voxel.z, vW, vH, vL);
		return { changed: false, sampledColor, countDelta: 0 };
	}

	const coords = collectAffectedCoords(index, pick, tool, granularity, brushSize);
	let changed = false;
	let countDelta = 0;

	for (const { x, y, z } of coords) {
		if (!inGridBounds(x, y, z, vW, vH, vL)) continue;
		const gIdx = editGridIndex(x, y, z, vW, vL);

		if (tool === "erase") {
			if (editGridHasVoxelAtIndex(grid, gIdx)) {
				beforeMutation?.(gIdx);
				editGridSetOccupiedAtIndex(grid, gIdx, false);
				markVoxelDirtyChunks(x, y, z, dirtyChunks, dims);
				changed = true;
				countDelta--;
			}
			continue;
		}

		if (tool === "paint") {
			const occupied = editGridHasVoxelAtIndex(grid, gIdx);
			if (occupied && grid.colors[gIdx] !== colorIndex) {
				beforeMutation?.(gIdx);
				grid.colors[gIdx] = colorIndex;
				markVoxelDirtyChunks(x, y, z, dirtyChunks, dims);
				changed = true;
			}
			continue;
		}

		// place
		if (!editGridHasVoxelAtIndex(grid, gIdx)) {
			beforeMutation?.(gIdx);
			grid.colors[gIdx] = colorIndex;
			editGridSetOccupiedAtIndex(grid, gIdx, true);
			markVoxelDirtyChunks(x, y, z, dirtyChunks, dims);
			changed = true;
			countDelta++;
		}
	}

	return { changed, sampledColor: null, countDelta };
}

/**
 * Apply a brush-tool edit over every voxel in the given selection.
 */
export function applySelectionEdit(
	grid: EditGrid,
	dirtyChunks: Set<number>,
	dims: ChunkDims,
	selection: TerrainSelection,
	tool: SelectionEditTool,
	colorIndex: number,
	beforeMutation?: (gIdx: number) => void,
): MutationResult {
	const { vW, vH, vL } = dims;
	const next = normalizeVoxelPaletteIndex(colorIndex);
	let changed = false;
	let countDelta = 0;
	let changedMin: VoxelCoord | null = null;
	let changedMax: VoxelCoord | null = null;

	const markChanged = (x: number, y: number, z: number) => {
		if (!changedMin || !changedMax) {
			changedMin = { x, y, z };
			changedMax = { x, y, z };
		} else {
			if (x < changedMin.x) changedMin.x = x;
			if (y < changedMin.y) changedMin.y = y;
			if (z < changedMin.z) changedMin.z = z;
			if (x > changedMax.x) changedMax.x = x;
			if (y > changedMax.y) changedMax.y = y;
			if (z > changedMax.z) changedMax.z = z;
		}
	};

	for (const { x, y, z } of iterateVoxelSelectionSpace(selection, dims)) {
		if (!inGridBounds(x, y, z, vW, vH, vL)) continue;

		const gIdx = editGridIndex(x, y, z, vW, vL);
		const occupied = editGridHasVoxelAtIndex(grid, gIdx);
		const cur = grid.colors[gIdx];

		if (tool === "erase") {
			if (!occupied) continue;
			beforeMutation?.(gIdx);
			editGridSetOccupiedAtIndex(grid, gIdx, false);
			changed = true;
			countDelta--;
			markChanged(x, y, z);
			continue;
		}

		if (tool === "paint") {
			if (!occupied || cur === next) continue;
			beforeMutation?.(gIdx);
			grid.colors[gIdx] = next;
			changed = true;
			markChanged(x, y, z);
			continue;
		}

		if (tool === "fill") {
			// Add into empty space only; never overwrite existing voxels. This is
			// the non-destructive counterpart to `place` -- e.g. flooding a boxed
			// room with fog while leaving its floor, walls, and props intact.
			if (occupied) continue;
			beforeMutation?.(gIdx);
			countDelta++;
			editGridSetOccupiedAtIndex(grid, gIdx, true);
			grid.colors[gIdx] = next;
			changed = true;
			markChanged(x, y, z);
			continue;
		}

		if (occupied && cur === next) continue;
		beforeMutation?.(gIdx);
		if (!occupied) {
			countDelta++;
			editGridSetOccupiedAtIndex(grid, gIdx, true);
		}
		grid.colors[gIdx] = next;
		changed = true;
		markChanged(x, y, z);
	}

	if (changedMin && changedMax) {
		markVoxelRangeDirtyChunks({ min: changedMin, max: changedMax }, dirtyChunks, dims);
	}

	return { changed, countDelta };
}

export const MIN_SMOOTH_PASSES = 1;
export const MAX_SMOOTH_PASSES = 6;
export const DEFAULT_SMOOTH_PASSES = 2;

function smoothColumnIndex(
	x: number,
	z: number,
	bounds: VoxelSelectionBounds,
	width: number,
): number {
	return (x - bounds.min.x) + (z - bounds.min.z) * width;
}

function resolveSmoothFillColor(
	grid: EditGrid,
	dims: ChunkDims,
	bounds: VoxelSelectionBounds,
	colors: Uint8Array,
	hasSurface: Uint8Array,
	width: number,
	x: number,
	z: number,
): number {
	const ownIndex = smoothColumnIndex(x, z, bounds, width);
	if (hasSurface[ownIndex] !== 0) return colors[ownIndex];

	for (let radius = 1; radius <= 4; radius++) {
		for (
			let nz = Math.max(bounds.min.z, z - radius);
			nz <= Math.min(bounds.max.z, z + radius);
			nz++
		) {
			for (
				let nx = Math.max(bounds.min.x, x - radius);
				nx <= Math.min(bounds.max.x, x + radius);
				nx++
			) {
				if (Math.max(Math.abs(nx - x), Math.abs(nz - z)) !== radius) continue;
				const idx = smoothColumnIndex(nx, nz, bounds, width);
				if (hasSurface[idx] !== 0) return colors[idx];
			}
		}
	}

	for (let radius = 1; radius <= 4; radius++) {
		for (
			let nz = Math.max(0, z - radius);
			nz <= Math.min(dims.vL - 1, z + radius);
			nz++
		) {
			for (
				let nx = Math.max(0, x - radius);
				nx <= Math.min(dims.vW - 1, x + radius);
				nx++
			) {
				if (Math.max(Math.abs(nx - x), Math.abs(nz - z)) !== radius) continue;
				const top = getColumnTopInRange(grid, dims, nx, nz, bounds.min.y, bounds.max.y);
				if (top.color !== null) return top.color;
			}
		}
	}

	return DEFAULT_TERRAIN_COLOR_INDEX;
}

/**
 * Average column heights within a box selection (rectangular bounds) using a
 * weighted 3x3 kernel. Each pass shifts each column toward its neighborhood
 * average by at most one voxel so the silhouette evolves smoothly.
 */
export function applyBoxSelectionSmooth(
	grid: EditGrid,
	dirtyChunks: Set<number>,
	dims: ChunkDims,
	bounds: VoxelSelectionBounds,
	passes: number,
	beforeMutation?: (gIdx: number) => void,
): MutationResult {
	const { vW, vH, vL } = dims;
	const minX = clamp(bounds.min.x, 0, Math.max(0, vW - 1));
	const maxX = clamp(bounds.max.x, minX, Math.max(0, vW - 1));
	const minY = clamp(bounds.min.y, 0, Math.max(0, vH - 1));
	const maxY = clamp(bounds.max.y, minY, Math.max(0, vH - 1));
	const minZ = clamp(bounds.min.z, 0, Math.max(0, vL - 1));
	const maxZ = clamp(bounds.max.z, minZ, Math.max(0, vL - 1));
	const clampedBounds = {
		min: { x: minX, y: minY, z: minZ },
		max: { x: maxX, y: maxY, z: maxZ },
	};
	const width = maxX - minX + 1;
	const columnCount = width * (maxZ - minZ + 1);
	const floorHeight = minY - 1;
	let heights = new Int16Array(columnCount);
	let nextHeights = new Int16Array(columnCount);
	const colors = new Uint8Array(columnCount);
	const hasSurface = new Uint8Array(columnCount);

	for (let z = minZ; z <= maxZ; z++) {
		for (let x = minX; x <= maxX; x++) {
			const idx = smoothColumnIndex(x, z, clampedBounds, width);
			const top = getColumnTopInRange(grid, dims, x, z, minY, maxY);
			heights[idx] = top.height;
			if (top.color !== null) {
				colors[idx] = normalizeVoxelPaletteIndex(top.color);
				hasSurface[idx] = 1;
			}
		}
	}

	const passCount = clamp(
		Math.floor(passes) || DEFAULT_SMOOTH_PASSES,
		MIN_SMOOTH_PASSES,
		MAX_SMOOTH_PASSES,
	);
	const sampleHeight = (x: number, z: number): number | null => {
		if (x < 0 || x >= vW || z < 0 || z >= vL) return null;
		if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
			return heights[smoothColumnIndex(x, z, clampedBounds, width)];
		}
		return getColumnTopInRange(grid, dims, x, z, minY, maxY).height;
	};

	for (let pass = 0; pass < passCount; pass++) {
		for (let z = minZ; z <= maxZ; z++) {
			for (let x = minX; x <= maxX; x++) {
				let weightedSum = 0;
				let totalWeight = 0;
				for (let dz = -1; dz <= 1; dz++) {
					for (let dx = -1; dx <= 1; dx++) {
						const sample = sampleHeight(x + dx, z + dz);
						if (sample === null) continue;
						const weight = dx === 0 && dz === 0 ? 4 : dx === 0 || dz === 0 ? 2 : 1;
						weightedSum += sample * weight;
						totalWeight += weight;
					}
				}
				const idx = smoothColumnIndex(x, z, clampedBounds, width);
				const current = heights[idx];
				const averaged = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : current;
				const step = clamp(averaged - current, -1, 1);
				nextHeights[idx] = clamp(current + step, floorHeight, maxY);
			}
		}
		const swap = heights;
		heights = nextHeights;
		nextHeights = swap;
	}

	let changed = false;
	let countDelta = 0;
	for (let z = minZ; z <= maxZ; z++) {
		for (let x = minX; x <= maxX; x++) {
			const columnIndex = smoothColumnIndex(x, z, clampedBounds, width);
			const targetTop = heights[columnIndex];
			const fillColor = resolveSmoothFillColor(
				grid,
				dims,
				clampedBounds,
				colors,
				hasSurface,
				width,
				x,
				z,
			);

			for (let y = minY; y <= maxY; y++) {
				const gIdx = editGridIndex(x, y, z, vW, vL);
				const occupied = editGridHasVoxelAtIndex(grid, gIdx);
				const shouldOccupy = y <= targetTop;

				if (shouldOccupy) {
					if (!occupied) {
						beforeMutation?.(gIdx);
						grid.colors[gIdx] = fillColor;
						editGridSetOccupiedAtIndex(grid, gIdx, true);
						changed = true;
						countDelta++;
					}
					continue;
				}

				if (occupied) {
					beforeMutation?.(gIdx);
					editGridSetOccupiedAtIndex(grid, gIdx, false);
					changed = true;
					countDelta--;
				}
			}
		}
	}

	if (changed) {
		markVoxelRangeDirtyChunks(clampedBounds, dirtyChunks, dims);
	}

	return { changed, countDelta };
}
