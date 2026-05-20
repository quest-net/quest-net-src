import type { MovementSettings } from "../../../domains/CampaignSetting/CampaignSetting";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { calculateVoxelMovementRange } from "../../../utils/terrain/movement/VoxelMovementUtilities";
import { ACTOR_TOKEN_DESCRIPTOR_DEFAULTS } from "../Actors3D/actorTokenConstants";
import type { FirstPersonActor } from "./types";

export function createMovementCostLookup(
	terrain: VoxelTerrain,
	actor: FirstPersonActor,
	isCombatActive: boolean,
	movementSettings: MovementSettings
): Map<string, number> {
	const moveSpeed =
		actor.actor.MoveSpeed ?? ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.MOVE_SPEED;
	const canFly = actor.actor.CanFly ?? false;
	const anchor =
		isCombatActive && actor.actor.TurnStartPosition
			? actor.actor.TurnStartPosition
			: actor.actor.Position;
	return calculateVoxelMovementRange(
		terrain,
		anchor,
		moveSpeed,
		canFly,
		movementSettings
	).costs;
}

export function formatMovementValue(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
