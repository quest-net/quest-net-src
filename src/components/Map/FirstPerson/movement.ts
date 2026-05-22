import type { MovementSettings } from "../../../domains/CampaignSetting/CampaignSetting";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { calculateVoxelMovementRange } from "../../../utils/terrain/movement/VoxelMovementUtilities";
import { ACTOR_TOKEN_DESCRIPTOR_DEFAULTS } from "../Actors3D/actorTokenConstants";
import type { FirstPersonActor } from "./types";

function getMovementLookupBudget(
	terrain: VoxelTerrain,
	moveSpeed: number,
	canFly: boolean,
	movementSettings: MovementSettings
): number {
	const maxHorizontal =
		Math.max(0, terrain.Width - 1) + Math.max(0, terrain.Length - 1);
	const maxVertical = Math.max(0, terrain.Height);

	if (canFly && movementSettings.flyingIgnoresHeight) {
		return Math.max(moveSpeed, maxHorizontal + maxVertical);
	}

	const maxHeightCost = movementSettings.heightCostLookup.reduce(
		(max, cost) => Math.max(max, cost),
		0
	);
	return Math.max(moveSpeed, maxHorizontal * (1 + maxHeightCost));
}

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
	const lookupBudget = getMovementLookupBudget(
		terrain,
		moveSpeed,
		canFly,
		movementSettings
	);
	return calculateVoxelMovementRange(
		terrain,
		anchor,
		lookupBudget,
		canFly,
		movementSettings
	).costs;
}

export function formatMovementValue(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
