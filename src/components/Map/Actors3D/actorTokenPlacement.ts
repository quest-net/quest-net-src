import * as THREE from "three";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { getVoxelRulesSurfaceHeight } from "../../../utils/VoxelTerrainUtils";
import { getVoxelTerrainIndex } from "../../../utils/VoxelTerrainIndex";
import {
	ACTOR_TOKEN_BASE,
	ACTOR_TOKEN_PLACEMENT,
} from "./actorTokenConstants";
import type { ActorTokenDescriptor } from "./actorTokenTypes";

export function getActorSupportHeight(actor: ActorTokenDescriptor, terrain: VoxelTerrain): number {
	const h = actor.position.h ?? 0;
	const index = getVoxelTerrainIndex(terrain);
	const key = `${actor.position.x},${actor.position.y}`;
	const surfaces = index.allSurfaces.get(key) ?? [];
	const exactSurfaces = index.allSurfaceHeights.get(key) ?? [];

	let exactHeightAtRulesHeight: number | undefined;
	for (const surfaceHeight of exactSurfaces) {
		if (Math.floor(surfaceHeight) === h) {
			exactHeightAtRulesHeight = surfaceHeight;
		}
	}
	if (exactHeightAtRulesHeight !== undefined) {
		return exactHeightAtRulesHeight;
	}

	if (surfaces.length === 0) {
		return getVoxelRulesSurfaceHeight(terrain, actor.position.x, actor.position.y);
	}

	let supportHeight: number | null = null;
	for (const surface of surfaces) {
		if (surface > h) break;
		supportHeight = surface;
	}
	return supportHeight ?? h;
}

export function getActorBaseHeight(actor: ActorTokenDescriptor, terrain: VoxelTerrain): number {
	const h = Number(actor.position.h);
	const supportHeight = getActorSupportHeight(actor, terrain);
	return Number.isFinite(h) ? Math.max(h, supportHeight) : supportHeight;
}

export function getActorElevationDelta(actor: ActorTokenDescriptor, terrain: VoxelTerrain): number {
	const surfaceHeight = getActorSupportHeight(actor, terrain);
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
