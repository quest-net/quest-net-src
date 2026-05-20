// src/utils/VoxelRaycast.ts
//
// Amanatides & Woo "Fast Voxel Traversal Algorithm" (1987) for picking in a
// regular voxel grid. No mesh or BVH required -- occupancy is read directly
// from a flat Uint8Array. Shared by VoxelTerrainEditor (Phase 1) and, once
// Phase 2 is complete, the gameplay map raycasting paths.
//
// Reference: http://www.cse.yorku.ca/~amana/research/grid.pdf
//
// Grid coordinate conventions (matching the editor edit grid):
//   index = vx + vz * vW + vy * vW * vL
//   value = 0 (empty) | (paletteIndex + 1) (occupied)
//
// World-to-grid transform:
//   vx = (worldX + tW / 2) * resolution
//   vy = (worldY + 0.5)    * resolution
//   vz = (worldZ + tL / 2) * resolution
//
// --- Why AABB entry clipping is required ---------------------------------
//
// In the orthographic isometric editor view the camera sits at (d, d, d) and
// the ray direction has a significant downward component.  The ray origin
// (in voxel space) is therefore ABOVE the grid -- vy >= vH -- on virtually
// every pointer event.  Without clipping the DDA would detect "out of bounds"
// on the very first step and return null, falling through to the ground-plane
// fallback and giving only y=0 edits.
//
// The fix: use slab-method AABB intersection to advance the ray to the grid
// entry point before the DDA loop begins.  The slab that "wins" the tEntry
// race also gives us the entry face normal for free.
// -------------------------------------------------------------------------

import * as THREE from 'three';
import type { VoxelTerrainIndex } from './VoxelTerrainIndex';

export interface VoxelRayHit {
	/** Grid coordinates of the hit voxel. */
	vx: number;
	vy: number;
	vz: number;
	/** Outward face normal at the hit surface (-1, 0, or 1 per axis). */
	nx: number;
	ny: number;
	nz: number;
}

/**
 * Cast a ray through a flat voxel occupancy grid using DDA traversal.
 * Returns the first occupied voxel hit, or null if none.
 *
 * @param ray        THREE.Ray in world space.
 * @param grid       Flat Uint8Array: index = vx + vz*vW + vy*vW*vL. 0 = empty.
 * @param vW         Grid width  in voxels.
 * @param vH         Grid height in voxels.
 * @param vL         Grid length in voxels.
 * @param resolution Voxels per tactical unit (e.g. 1, 2, or 3).
 * @param tW         Terrain width  in tactical units.
 * @param tL         Terrain length in tactical units.
 */
