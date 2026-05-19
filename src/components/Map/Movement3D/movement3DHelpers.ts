import * as THREE from "three";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";

export interface PickedVoxelTile {
	x: number;
	y: number;
	/** Tactical height of the surface that was hit. */
	h: number;
}

// Small inset along the inverse face normal so a hit exactly on a tile
// boundary (e.g. a +X wall face at world x = 0) is attributed to the tile
// that owns the wall, not the tile on the other side of it.
const TILE_PICK_INSET = 1e-3;

/**
 * Map a terrain raycast hit point to the tactical tile that owns the face,
 * including the exact tactical height (h) of the hit surface.
 *
 * When the hit is on a side face, the world point lies on the boundary
 * between two tactical tiles. Naive Math.round biases the result toward
 * the tile beyond the wall (i.e. the one you can't see), which produced
 * the "click on a wall picks the tile behind it" bug. We bias the lookup
 * by stepping a tiny amount along the inverse face normal so the rounded
 * coordinate lands inside the cube whose face was hit.
 *
 * The tactical height is read from the tileHeight vertex attribute stored
 * on the terrain geometry.  This allows the caller to distinguish between
 * two surfaces in the same (x,y) column -- e.g. ground under a staircase
 * vs. the top of the staircase.
 */
export function worldPointToVoxelTile(
	terrain: VoxelTerrain,
	point: THREE.Vector3,
	worldNormal?: THREE.Vector3 | null,
	hitFace?: THREE.Face | null,
	hitObject?: THREE.Object3D | null
): PickedVoxelTile | null {
	const offsetX = (terrain.Width - 1) / 2;
	const offsetZ = (terrain.Length - 1) / 2;
	const adjustedX = worldNormal
		? point.x - worldNormal.x * TILE_PICK_INSET
		: point.x;
	const adjustedZ = worldNormal
		? point.z - worldNormal.z * TILE_PICK_INSET
		: point.z;
	const x = Math.round(adjustedX + offsetX);
	const y = Math.round(adjustedZ + offsetZ);

	if (x < 0 || x >= terrain.Width || y < 0 || y >= terrain.Length) {
		return null;
	}

	// Read the pre-computed tileHeight attribute from the hit face's geometry.
	// This is floor((voxelY + 1) / resolution) stored per vertex in
	// VoxelTerrainGeometryUtils.  Using Math.round guards against float
	// precision drift since the values are whole tactical-unit integers.
	let h = 0;
	if (hitFace && hitObject instanceof THREE.Mesh) {
		const attr = hitObject.geometry.attributes['tileHeight'] as THREE.BufferAttribute | undefined;
		if (attr) {
			h = Math.round(attr.getX(hitFace.a));
		}
	}

	return { x, y, h };
}

const _hitNormalMatrix = new THREE.Matrix3();
const _hitNormal = new THREE.Vector3();

/**
 * World-space normal of the hit's face, computed from the object's
 * world matrix. Returns a fresh Vector3 so callers can safely retain it.
 */
export function getHitWorldNormal(
	hit: THREE.Intersection<THREE.Object3D>
): THREE.Vector3 | null {
	if (!hit.face) return null;
	_hitNormalMatrix.getNormalMatrix(hit.object.matrixWorld);
	_hitNormal.copy(hit.face.normal).applyNormalMatrix(_hitNormalMatrix);
	return _hitNormal.clone().normalize();
}

/**
 * Returns the closest intersection that has a face. Unlike the previous
 * top-only filter, this respects walls: a side-face hit no longer falls
 * through to whatever top face is behind it. Boundary disambiguation is
 * handled in worldPointToVoxelTile via the face normal.
 */
export function findFirstTerrainHit(
	hits: THREE.Intersection<THREE.Object3D>[]
): THREE.Intersection<THREE.Object3D> | null {
	for (const hit of hits) {
		if (hit.face) return hit;
	}
	return null;
}

/**
 * Terrain picking only needs the nearest face. `three-mesh-bvh` can answer
 * that directly when firstHitOnly is set, avoiding a full sorted hit list.
 */
export function intersectFirstTerrainHit(
	raycaster: THREE.Raycaster,
	targets: THREE.Object3D[]
): THREE.Intersection<THREE.Object3D> | null {
	const previousFirstHitOnly = raycaster.firstHitOnly;
	raycaster.firstHitOnly = true;
	try {
		return findFirstTerrainHit(raycaster.intersectObjects(targets, true));
	} finally {
		raycaster.firstHitOnly = previousFirstHitOnly;
	}
}
