import { CampaignUtils } from "../Campaign/CampaignUtils";
import { Context } from "../Context/Context";
import { LogActions } from "../Log/LogActions";
import { VoxelTerrainUtils } from "../VoxelTerrain/VoxelTerrainUtils";
import { getVoxelTerrainById } from "../../utils/terrain/data/VoxelTerrainUtils";
import { Actor, Position, StatSlot, ActionSlot, AttributeSlot } from "./Actor";
import type {
	StatDefinition,
	ActionDefinition,
	AttributeDefinition,
} from "../CampaignSetting/CampaignSetting";
import type {
	ActionCost,
	CampaignSettings,
	StatCost,
} from "../CampaignSetting/CampaignSetting";

export const ActorUtils = {
	isValidPosition(position: Position): boolean {
		return (
			Number.isFinite(position.x) &&
			Number.isFinite(position.y) &&
			Number.isFinite(position.h)
		);
	},

	/**
	 * Moves an actor to a new position (works for both Characters and Entities)
	 */
	moveActor(
		type: "character" | "entity",
		params: { actorId: string; position: Position },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);
		const actors =
			type === "character"
				? campaign.GameState.Characters
				: campaign.GameState.Entities;

		const actor = actors.find((a) => a.Id === params.actorId);
		if (!actor) {
			console.warn(`${type} not found in GameState: ${params.actorId}`);
			return;
		}

		if (!ActorUtils.isValidPosition(params.position)) {
			console.warn(`Invalid ${type} move position: ${params.actorId}`);
			return;
		}

		// Per-move terrain validation is intentionally NOT run here. The client UI
		// derives legal positions from the shared voxel movement model, so the DM
		// trusts the requested position rather than snapping/rejecting it against
		// terrain -- that re-validation was the source of the jarring rubber-band
		// when a player moved onto a visually-valid tile. Gameplay range limits
		// are intentionally UI-only. Terrain validity is reconciled by
		// VoxelTerrainUtils.repairActors on terrain changes, CanFly toggles,
		// scenario loads, and similar layout-changing actions.
		const oldPosition = { ...actor.Position };
		const nextPosition = {
			terrainId: params.position.terrainId ?? actor.Position.terrainId,
			x: Math.round(params.position.x),
			y: Math.round(params.position.y),
			h: Math.round(params.position.h),
		};
		actor.Position = nextPosition;

		// A move that crosses terrains (e.g. traversing a terrain link) re-anchors
		// the combat movement budget to the destination, so remaining-range pathing
		// runs within the new terrain rather than pointing back into the old one.
		// Ordinary intra-terrain moves leave TurnStartPosition untouched, exactly as
		// before.
		if (
			nextPosition.terrainId !== oldPosition.terrainId &&
			campaign.GameState.CombatState?.isActive &&
			actor.TurnStartPosition
		) {
			actor.TurnStartPosition = { ...nextPosition };
		}

		LogActions.create(
			{
				action: `${type} moved`,
				details: `${actor.Name} moved from (${oldPosition.x}, ${oldPosition.y}, h=${oldPosition.h}) to (${nextPosition.x}, ${nextPosition.y}, h=${nextPosition.h})`,
				category: "movement",
				level: "verbose",
				visibility: ["all"],
				actorId: params.actorId,
			},
			context
		);

	},

	/**
	 * Edits an actor's properties (works for both Characters and Entities)
	 * Searches in Roster/Templates first, then GameState
	 * Characters can only be in one location (Roster OR GameState)
	 * Entities can exist in both (template + instances with different IDs)
	 */
	editActor(
		type: "character" | "entity",
		params: { actorId: string; updates: Partial<Actor> },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		// Get the appropriate storage locations
		const roster =
			type === "character"
				? campaign.CharacterRoster
				: campaign.EntityTemplates;
		const gameState =
			type === "character"
				? campaign.GameState.Characters
				: campaign.GameState.Entities;

		// Try to find in roster/templates first, then in gamestate
		let actor = roster.find((a) => a.Id === params.actorId);
		let isSpawnedActor = false;
		if (!actor) {
			actor = gameState.find((a) => a.Id === params.actorId);
			isSpawnedActor = !!actor;
		}

		if (!actor) {
			console.warn(`${type} not found: ${params.actorId}`);
			return;
		}

		const previousCanFly = actor.CanFly;

		Object.assign(actor, params.updates);

		if (
			isSpawnedActor &&
			"CanFly" in params.updates &&
			previousCanFly &&
			!actor.CanFly &&
			getVoxelTerrainById(campaign, actor.Position.terrainId)
		) {
			VoxelTerrainUtils.repairActors(context);
		}

		LogActions.create(
			{
				action: `${type} edited`,
				details: `${actor.Name} was updated`,
				category: "character",
				level: "info",
				visibility: ["dm"],
				actorId: params.actorId,
			},
			context
		);
	},

	/**
	 * Deletes an actor from the roster/templates (NOT from GameState)
	 * To remove from GameState, use domain-specific remove actions
	 */
	deleteActor(
		type: "character" | "entity",
		params: { actorId: string },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);
		const roster =
			type === "character"
				? campaign.CharacterRoster
				: campaign.EntityTemplates;

		const index = roster.findIndex((a) => a.Id === params.actorId);
		if (index === -1) {
			console.warn(
				`${type} not found in ${type === "character" ? "roster" : "templates"
				}: ${params.actorId}`
			);
			return;
		}

		const actor = roster[index];
		roster.splice(index, 1);

		LogActions.create(
			{
				action: `${type} deleted`,
				details: `${actor.Name} removed from ${type === "character" ? "roster" : "catalog"
					}`,
				category: "character",
				level: "important",
				visibility: ["dm"],
				actorId: params.actorId,
			},
			context
		);
	},
	/**
	 * Bulk edit tags for multiple actors in roster/templates
	 * Works for both Characters and Entities
	 */
	bulkEditTags(
		type: "character" | "entity",
		params: { updates: Array<{ actorId: string; tags: string[] }> },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);
		const roster =
			type === "character"
				? campaign.CharacterRoster
				: campaign.EntityTemplates;

		let successCount = 0;

		params.updates.forEach((update) => {
			const actor = roster.find((a) => a.Id === update.actorId);
			if (actor) {
				actor.Tags = update.tags;
				successCount++;
			} else {
				console.warn(
					`${type} not found for bulk update: ${update.actorId}`
				);
			}
		});

		LogActions.create(
			{
				action: "Actors organized",
				details: `Updated tags for ${successCount} actor(s)`,
				category: type === "character" ? "character" : "combat",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},
};

