import type { MovementSettings } from "../../../domains/CampaignSetting/CampaignSetting";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { calculateVoxelMovementRange } from "../../../domains/VoxelTerrain/VoxelMovementUtilities";
import { ACTOR_TOKEN_DESCRIPTOR_DEFAULTS } from "../Actors3D/actorTokenConstants";
import type { FirstPersonActor } from "./types";

// Extra cost units the FP lookup explores past the move budget purely so the
// combat overage readout ("+N") has a little headroom before it flips to the
// symbolic "+ a lot". A small fixed margin (a couple of unit steps) -- NOT a
// function of terrain height. The previous implementation used
// `2 * max(heightCostLookup)`, i.e. twice the cost of climbing the tallest
// possible height, which on a deep terrain ballooned to dozens of cost units.
// That flooded the Dijkstra frontier (and the lazily-built adjacency it
// touches) far past the move budget -- the source of the "(+32)" readout and
// the first-FP-entry stutter -- and made flyers (capped at moveSpeed) and
// non-flyers (capped much higher) explore wildly different amounts of the same
// terrain for no reason.
const OVERAGE_READOUT_MARGIN = 4;

function getMovementLookupBudget(moveSpeed: number): number {
	// The FP HUD only reads the movement cost at the actor's *current* tile:
	// remaining movement (moveSpeed - cost) plus a small overage readout in
	// combat, and the ~1-tile distance from the committed anchor in
	// exploration. It never reads costs far from the actor, so the lookup only
	// needs to cover moveSpeed (every in-budget tile) plus a small fixed margin
	// for the overage readout. Flyers and non-flyers get the same bound, so they
	// explore the same region of terrain. Beyond the margin the HUD shows
	// "+ a lot" instead of an exact overage.
	return moveSpeed + OVERAGE_READOUT_MARGIN;
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
	const lookupBudget = getMovementLookupBudget(moveSpeed);
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