export function raycastVoxelGrid(
	ray: THREE.Ray,
	grid: Uint8Array,
	vW: number,
	vH: number,
	vL: number,
	resolution: number,
	tW: number,
	tL: number,
): VoxelRayHit | null {
	// Transform ray origin into fractional voxel coordinates.
	// Direction is also scaled by resolution so tDelta values are in the same
	// units; the DDA result is identical (just a uniform time rescaling).
	const ox = (ray.origin.x + tW / 2) * resolution;
	const oy = (ray.origin.y + 0.5)    * resolution;
	const oz = (ray.origin.z + tL / 2) * resolution;
	const dx = ray.direction.x * resolution;
	const dy = ray.direction.y * resolution;
	const dz = ray.direction.z * resolution;

	// -------------------------------------------------------------------------
	// Step 1: clip the ray to the grid AABB [0,vW) x [0,vH) x [0,vL) using the
	// slab method.  Track which slab last raised tEntry -- that slab's face is
	// the entry normal (the face through which the ray first enters the grid).
	// -------------------------------------------------------------------------

	let tEntry = 0;           // parametric t at grid entry (0 = ray origin inside)
	let tExit  = Infinity;    // parametric t at grid exit
	let nx = 0, ny = 0, nz = 0; // outward normal of entry face (zero if inside)

	// X slab [0, vW]
	if (dx !== 0) {
		const ta = (0  - ox) / dx;
		const tb = (vW - ox) / dx;
		const tNear = Math.min(ta, tb);
		const tFar  = Math.max(ta, tb);
		if (tNear > tEntry) {
			tEntry = tNear;
			// Entry face: ray enters from the side where the component is negative
			// (i.e. it entered through the high-x face if dx<0, low-x if dx>0).
			nx = dx > 0 ? -1 : 1;
			ny = 0;
			nz = 0;
		}
		tExit = Math.min(tExit, tFar);
	} else if (ox < 0 || ox >= vW) {
		return null; // Ray parallel to X axis and outside X slab
	}

	// Y slab [0, vH]
	if (dy !== 0) {
		const ta = (0  - oy) / dy;
		const tb = (vH - oy) / dy;
		const tNear = Math.min(ta, tb);
		const tFar  = Math.max(ta, tb);
		if (tNear > tEntry) {
			tEntry = tNear;
			nx = 0;
			ny = dy > 0 ? -1 : 1;
			nz = 0;
		}
		tExit = Math.min(tExit, tFar);
	} else if (oy < 0 || oy >= vH) {
		return null; // Ray parallel to Y axis and outside Y slab
	}

	// Z slab [0, vL]
	if (dz !== 0) {
		const ta = (0  - oz) / dz;
		const tb = (vL - oz) / dz;
		const tNear = Math.min(ta, tb);
		const tFar  = Math.max(ta, tb);
		if (tNear > tEntry) {
			tEntry = tNear;
			nx = 0;
			ny = 0;
			nz = dz > 0 ? -1 : 1;
		}
		tExit = Math.min(tExit, tFar);
	} else if (oz < 0 || oz >= vL) {
		return null; // Ray parallel to Z axis and outside Z slab
	}

	if (tExit <= tEntry) return null; // Ray misses grid entirely

	// -------------------------------------------------------------------------
	// Step 2: advance to the entry point and compute the starting voxel.
	// Clamp to [0, dim-1] to handle floating-point boundary edge cases
	// (e.g. floor(1.0) = 1 when vH = 1 would be out of range).
	// -------------------------------------------------------------------------

	const ex = ox + tEntry * dx;
	const ey = oy + tEntry * dy;
	const ez = oz + tEntry * dz;

	let vx = Math.min(Math.max(Math.floor(ex), 0), vW - 1);
	let vy = Math.min(Math.max(Math.floor(ey), 0), vH - 1);
	let vz = Math.min(Math.max(Math.floor(ez), 0), vL - 1);

	// Check the entry voxel itself.
	if (grid[vx + vz * vW + vy * vW * vL] !== 0) {
		return { vx, vy, vz, nx, ny, nz };
	}

	// -------------------------------------------------------------------------
	// Step 3: standard DDA from the entry voxel.
	// At this point (vx, vy, vz) is inside the grid, so any out-of-bounds step
	// genuinely means the ray has left the grid.
	// -------------------------------------------------------------------------

	const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
	const stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0);
	const stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);

	// tDelta: parametric distance to cross one full voxel on each axis.
	const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
	const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
	const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

	// tMax: parametric t (measured from the original ray origin ox/oy/oz) to the
	// next boundary crossing on each axis from the current voxel.
	const bX = dx >= 0 ? vx + 1 : vx;
	const bY = dy >= 0 ? vy + 1 : vy;
	const bZ = dz >= 0 ? vz + 1 : vz;
	let tMaxX = dx !== 0 ? (bX - ox) / dx : Infinity;
	let tMaxY = dy !== 0 ? (bY - oy) / dy : Infinity;
	let tMaxZ = dz !== 0 ? (bZ - oz) / dz : Infinity;

	// Guard: a ray cannot visit more voxels than the grid's longest diagonal.
	const maxSteps = vW + vH + vL + 8;

	for (let step = 0; step < maxSteps; step++) {
		// Advance to the nearest boundary crossing (tiebreak: X, then Y, then Z).
		if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
			vx += stepX;
			nx = -stepX; ny = 0; nz = 0;
			tMaxX += tDeltaX;
		} else if (tMaxY <= tMaxZ) {
			vy += stepY;
			nx = 0; ny = -stepY; nz = 0;
			tMaxY += tDeltaY;
		} else {
			vz += stepZ;
			nx = 0; ny = 0; nz = -stepZ;
			tMaxZ += tDeltaZ;
		}

		// We started inside the grid, so any out-of-bounds step means we exited.
		if (vx < 0 || vx >= vW || vy < 0 || vy >= vH || vz < 0 || vz >= vL) break;

		if (grid[vx + vz * vW + vy * vW * vL] !== 0) {
			return { vx, vy, vz, nx, ny, nz };
		}
	}

	return null;
}