// ---- Slot creation helpers ----

/**
 * Creates default StatSlots from campaign templates (for new actors).
 */
export function createDefaultStatSlots(templates: StatDefinition[]): StatSlot[] {
	return templates.map((t) => ({
		Id: t.Id,
		Current: t.Max,
		Max: t.Max,
	}));
}

/**
 * Creates default ActionSlots from campaign templates (for new actors).
 */
export function createDefaultActionSlots(templates: ActionDefinition[]): ActionSlot[] {
	return templates.map((t) => ({
		Id: t.Id,
		Max: t.Max,
		Current: t.Max,
	}));
}

/**
 * Creates default AttributeSlots from campaign templates (for new actors).
 */
export function createDefaultAttributeSlots(templates: AttributeDefinition[]): AttributeSlot[] {
	return templates.map((t) => ({
		Id: t.Id,
		Value: "",
	}));
}

/**
 * Gets all actors from campaign (both in GameState and collections)
 */
export function getAllActors(campaign: any): Actor[] {
	return [
		...campaign.GameState.Characters,
		...campaign.GameState.Entities,
		...campaign.CharacterRoster,
		...campaign.EntityTemplates,
	];
}

export function applyStatCost(
	actor: Pick<Actor, "Stats">,
	cost: StatCost | undefined,
	settings: CampaignSettings
): string {
	if (!cost) return "";

	const stat = actor.Stats?.find((s) => s.Id === cost.statId);
	if (!stat || stat.Current === null) return "";

	const currentValue = stat.Current;
	const newValue = Math.max(0, currentValue - cost.amount);
	stat.Current = newValue;

	const statDef = settings.StatDefinitions.find((s) => s.Id === stat.Id);
	const statName = statDef?.Name ?? stat.Id;

	return ` (-${Math.min(currentValue, cost.amount)} ${statName})`;
}

export function applyActionCost(
	actor: Pick<Actor, "Actions">,
	cost: ActionCost | undefined,
	settings: CampaignSettings
): string {
	if (!cost) return "";

	const action = actor.Actions?.find((a) => a.Id === cost.actionId);
	if (!action) return "";

	const currentValue = action.Current;
	const newValue = Math.max(0, currentValue - cost.amount);
	action.Current = newValue;

	const actionDef = settings.ActionDefinitions.find((a) => a.Id === action.Id);
	const actionName = actionDef?.Name ?? action.Id;

	return ` (-${Math.min(currentValue, cost.amount)} ${actionName})`;
}
