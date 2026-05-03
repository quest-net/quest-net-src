import * as THREE from "three";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { getVoxelSurfaceHeight } from "../../../utils/VoxelTerrainUtils";
import {
	ACTOR_TOKEN_BASE,
	ACTOR_TOKEN_PLACEMENT,
} from "./actorTokenConstants";
import type { ActorTokenDescriptor } from "./actorTokenTypes";

export function getActorBaseHeight(actor: ActorTokenDescriptor, terrain: VoxelTerrain): number {
	const surfaceHeight = getVoxelSurfaceHeight(
		terrain,
		actor.position.x,
		actor.position.y
	);
	return Math.max(actor.position.h ?? 0, surfaceHeight);
}

export function getActorElevationDelta(actor: ActorTokenDescriptor, terrain: VoxelTerrain): number {
	const surfaceHeight = getVoxelSurfaceHeight(
		terrain,
		actor.position.x,
		actor.position.y
	);
	return getActorBaseHeight(actor, terrain) - surfaceHeight;
}

export function isActorAirborne(actor: ActorTokenDescriptor, terrain: VoxelTerrain): boolean {
	return getActorElevationDelta(actor, terrain) > ACTOR_TOKEN_PLACEMENT.AIRBORNE_THRESHOLD;
}

export function terrainHeightToWorldY(height: number): number {
	return height + ACTOR_TOKEN_PLACEMENT.TERRAIN_WORLD_Y_OFFSET;
}

export function getActorGroundPosition(
	actor: ActorTokenDescriptor,
	terrain: VoxelTerrain
): THREE.Vector3 {
	const offsetX = (terrain.Width - 1) / 2;
	const offsetZ = (terrain.Length - 1) / 2;
	const baseHeight = getActorBaseHeight(actor, terrain);

	return new THREE.Vector3(
		actor.position.x - offsetX,
		terrainHeightToWorldY(baseHeight) + ACTOR_TOKEN_PLACEMENT.BASE_Y_OFFSET,
		actor.position.y - offsetZ
	);
}

export function getStandeeBottomOffset(actor: ActorTokenDescriptor, airborne: boolean): number {
	if (airborne) {
		return ACTOR_TOKEN_PLACEMENT.AIRBORNE_HALO_HEIGHT +
			(actor.cutout
				? ACTOR_TOKEN_PLACEMENT.CUTOUT_AIRBORNE_STANDEE_HALO_GAP
				: ACTOR_TOKEN_PLACEMENT.AIRBORNE_STANDEE_HALO_GAP);
	}

	return ACTOR_TOKEN_BASE.HEIGHT +
		(actor.cutout
			? ACTOR_TOKEN_PLACEMENT.CUTOUT_STANDEE_BASE_GAP
			: ACTOR_TOKEN_PLACEMENT.STANDEE_BASE_GAP);
}
