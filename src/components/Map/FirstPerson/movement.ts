import type { MovementSettings } from "../../../domains/CampaignSetting/CampaignSetting";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { calculateVoxelMovementRange } from "../../../utils/terrain/movement/VoxelMovementUtilities";
import { ACTOR_TOKEN_DESCRIPTOR_DEFAULTS } from "../Actors3D/actorTokenConstants";
import type { FirstPersonActor } from "./types";

function getMovementLookupBudget(
	moveSpeed: number,
	canFly: boolean,
	movementSettings: MovementSettings
): number {
	// Flying actors who ignore height pay only the lateral step cost (1 per
	// step), so a budget of moveSpeed already covers every tile they can reach.
	// Anything larger was just expanding the Dijkstra frontier with tiles the
	// actor can't actually move to.
	if (canFly && movementSettings.flyingIgnoresHeight) {
		return moveSpeed;
	}

	// The FP HUD only reads the movement cost at the actor's *current* tile:
	// remaining movement (moveSpeed - cost) plus a small overage readout in
	// combat, and the ~1-tile distance from the committed anchor in
	// exploration. It never reads costs far from the actor, so the lookup only
	// needs to cover the reachable region nearby -- not the whole map. Cap at
	// moveSpeed plus a two-step climb margin so the overage readout keeps a bit
	// of headroom; tiles beyond that are never displayed. This keeps the
	// Dijkstra frontier -- and the lazily-built adjacency it touches -- bounded
	// by move speed instead of map size, which is what made the first FP entry
	// on a fresh terrain stutter for ~1s while it flooded the entire map.
	const maxHeightCost = movementSettings.heightCostLookup.reduce(
		(max, cost) => Math.max(max, cost),
		0
	);
	return moveSpeed + 2 * maxHeightCost;
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
