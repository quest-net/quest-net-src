import * as THREE from "three";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import type { VoxelTerrainIndex } from "../../../utils/VoxelTerrainIndex";
import { raycastVoxelIndex } from "../../../utils/VoxelRaycast";

export interface PickedVoxelTile {
	x: number;
	y: number;
	/** Tactical height of the surface that was hit. */
	h: number;
}

/**
 * Result of a DDA terrain raycast. Contains everything callers need:
 * the hit voxel in grid coords, world-space hit point and distance,
 * face normal, and pre-computed tactical tile + height.
 */
export interface TerrainDDAHit {
	/** Hit voxel in grid coordinates. */
	vx: number;
	vy: number;
	vz: number;
	/** Outward face normal (-1, 0, or 1 per axis). */
	nx: number;
	ny: number;
	nz: number;
	/** World-space point at the center of the hit face. */
	point: THREE.Vector3;
	/** Distance from ray origin to point. */
	distance: number;
	/** World-space face normal (derived from nx/ny/nz). */
	normal: THREE.Vector3;
	/** Tactical tile X. */
	tileX: number;
	/**
	 * Tactical tile Z (the map's "Y" in PickedVoxelTile / HoveredTile convention).
	 * Named tileZ here to make the axis unambiguous.
	 */
	tileZ: number;
	/** floor((vy + 1) / resolution) -- exact tactical surface height. */
	tacticalHeight: number;
}

/**
 * DDA-based terrain raycast. Replaces intersectFirstTerrainHit + getHitWorldNormal
 * + worldPointToVoxelTile. No BVH or terrain mesh required -- occupancy is read
 * from the VoxelTerrainIndex (backed by a Set<number> in memory).
 *
 * Returns null when the ray misses the grid entirely.
 */
export function raycastTerrainDDA(
	ray: THREE.Ray,
	index: VoxelTerrainIndex,
): TerrainDDAHit | null {
	const hit = raycastVoxelIndex(ray, index);
	if (!hit) return null;

	const { vx, vy, vz, nx, ny, nz } = hit;
	const res = index.resolution;
	const halfVoxel = 0.5 / res;

	// World-space center of the hit voxel.
	const cx = vx / res - index.width  / 2 + halfVoxel;
	const cy = (vy + 0.5) / res - 0.5;
	const cz = vz / res - index.length / 2 + halfVoxel;

	// Face center: displace voxel center by half a voxel along the face normal.
	const point = new THREE.Vector3(
		cx + nx * halfVoxel,
		cy + ny * halfVoxel,
		cz + nz * halfVoxel,
	);

	const distance = ray.origin.distanceTo(point);
	const normal   = new THREE.Vector3(nx, ny, nz);

	// Tactical tile coordinates. No inset needed -- DDA returns the voxel that
	// was hit, not a boundary point, so there's no tile attribution ambiguity.
	const tileX = Math.floor(vx / res);
	const tileZ = Math.floor(vz / res);
	const tacticalHeight = Math.floor((vy + 1) / res);

	return { vx, vy, vz, nx, ny, nz, point, distance, normal, tileX, tileZ, tacticalHeight };
}

/**
 * Convert a TerrainDDAHit to PickedVoxelTile (the shape expected by HoveredTile
 * / movement actions). Note: PickedVoxelTile.y is tactical Z, not world Y.
 */
export function terrainDDAHitToVoxelTile(hit: TerrainDDAHit): PickedVoxelTile {
	return { x: hit.tileX, y: hit.tileZ, h: hit.tacticalHeight };
}

// ---------------------------------------------------------------------------
// worldPointToVoxelTile -- retained for the virtual-ground fallback path in
// ThreeDMovementLayer, which hits a y=0 plane rather than a voxel face.
// ---------------------------------------------------------------------------

// Small inset along the inverse face normal so a hit exactly on a tile
// boundary (e.g. a +X wall face at world x = 0) is attributed to the tile
// that owns the wall, not the tile on the other side of it.
const TILE_PICK_INSET = 1e-3;

/**
 * Map a world-space point (ground-plane hit) to its tactical tile.
 * Only used by the virtual-ground fallback; all voxel face hits now go
 * through raycastTerrainDDA / terrainDDAHitToVoxelTile instead.
 */
export function worldPointToVoxelTile(
	terrain: VoxelTerrain,
	point: THREE.Vector3,
	worldNormal?: THREE.Vector3 | null,
): PickedVoxelTile | null {
	const offsetX = (terrain.Width - 1) / 2;
	const offsetZ = (terrain.Length - 1) / 2;
	const adjustedX = worldNormal ? point.x - worldNormal.x * TILE_PICK_INSET : point.x;
	const adjustedZ = worldNormal ? point.z - worldNormal.z * TILE_PICK_INSET : point.z;
	const x = Math.round(adjustedX + offsetX);
	const y = Math.round(adjustedZ + offsetZ);

	if (x < 0 || x >= terrain.Width || y < 0 || y >= terrain.Length) {
		return null;
	}
	return { x, y, h: 0 };
}
