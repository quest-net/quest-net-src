// src/utils/terrain/editor/VoxelStampUtils.ts
//
// Pure data utilities for stamping one VoxelTerrain into another.
//
// The editor calls iterateStampVoxels() to enumerate the source voxels in
// destination-resolution space, transformed by the active rotation/mirror,
// with coordinates expressed as integer offsets from a bottom-center anchor.
// The editor adds the click anchor (a destination voxel coord) to each
// offset and writes "source paints over destination" into its working grid.
//
// Resolution mismatch is handled the same way changing a terrain's
// resolution does, by reusing getRescaledVoxelRange from
// VoxelTerrainEditorUtils.

import type {
	Voxel,
	VoxelTerrain,
} from "../../../domains/VoxelTerrain/VoxelTerrain";
import { decodeVoxels } from "../data/VoxelDataUtils";
import { getVoxelTerrainResolution } from "../data/VoxelTerrainIndex";
import {
	getRescaledVoxelRange,
	normalizeVoxelPaletteIndex,
} from "./VoxelTerrainEditorUtils";

// Tag prefix that marks a VoxelTerrain as a stamp source. Terrains tagged
// `path:stamps` or any sub-folder thereof appear in the stamp picker.
const STAMP_PATH_PREFIX = "path:stamps";

/** Stamp orientation in the horizontal plane.
 *   rotation: 0..3 quarter-turns clockwise around +Y (looking down).
 *   mirror:   reflect on X *before* rotation.
 * Order is fixed so toggling R/M is predictable: mirror then rotate.
 */
export interface StampTransform {
	rotation: 0 | 1 | 2 | 3;
	mirror: boolean;
}

export const IDENTITY_STAMP_TRANSFORM: StampTransform = {
	rotation: 0,
	mirror: false,
};

export function rotateStampTransform(transform: StampTransform): StampTransform {
	return {
		rotation: ((transform.rotation + 1) % 4) as StampTransform["rotation"],
		mirror: transform.mirror,
	};
}

export function mirrorStampTransform(transform: StampTransform): StampTransform {
	return { rotation: transform.rotation, mirror: !transform.mirror };
}

// --- Stamp source filtering ---------------------------------------------

export function isStampTerrain(terrain: VoxelTerrain): boolean {
	if (!terrain.Tags) return false;
	for (const tag of terrain.Tags) {
		if (tag === STAMP_PATH_PREFIX) return true;
		if (tag.startsWith(STAMP_PATH_PREFIX + "/")) return true;
	}
	return false;
}

/** Returns stamp-tagged terrains, excluding the terrain currently being edited
 *  (a terrain cannot stamp into itself).
 */
export function listStampTerrains(
	all: ReadonlyArray<VoxelTerrain>,
	excludeId?: string
): VoxelTerrain[] {
	return all.filter(
		(terrain) => terrain.Id !== excludeId && isStampTerrain(terrain)
	);
}

// --- Transform primitive -------------------------------------------------

// Applies the stamp transform to a horizontal offset (ox, oz) relative to
// the source's bottom-center anchor. Order: mirror on X, then rotate CW.
// 90 deg CW around +Y maps (ox, oz) -> (-oz, ox).
function transformHorizontalOffset(
	ox: number,
	oz: number,
	transform: StampTransform
): { ox: number; oz: number } {
	let x = transform.mirror ? -ox : ox;
	let z = oz;
	for (let i = 0; i < transform.rotation; i++) {
		const nextX = -z;
		z = x;
		x = nextX;
	}
	return { ox: x, oz: z };
}

// --- Enumeration ---------------------------------------------------------

interface DestCell {
	x: number;
	y: number;
	z: number;
	color: number;
}

// Rescales every source voxel into destination-resolution space, expanding
// it into the cube(s) it covers per axis. Reuses getRescaledVoxelRange so we
// match the behavior of reshapeVoxelTerrainForEditor exactly.
function* iterateRescaledCells(
	source: VoxelTerrain,
	destResolution: number
): Generator<DestCell> {
	const sourceResolution = getVoxelTerrainResolution(source);
	if (sourceResolution === destResolution) {
		for (const voxel of decodeVoxels(source.Voxels)) {
			yield {
				x: voxel.x,
				y: voxel.y,
				z: voxel.z,
				color: normalizeVoxelPaletteIndex(voxel.color),
			};
		}
		return;
	}

	// Pass a generous max; final bounds checking happens at the destination
	// grid since the anchor offset can shift coordinates around.
	const HUGE = Number.MAX_SAFE_INTEGER;
	for (const voxel of decodeVoxels(source.Voxels)) {
		const xRange = getRescaledVoxelRange(voxel.x, sourceResolution, destResolution, HUGE);
		const yRange = getRescaledVoxelRange(voxel.y, sourceResolution, destResolution, HUGE);
		const zRange = getRescaledVoxelRange(voxel.z, sourceResolution, destResolution, HUGE);
		if (!xRange || !yRange || !zRange) continue;

		const color = normalizeVoxelPaletteIndex(voxel.color);
		for (let dz = zRange.start; dz < zRange.end; dz++) {
			for (let dy = yRange.start; dy < yRange.end; dy++) {
				for (let dx = xRange.start; dx < xRange.end; dx++) {
					yield { x: dx, y: dy, z: dz, color };
				}
			}
		}
	}
}

/**
 * Yields the source's voxels remapped into destination-resolution space and
 * transformed by `transform`. Each yielded voxel's coordinates are integer
 * offsets from the source's bottom-center anchor:
 *   x: signed horizontal offset (left/right)
 *   y: 0 at the bottom of the source bbox, increasing upward
 *   z: signed horizontal offset (forward/back)
 * The caller adds the click anchor in destination voxel coords to place the
 * stamp. When upscaling resolution, several offsets may share coords; that
 * is fine since stamping is last-write-wins on overlap.
 */
export function* iterateStampVoxels(
	source: VoxelTerrain,
	destResolution: number,
	transform: StampTransform
): Generator<Voxel> {
	// Two-pass: first collect rescaled cells and the bbox, then emit
	// anchor-relative + transformed offsets. We need the bbox up front to
	// compute the anchor.
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	let minZ = Infinity;
	let maxZ = -Infinity;
	const cells: DestCell[] = [];

	for (const cell of iterateRescaledCells(source, destResolution)) {
		cells.push(cell);
		if (cell.x < minX) minX = cell.x;
		if (cell.x > maxX) maxX = cell.x;
		if (cell.y < minY) minY = cell.y;
		if (cell.y > maxY) maxY = cell.y;
		if (cell.z < minZ) minZ = cell.z;
		if (cell.z > maxZ) maxZ = cell.z;
	}

	if (cells.length === 0) return;

	// Anchor: horizontal center, vertical bottom. floor() keeps the anchor on
	// the integer lattice; asymmetric stamps will lean by one voxel, which is
	// acceptable for the bottom-center rule.
	const anchorX = Math.floor((minX + maxX) / 2);
	const anchorY = minY;
	const anchorZ = Math.floor((minZ + maxZ) / 2);

	for (const cell of cells) {
		const { ox, oz } = transformHorizontalOffset(
			cell.x - anchorX,
			cell.z - anchorZ,
			transform
		);
		yield {
			x: ox,
			y: cell.y - anchorY,
			z: oz,
			color: cell.color,
		};
	}
}
