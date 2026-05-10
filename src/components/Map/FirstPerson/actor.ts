import * as THREE from "three";
import type { Position } from "../../../domains/Actor/Actor";
import type { Character } from "../../../domains/Character/Character";
import type { Entity } from "../../../domains/Entity/Entity";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { getActorGroundPosition } from "../Actors3D/actorTokenPlacement";
import { ACTOR_TOKEN_DESCRIPTOR_DEFAULTS } from "../Actors3D/actorTokenConstants";
import type { ActorTokenDescriptor } from "../Actors3D/actorTokenTypes";
import { FIRST_PERSON_CAMERA } from "./constants";
import type { FirstPersonActor } from "./types";

export type FirstPersonRole = "dm" | "player";

export function findFirstPersonActor(
	role: FirstPersonRole,
	roomCode: string,
	selectedCharacters: Record<string, string>,
	impersonatedActors: Record<string, string> | undefined,
	characters: Character[],
	entities: Entity[]
): FirstPersonActor | null {
	const actorId =
		role === "player"
			? selectedCharacters[roomCode]
			: impersonatedActors?.[roomCode];
	if (!actorId) return null;

	const character = characters.find((candidate) => candidate.Id === actorId);
	if (character) {
		return { id: actorId, kind: "character", actor: character };
	}

	const entity = entities.find((candidate) => candidate.Id === actorId);
	if (entity) {
		return { id: actorId, kind: "entity", actor: entity };
	}

	return null;
}

function actorPositionToGroundWorld(
	actor: FirstPersonActor,
	terrain: VoxelTerrain,
	position: Position
): THREE.Vector3 {
	return getActorGroundPosition(createActorDescriptor(actor, position), terrain);
}

export function actorToGroundWorld(
	actor: FirstPersonActor,
	terrain: VoxelTerrain
): THREE.Vector3 {
	return actorPositionToGroundWorld(actor, terrain, actor.actor.Position);
}

export function getEyeHeight(actor: Character | Entity): number {
	const size = actor.Size ?? ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.SIZE;
	return FIRST_PERSON_CAMERA.HEIGHT_BY_SIZE[size];
}

function createActorDescriptor(
	actor: FirstPersonActor,
	position: Position
): ActorTokenDescriptor {
	return {
		id: actor.id,
		kind: actor.kind,
		name: actor.actor.Name,
		imageId: actor.actor.Image,
		position,
		moveSpeed: actor.actor.MoveSpeed ?? ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.MOVE_SPEED,
		size: actor.actor.Size ?? ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.SIZE,
		cutout: false,
		canFly: actor.actor.CanFly ?? false,
	};
}
