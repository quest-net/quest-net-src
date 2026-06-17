// Brush / pick coordinate math for the voxel terrain editor.
//
// These helpers convert a single pick (the voxel + face normal returned from
// the DDA raycaster, or a ground-plane fallback) into the set of destination
// voxel coordinates a brush stroke should affect.

import type * as THREE from "three";
import type { VoxelTerrainIndex } from "../data/VoxelTerrainIndex";
import {
	normalizeVoxelSelectionBounds,
	type VoxelCoord,
	type VoxelSelectionBounds,
} from "./VoxelTerrainSelectionUtils";
import type { ChunkDims } from "./EditGridChunkUtils";
import { clamp } from "../../math";

export const MIN_BRUSH_SIZE = 1;
export const MAX_BRUSH_SIZE = 8;

export type EditGranularity = "tactical" | "voxel";
export type BrushTool = "place" | "erase" | "paint" | "sample";

export interface PickInfo {
	voxel: VoxelCoord;
	normal: VoxelCoord;
	ground: boolean;
	/**
	 * The world-space plane of the picked face. Reused across pick calls -- the
	 * pointer-down handler clones this before storing it in the stroke state.
	 */
	plane: THREE.Plane;
}

/**
 * Snaps a pick to a tactical tile anchor: the tactical (x, y) column under the
 * pick, with the height snapped to the nearest standing surface in that column
 * (or 0 for an empty column / ground pick). Shared by terrain-link placement,
 * the link-destination anchor picker, and the link hover ghost so all three
 * resolve the same tile from a given pick.
 */
export function pickToTacticalAnchor(
	pick: PickInfo,
	index: VoxelTerrainIndex,
): { x: number; y: number; h: number } {
	const x = Math.floor(pick.voxel.x / index.resolution);
	const y = Math.floor(pick.voxel.z / index.resolution);
	const pickedTactical = pick.ground
		? 0
		: Math.floor((pick.voxel.y + (pick.normal.y > 0 ? 1 : 0)) / index.resolution);

	const columnSurfaces = index.allSurfaces.get(`${x},${y}`) ?? [];
	let h = pick.ground ? 0 : pickedTactical;
	if (columnSurfaces.length > 0) {
		let best = columnSurfaces[0];
		let bestDist = Math.abs(best - pickedTactical);
		for (const surface of columnSurfaces) {
			const dist = Math.abs(surface - pickedTactical);
			if (dist < bestDist) {
				best = surface;
				bestDist = dist;
			}
		}
		h = best;
	}

	return { x, y, h };
}

export function isVoxelInBounds(index: VoxelTerrainIndex, coord: VoxelCoord): boolean {
	return (
		coord.x >= 0 && coord.x < index.voxelWidth &&
		coord.y >= 0 && coord.y < index.voxelHeight &&
		coord.z >= 0 && coord.z < index.voxelLength
	);
}

export function pointToVoxelCoord(
	point: { x: number; y: number; z: number },
	index: VoxelTerrainIndex,
): VoxelCoord {
	return {
		x: Math.floor((point.x + index.width  / 2) * index.resolution),
		y: Math.floor((point.y + 0.5)              * index.resolution),
		z: Math.floor((point.z + index.length / 2) * index.resolution),
	};
}

export function getBrushOffsets(size: number): number[] {
	const safeSize = clamp(Math.floor(size) || MIN_BRUSH_SIZE, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
	const start = -Math.floor((safeSize - 1) / 2);
	return Array.from({ length: safeSize }, (_, i) => start + i);
}

export function getPlaneBrushCoords(
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

export function getTacticalBrushUnits(
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

export function getTacticalUnitFromVoxel(
	coord: VoxelCoord,
	index: VoxelTerrainIndex,
): VoxelCoord {
	return {
		x: Math.floor(coord.x / index.resolution),
		y: Math.floor(coord.y / index.resolution),
		z: Math.floor(coord.z / index.resolution),
	};
}

export function getTacticalBlockCoords(
	unit: VoxelCoord,
	index: VoxelTerrainIndex,
): VoxelCoord[] {
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

export function getPickSelectionBounds(
	index: VoxelTerrainIndex,
	pick: PickInfo,
	granularity: EditGranularity,
	dims: ChunkDims,
): VoxelSelectionBounds {
	if (granularity === "voxel") {
		return normalizeVoxelSelectionBounds(pick.voxel, pick.voxel, dims);
	}

	const unit = getTacticalUnitFromVoxel(pick.voxel, index);
	const start = {
		x: unit.x * index.resolution,
		y: unit.y * index.resolution,
		z: unit.z * index.resolution,
	};
	const end = {
		x: start.x + index.resolution - 1,
		y: start.y + index.resolution - 1,
		z: start.z + index.resolution - 1,
	};
	return normalizeVoxelSelectionBounds(start, end, dims);
}

/**
 * Compute the destination voxel coordinates a brush stroke should affect for
 * `tool` at `pick`. For `place`, the brush sits *on* the picked face (one step
 * along the normal). For other tools, it sits *in* the picked voxel.
 */
export function collectAffectedCoords(
	index: VoxelTerrainIndex,
	pick: PickInfo,
	tool: BrushTool,
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
