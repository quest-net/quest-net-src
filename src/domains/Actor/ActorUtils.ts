import { CampaignUtils } from "../Campaign/CampaignUtils";
import { Context } from "../Context/Context";
import { LogActions } from "../Log/LogActions";
import { VoxelTerrainUtils } from "../VoxelTerrain/VoxelTerrainUtils";
import { getVoxelTerrainById } from "../VoxelTerrain/VoxelTerrainQueries";
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
	 * Resolves whether an actor id belongs to a Character or an Entity by where it
	 * lives. Storage location is the single source of truth (there is no Kind field
	 * on the Actor model). IDs are unique GUIDs across every collection, so an
	 * entity instance and its template both independently resolve to "entity".
	 */
	getActorKind(
		context: Context,
		actorId: string
	): "character" | "entity" | undefined {
		const campaign = CampaignUtils.getActiveCampaign(context);
		if (
			campaign.GameState.Characters.some((a) => a.Id === actorId) ||
			campaign.CharacterRoster.some((a) => a.Id === actorId)
		) {
			return "character";
		}
		if (
			campaign.GameState.Entities.some((a) => a.Id === actorId) ||
			campaign.EntityTemplates.some((a) => a.Id === actorId)
		) {
			return "entity";
		}
		return undefined;
	},

	/**
	 * Moves an actor to a new position. Movement is identical for Characters and
	 * Entities, so this resolves the actor by id across both active collections —
	 * no kind needed. (Only spawned actors can move; the roster/templates are not
	 * searched.)
	 */
	moveActor(
		params: { actorId: string; position: Position },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);
		const actor =
			campaign.GameState.Characters.find((a) => a.Id === params.actorId) ??
			campaign.GameState.Entities.find((a) => a.Id === params.actorId);
		if (!actor) {
			console.warn(`Actor not found in GameState: ${params.actorId}`);
			return;
		}

		if (!ActorUtils.isValidPosition(params.position)) {
			console.warn(`Invalid actor move position: ${params.actorId}`);
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
				action: "Actor moved",
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
	 * Edits an actor's properties. Editing is identical for Characters and
	 * Entities, so this resolves the actor by id across every collection (roster,
	 * templates, and GameState) — no kind needed. IDs are unique, so a template
	 * and its spawned instances are distinct objects matched independently.
	 */
	editActor(
		params: { actorId: string; updates: Partial<Actor> },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		const actor = getAllActors(campaign).find((a) => a.Id === params.actorId);
		if (!actor) {
			console.warn(`Actor not found: ${params.actorId}`);
			return;
		}

		const isSpawnedActor =
			campaign.GameState.Characters.some((a) => a.Id === params.actorId) ||
			campaign.GameState.Entities.some((a) => a.Id === params.actorId);

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
				action: "Actor edited",
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
