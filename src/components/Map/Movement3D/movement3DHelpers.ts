import * as THREE from "three";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import {
	type VoxelTerrainIndex,
	voxelCenterToWorld,
} from "../../../utils/terrain/data/VoxelTerrainIndex";
import { raycastVoxelIndex } from "../../../utils/terrain/raycast/VoxelRaycast";
import { ACTOR_TOKEN_OCCLUSION } from "../Actors3D/actorTokenConstants";
import type { ActorKind } from "../Actors3D/actorTokenTypes";
import {
	type HeroOcclusionUniforms,
	isHeroOccludedPoint,
} from "../Terrain/shaders/heroOcclusionShader";

/** A "treat this voxel as empty" predicate for see-through picking. */
export type VoxelSkipPredicate = (vx: number, vy: number, vz: number) => boolean;

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
	skipVoxel?: VoxelSkipPredicate,
): TerrainDDAHit | null {
	const hit = raycastVoxelIndex(ray, index, skipVoxel);
	if (!hit) return null;

	const { vx, vy, vz, nx, ny, nz } = hit;
	const res = index.resolution;
	const halfVoxel = 0.5 / res;

	// World-space center of the hit voxel (shared voxel->world transform).
	const center = voxelCenterToWorld(index, vx, vy, vz);

	// Face center: displace voxel center by half a voxel along the face normal.
	const point = new THREE.Vector3(
		center.x + nx * halfVoxel,
		center.y + ny * halfVoxel,
		center.z + nz * halfVoxel,
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

/**
 * Precise actor pick under an already-aimed raycaster: returns the nearest actor
 * pick mesh hit that isn't occluded by terrain (unless x-ray is on). This is the
 * precise branch of ThreeDActorLayer's findActorUnderPointer, shared so other
 * layers (targeting) can resolve "which actor was clicked" without the
 * descriptor-aware proximity fallback that only the actor layer can do.
 */
export function pickActorUnderPointer(
	raycaster: THREE.Raycaster,
	actorPickTargets: THREE.Object3D[],
	terrainIndex: VoxelTerrainIndex,
	options?: { ignoreOcclusion?: boolean; skipVoxel?: VoxelSkipPredicate },
): { actorId: string; kind: ActorKind } | null {
	const actorHits = raycaster.intersectObjects(actorPickTargets, true);
	if (actorHits.length === 0) return null;

	// See-through picking: the occlusion test skips the hero-occlusion keyhole
	// voxels, so an actor revealed through the cutout is not culled as occluded.
	const occlusionHit = options?.ignoreOcclusion
		? null
		: raycastTerrainDDA(raycaster.ray, terrainIndex, options?.skipVoxel);

	for (const hit of actorHits) {
		if (
			occlusionHit &&
			occlusionHit.distance < hit.distance - ACTOR_TOKEN_OCCLUSION.EPSILON
		) {
			continue;
		}
		const { actorId, kind } = (hit.object.userData ?? {}) as {
			actorId?: string;
			kind?: ActorKind;
		};
		if (actorId && kind) return { actorId, kind };
	}
	return null;
}

/**
 * Build a see-through voxel-skip predicate from the live hero-occlusion uniforms,
 * for gameplay pointer picking (tile + actor). The returned predicate reports true
 * for voxels the terrain shader is currently discarding, so a DDA raycast passes
 * through the same keyhole the player sees.
 *
 * Returns `undefined` when the cutout is disabled (feature off / no focused actor
 * / first-person), so callers fall through to normal opaque picking. The live
 * uniform scalars are snapshotted once here so a single pick uses one consistent
 * frame; the predicate itself allocates nothing per voxel.
 */
export function makeHeroOcclusionVoxelSkip(
	index: VoxelTerrainIndex,
	hero: HeroOcclusionUniforms,
): VoxelSkipPredicate | undefined {
	if (hero.enabled.value !== 1) return undefined;
	const params = {
		camX: hero.camPos.value.x,
		camY: hero.camPos.value.y,
		camZ: hero.camPos.value.z,
		actorX: hero.actorPos.value.x,
		actorY: hero.actorPos.value.y,
		actorZ: hero.actorPos.value.z,
		radius: hero.radius.value,
		coneScale: hero.coneScale.value,
		cutY: hero.cutY.value,
		cutSign: hero.cutSign.value,
	};
	return (vx, vy, vz) => {
		const c = voxelCenterToWorld(index, vx, vy, vz);
		return isHeroOccludedPoint(c.x, c.y, c.z, params);
	};
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
