import { isBitSet } from "../../BitsetUtils";

export interface VoxelCoord {
	x: number;
	y: number;
	z: number;
}

export interface VoxelGridDims {
	vW: number;
	vH: number;
	vL: number;
}

export interface VoxelColorGrid {
	colors: Uint8Array;
	occupied: Uint8Array;
	length: number;
}

export interface VoxelSelectionBounds {
	min: VoxelCoord;
	max: VoxelCoord;
}

export type TerrainSelection =
	| {
		kind: "box";
		id: number;
		bounds: VoxelSelectionBounds;
	}
	| {
		kind: "mask";
		id: number;
		label: string;
		// Sorted flat edit-grid indices of the selected voxels (one entry each),
		// not a dense full-grid mask -- keeps memory at O(selectedCount), which
		// matters on large terrains where a dense Uint8Array(grid.length) is huge.
		indices: Uint32Array;
		selectedCount: number;
		bounds: VoxelSelectionBounds | null;
		colorIndex?: number;
	};

function clampInt(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, Math.floor(value) || 0));
}

export function clampVoxelCoord(coord: VoxelCoord, dims: VoxelGridDims): VoxelCoord {
	return {
		x: clampInt(coord.x, 0, Math.max(0, dims.vW - 1)),
		y: clampInt(coord.y, 0, Math.max(0, dims.vH - 1)),
		z: clampInt(coord.z, 0, Math.max(0, dims.vL - 1)),
	};
}

export function normalizeVoxelSelectionBounds(
	a: VoxelCoord,
	b: VoxelCoord,
	dims: VoxelGridDims
): VoxelSelectionBounds {
	const ca = clampVoxelCoord(a, dims);
	const cb = clampVoxelCoord(b, dims);
	return {
		min: {
			x: Math.min(ca.x, cb.x),
			y: Math.min(ca.y, cb.y),
			z: Math.min(ca.z, cb.z),
		},
		max: {
			x: Math.max(ca.x, cb.x),
			y: Math.max(ca.y, cb.y),
			z: Math.max(ca.z, cb.z),
		},
	};
}

export function combineVoxelSelectionBounds(
	a: VoxelSelectionBounds,
	b: VoxelSelectionBounds,
	dims: VoxelGridDims
): VoxelSelectionBounds {
	return normalizeVoxelSelectionBounds(
		{
			x: Math.min(a.min.x, b.min.x),
			y: Math.min(a.min.y, b.min.y),
			z: Math.min(a.min.z, b.min.z),
		},
		{
			x: Math.max(a.max.x, b.max.x),
			y: Math.max(a.max.y, b.max.y),
			z: Math.max(a.max.z, b.max.z),
		},
		dims
	);
}

export function getVoxelSelectionBounds(
	selection: TerrainSelection | null
): VoxelSelectionBounds | null {
	if (!selection) return null;
	return selection.bounds;
}

export function getVoxelSelectionSpaceCount(selection: TerrainSelection): number {
	if (selection.kind === "mask") return selection.selectedCount;

	const { min, max } = selection.bounds;
	return (
		(max.x - min.x + 1) *
		(max.y - min.y + 1) *
		(max.z - min.z + 1)
	);
}

export function editGridOffsetToVoxelCoord(
	offset: number,
	dims: VoxelGridDims
): VoxelCoord {
	const layerSize = dims.vW * dims.vL;
	const y = Math.floor(offset / layerSize);
	const rem = offset - y * layerSize;
	const z = Math.floor(rem / dims.vW);
	const x = rem - z * dims.vW;
	return { x, y, z };
}

export function createColorVoxelSelection(
	grid: VoxelColorGrid,
	dims: VoxelGridDims,
	colorIndex: number,
	id: number
): TerrainSelection {
	// First pass: count matches so we can allocate an exact Uint32Array rather
	// than growing a boxed number[] (which would be far heavier for millions of
	// matched voxels). Second pass fills indices + bounds. Both scans are O(N)
	// reads with no O(N) allocation -- the result holds only selected voxels.
	let selectedCount = 0;
	for (let i = 0; i < grid.length; i++) {
		if (isBitSet(grid.occupied, i) && grid.colors[i] === colorIndex) {
			selectedCount++;
		}
	}

	const indices = new Uint32Array(selectedCount);
	let write = 0;
	let min: VoxelCoord | null = null;
	let max: VoxelCoord | null = null;

	for (let i = 0; i < grid.length; i++) {
		if (!isBitSet(grid.occupied, i) || grid.colors[i] !== colorIndex) continue;

		indices[write++] = i;

		const coord = editGridOffsetToVoxelCoord(i, dims);
		if (!min || !max) {
			min = { ...coord };
			max = { ...coord };
		} else {
			if (coord.x < min.x) min.x = coord.x;
			if (coord.y < min.y) min.y = coord.y;
			if (coord.z < min.z) min.z = coord.z;
			if (coord.x > max.x) max.x = coord.x;
			if (coord.y > max.y) max.y = coord.y;
			if (coord.z > max.z) max.z = coord.z;
		}
	}

	return {
		kind: "mask",
		id,
		label: `Color ${colorIndex}`,
		indices,
		selectedCount,
		bounds: min && max ? { min, max } : null,
		colorIndex,
	};
}

export function* iterateVoxelSelectionSpace(
	selection: TerrainSelection,
	dims: VoxelGridDims
): Generator<VoxelCoord> {
	if (selection.kind === "box") {
		const { min, max } = selection.bounds;
		for (let y = min.y; y <= max.y; y++) {
			for (let z = min.z; z <= max.z; z++) {
				for (let x = min.x; x <= max.x; x++) {
					yield { x, y, z };
				}
			}
		}
		return;
	}

	for (let i = 0; i < selection.indices.length; i++) {
		yield editGridOffsetToVoxelCoord(selection.indices[i], dims);
	}
}