/**
 * Same DDA traversal as raycastVoxelGrid but reads occupancy from a
 * VoxelTerrainIndex (via hasVoxel) instead of a raw Uint8Array.
 * Use this from gameplay-map call sites that already hold an index
 * (ThreeDMovementLayer, ThreeDActorLayer, ThreeDPingLayer) so they
 * don't need to expose or copy the raw grid buffer.
 */
export function raycastVoxelIndex(
	ray: THREE.Ray,
	index: VoxelTerrainIndex,
): VoxelRayHit | null {
	const { voxelWidth: vW, voxelHeight: vH, voxelLength: vL, resolution, width: tW, length: tL } = index;

	const ox = (ray.origin.x + tW / 2) * resolution;
	const oy = (ray.origin.y + 0.5)    * resolution;
	const oz = (ray.origin.z + tL / 2) * resolution;
	const dx = ray.direction.x * resolution;
	const dy = ray.direction.y * resolution;
	const dz = ray.direction.z * resolution;

	// Slab clipping -- identical to raycastVoxelGrid.
	let tEntry = 0;
	let tExit  = Infinity;
	let nx = 0, ny = 0, nz = 0;

	if (dx !== 0) {
		const ta = (0  - ox) / dx;
		const tb = (vW - ox) / dx;
		const tNear = Math.min(ta, tb);
		const tFar  = Math.max(ta, tb);
		if (tNear > tEntry) { tEntry = tNear; nx = dx > 0 ? -1 : 1; ny = 0; nz = 0; }
		tExit = Math.min(tExit, tFar);
	} else if (ox < 0 || ox >= vW) {
		return null;
	}

	if (dy !== 0) {
		const ta = (0  - oy) / dy;
		const tb = (vH - oy) / dy;
		const tNear = Math.min(ta, tb);
		const tFar  = Math.max(ta, tb);
		if (tNear > tEntry) { tEntry = tNear; nx = 0; ny = dy > 0 ? -1 : 1; nz = 0; }
		tExit = Math.min(tExit, tFar);
	} else if (oy < 0 || oy >= vH) {
		return null;
	}

	if (dz !== 0) {
		const ta = (0  - oz) / dz;
		const tb = (vL - oz) / dz;
		const tNear = Math.min(ta, tb);
		const tFar  = Math.max(ta, tb);
		if (tNear > tEntry) { tEntry = tNear; nx = 0; ny = 0; nz = dz > 0 ? -1 : 1; }
		tExit = Math.min(tExit, tFar);
	} else if (oz < 0 || oz >= vL) {
		return null;
	}

	if (tExit <= tEntry) return null;

	const ex = ox + tEntry * dx;
	const ey = oy + tEntry * dy;
	const ez = oz + tEntry * dz;

	let vx = Math.min(Math.max(Math.floor(ex), 0), vW - 1);
	let vy = Math.min(Math.max(Math.floor(ey), 0), vH - 1);
	let vz = Math.min(Math.max(Math.floor(ez), 0), vL - 1);

	if (index.hasVoxel(vx, vy, vz)) {
		return { vx, vy, vz, nx, ny, nz };
	}

	const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
	const stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0);
	const stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);

	const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
	const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
	const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

	const bX = dx >= 0 ? vx + 1 : vx;
	const bY = dy >= 0 ? vy + 1 : vy;
	const bZ = dz >= 0 ? vz + 1 : vz;
	let tMaxX = dx !== 0 ? (bX - ox) / dx : Infinity;
	let tMaxY = dy !== 0 ? (bY - oy) / dy : Infinity;
	let tMaxZ = dz !== 0 ? (bZ - oz) / dz : Infinity;

	const maxSteps = vW + vH + vL + 8;

	for (let step = 0; step < maxSteps; step++) {
		if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
			vx += stepX;
			nx = -stepX; ny = 0; nz = 0;
			tMaxX += tDeltaX;
		} else if (tMaxY <= tMaxZ) {
			vy += stepY;
			nx = 0; ny = -stepY; nz = 0;
			tMaxY += tDeltaY;
		} else {
			vz += stepZ;
			nx = 0; ny = 0; nz = -stepZ;
			tMaxZ += tDeltaZ;
		}

		if (vx < 0 || vx >= vW || vy < 0 || vy >= vH || vz < 0 || vz >= vL) break;

		if (index.hasVoxel(vx, vy, vz)) {
			return { vx, vy, vz, nx, ny, nz };
		}
	}

	return null;
}
