import type { Character } from "../../../domains/Character/Character";
import type { Entity } from "../../../domains/Entity/Entity";
import { ACTOR_DEFAULT_COLORS } from "../../../domains/Actor/Actor";
import { ACTOR_TOKEN_DESCRIPTOR_DEFAULTS } from "./actorTokenConstants";
import type { ActorTokenDescriptor } from "./actorTokenTypes";

export function buildActorTokenDescriptors(
	characters: Character[],
	entities: Entity[],
	cutoutImageIds: ReadonlySet<string>
): ActorTokenDescriptor[] {
	const descriptors: ActorTokenDescriptor[] = [];

	const isCutout = (imageId?: string): boolean =>
		!!imageId && cutoutImageIds.has(imageId);

	for (const character of characters) {
		descriptors.push({
			id: character.Id,
			kind: "character",
			name: character.Name,
			imageId: character.Image,
			color: character.Color ?? ACTOR_DEFAULT_COLORS.CHARACTER,
			position: character.Position ?? { ...ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.POSITION },
			moveSpeed: character.MoveSpeed ?? ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.MOVE_SPEED,
			size: character.Size ?? ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.SIZE,
			cutout: isCutout(character.Image),
			canFly: character.CanFly ?? false,
		});
	}

	for (const entity of entities) {
		descriptors.push({
			id: entity.Id,
			kind: "entity",
			name: entity.Name,
			imageId: entity.Image,
			color: entity.Color ?? ACTOR_DEFAULT_COLORS.ENTITY,
			position: entity.Position ?? { ...ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.POSITION },
			moveSpeed: entity.MoveSpeed ?? ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.MOVE_SPEED,
			size: entity.Size ?? ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.SIZE,
			cutout: isCutout(entity.Image),
			canFly: entity.CanFly ?? false,
		});
	}

	return descriptors;
}
