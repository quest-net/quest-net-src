// EditGrid: the in-memory voxel buffer the editor mutates during strokes.
//
// Encoding: index = vx + vz * vW + vy * vW * vL
//   colors[index]   stores palette index 0..255
//   occupied[index] bit stores whether that color byte is a real voxel
//
// Reads and writes are O(1). The grid is decoded from terrain.Voxels once on
// mount (or on shape change) so strokes do not mutate the encoded SVO payload
// directly. The draft is re-encoded only at commit boundaries.

import {
	countSetBits,
	createBitset,
	isBitSet,
	setBit,
} from "../../BitsetUtils";
import { decodeVoxels, encodeVoxels } from "../data/VoxelDataUtils";
import type { VoxelTerrainIndex } from "../data/VoxelTerrainIndex";
import type { VoxelColorGrid } from "./VoxelTerrainSelectionUtils";
import { normalizeVoxelPaletteIndex } from "./VoxelTerrainEditorUtils";

export type EditGrid = VoxelColorGrid;

export interface EditGridShape {
	vW: number;
	vH: number;
	vL: number;
}

export function editGridIndex(
	vx: number,
	vy: number,
	vz: number,
	vW: number,
	vL: number,
): number {
	return vx + vz * vW + vy * vW * vL;
}

/**
 * Bounds test for the draft edit grid. The grid layer is deliberately decoupled
 * from VoxelTerrainIndex (it mutates a raw buffer keyed by shape, not a committed
 * terrain), so this takes the shape dims directly rather than an index. This is
 * the draft-layer counterpart to `index.inVoxelBounds`.
 */
export function inGridBounds(
	vx: number, vy: number, vz: number,
	vW: number, vH: number, vL: number,
): boolean {
	return vx >= 0 && vx < vW && vy >= 0 && vy < vH && vz >= 0 && vz < vL;
}

export function createEditGrid(length: number): EditGrid {
	return {
		colors: new Uint8Array(length),
		occupied: createBitset(length),
		length,
	};
}

export function copyEditGrid(target: EditGrid, source: EditGrid): void {
	target.colors.set(source.colors);
	target.occupied.set(source.occupied);
	target.length = source.length;
}

export function editGridHasVoxelAtIndex(grid: EditGrid, index: number): boolean {
	return isBitSet(grid.occupied, index);
}

export function editGridSetOccupiedAtIndex(
	grid: EditGrid,
	index: number,
	occupied: boolean,
): void {
	setBit(grid.occupied, index, occupied);
}

export function editGridHasVoxel(
	grid: EditGrid,
	vx: number, vy: number, vz: number,
	vW: number, vH: number, vL: number,
): boolean {
	if (!inGridBounds(vx, vy, vz, vW, vH, vL)) return false;
	return editGridHasVoxelAtIndex(grid, editGridIndex(vx, vy, vz, vW, vL));
}

export function editGridGetColor(
	grid: EditGrid,
	vx: number, vy: number, vz: number,
	vW: number, vH: number, vL: number,
): number | null {
	if (!inGridBounds(vx, vy, vz, vW, vH, vL)) return null;
	const index = editGridIndex(vx, vy, vz, vW, vL);
	return editGridHasVoxelAtIndex(grid, index) ? grid.colors[index] : null;
}

export function getColumnTopInRange(
	grid: EditGrid,
	shape: EditGridShape,
	x: number,
	z: number,
	minY: number,
	maxY: number,
): { height: number; color: number | null } {
	const { vW, vH, vL } = shape;
	if (x < 0 || x >= vW || z < 0 || z >= vL) {
		return { height: minY - 1, color: null };
	}

	const clampedMinY = Math.max(0, Math.min(minY, Math.max(0, vH - 1)));
	const clampedMaxY = Math.max(clampedMinY, Math.min(maxY, Math.max(0, vH - 1)));
	for (let y = clampedMaxY; y >= clampedMinY; y--) {
		const index = editGridIndex(x, y, z, vW, vL);
		if (editGridHasVoxelAtIndex(grid, index)) {
			return { height: y, color: grid.colors[index] };
		}
	}

	return { height: minY - 1, color: null };
}

export function buildEditGrid(voxels: Uint8Array, index: VoxelTerrainIndex): EditGrid {
	const { voxelWidth: vW, voxelHeight: vH, voxelLength: vL } = index;
	const grid = createEditGrid(vW * vH * vL);
	for (const v of decodeVoxels(voxels)) {
		if (!inGridBounds(v.x, v.y, v.z, vW, vH, vL)) continue;
		const idx = editGridIndex(v.x, v.y, v.z, vW, vL);
		grid.colors[idx] = normalizeVoxelPaletteIndex(v.color);
		editGridSetOccupiedAtIndex(grid, idx, true);
	}
	return grid;
}

export function encodeEditGrid(grid: EditGrid, vW: number, vH: number, vL: number): Uint8Array {
	const voxels = [];
	for (let y = 0; y < vH; y++) {
		for (let z = 0; z < vL; z++) {
			for (let x = 0; x < vW; x++) {
				const idx = editGridIndex(x, y, z, vW, vL);
				if (editGridHasVoxelAtIndex(grid, idx)) {
					voxels.push({ x, y, z, color: grid.colors[idx] });
				}
			}
		}
	}
	return encodeVoxels(voxels);
}

export function countEditGridVoxels(grid: EditGrid): number {
	return countSetBits(grid.occupied);
}

// ---------------------------------------------------------------------------
// Delta-based undo/redo
//
// GridDelta records only the voxels that changed during a stroke.
// oldStates / newStates pack the occupancy flag into bit 8 and the palette
// index into bits 0-7, stored in Uint16Arrays for compact memory.
// On undo we apply oldStates; on redo we apply newStates.
// Both the undo and redo stacks store the same UndoEntry object -- the
// direction of application is determined by which function calls it.
// ---------------------------------------------------------------------------

export interface GridDelta {
	indices:    Uint32Array;  // flat voxel indices
	oldStates:  Uint16Array;  // bit 8 = was occupied, bits 0-7 = old color
	newStates:  Uint16Array;  // bit 8 = is  occupied, bits 0-7 = new color
	countDelta: number;       // net change in occupied-voxel count
}

export function applyDeltaToGrid(
	grid:        EditGrid,
	delta:       GridDelta,
	direction:   "undo" | "redo",
	vW: number,
	vL: number,
	onVoxelChanged: (vx: number, vy: number, vz: number) => void,
): void {
	const states = direction === "undo" ? delta.oldStates : delta.newStates;
	for (let i = 0; i < delta.indices.length; i++) {
		const idx      = delta.indices[i];
		const packed   = states[i];
		const occupied = (packed & 0x100) !== 0;
		const color    = packed & 0xFF;
		grid.colors[idx] = color;
		editGridSetOccupiedAtIndex(grid, idx, occupied);
		// Derive vx, vy, vz from flat index: idx = vx + vz*vW + vy*vW*vL
		const vx  = idx % vW;
		const rem = (idx / vW) | 0;
		const vz  = rem % vL;
		const vy  = (rem / vL) | 0;
		onVoxelChanged(vx, vy, vz);
	}
}
