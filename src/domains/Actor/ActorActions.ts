import { CampaignActions } from "../Campaign/CampaignActions";
import { Context } from "../Context/Context";
import { LogActions } from "../Log/LogActions";
import { VoxelTerrainActions } from "../VoxelTerrain/VoxelTerrainActions";
import { getVoxelTerrainById } from "../../utils/terrain/data/VoxelTerrainUtils";
import { Actor, Position } from "./Actor";

function isValidPosition(position: Position): boolean {
	return (
		Number.isFinite(position.x) &&
		Number.isFinite(position.y) &&
		Number.isFinite(position.h)
	);
}

/**
 * Shared actor logic for both Characters and Entities
 * Domain-specific spawn/remove logic belongs in CharacterActions/EntityActions
 */
export const ActorActions = {
	isValidPosition,

	/**
	 * Moves an actor to a new position (works for both Characters and Entities)
	 */
	moveActor(
		type: "character" | "entity",
		params: { actorId: string; position: Position },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		const actors =
			type === "character"
				? campaign.GameState.Characters
				: campaign.GameState.Entities;

		const actor = actors.find((a) => a.Id === params.actorId);
		if (!actor) {
			console.warn(`${type} not found in GameState: ${params.actorId}`);
			return;
		}

		if (!isValidPosition(params.position)) {
			console.warn(`Invalid ${type} move position: ${params.actorId}`);
			return;
		}

		// Per-move terrain validation is intentionally NOT run here. The client UI
		// derives legal positions from the shared voxel movement model, so the DM
		// trusts the requested position rather than snapping/rejecting it against
		// terrain -- that re-validation was the source of the jarring rubber-band
		// when a player moved onto a visually-valid tile. Gameplay range limits
		// are intentionally UI-only. Terrain validity is reconciled by
		// VoxelTerrainActions.repairActors on terrain changes, CanFly toggles,
		// scenario loads, and similar layout-changing actions.
		const oldPosition = { ...actor.Position };
		const nextPosition = {
			terrainId: params.position.terrainId ?? actor.Position.terrainId,
			x: Math.round(params.position.x),
			y: Math.round(params.position.y),
			h: Math.round(params.position.h),
		};
		actor.Position = nextPosition;

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
		const campaign = CampaignActions.getActiveCampaign(context);

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
			VoxelTerrainActions.repairActors(context);
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
		const campaign = CampaignActions.getActiveCampaign(context);
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
		const campaign = CampaignActions.getActiveCampaign(context);
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
	/**
	 * Transfers a stat amount from an actor to another actor or shared inventory
	 */
	transferStat(
		params: {
			sourceActorId: string;
			sourceStatId: string;
			targetId: string;
			targetStatId: string;
			amount: number;
		},
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		// Look up stat name from campaign templates
		const statTemplate = campaign.Settings.StatDefinitions.find(
			(d) => d.Id === params.sourceStatId
		);
		const statName = statTemplate?.Name ?? params.sourceStatId;

		// Resolve source
		const allActors = [
			...campaign.GameState.Characters,
			...campaign.GameState.Entities,
		];
		const sourceActor = allActors.find((a) => a.Id === params.sourceActorId);
		if (!sourceActor) return;

		const sourceStat = sourceActor.Stats.find((s) => s.Id === params.sourceStatId);
		if (!sourceStat) return;
		// Refuse transfers from unset stats — the actor doesn't have this stat.
		if (sourceStat.Current === null) return;

		// Ensure source has enough points
		const availableAmount = Math.min(sourceStat.Current, params.amount);
		if (availableAmount <= 0) return;

		// Resolve target
		const targetActor = allActors.find((a) => a.Id === params.targetId);
		const targetSharedInv = campaign.Settings.SharedInventories?.find(
			(i) => i.Id === params.targetId
		);

		let targetName = "Unknown";
		let transferSuccess = false;

		if (targetActor) {
			targetName = targetActor.Name;
			const tStat = targetActor.Stats.find((s) => s.Id === params.targetStatId);
			// Refuse transfers into unset stats — target doesn't have this stat.
			if (tStat && tStat.Current !== null) {
				tStat.Current = Math.min(tStat.Max, tStat.Current + availableAmount);
				transferSuccess = true;
			}
		} else if (targetSharedInv) {
			targetName = targetSharedInv.Name;
			const tStat = targetSharedInv.Stats.find((s) => s.Id === params.targetStatId);
			if (tStat && tStat.Current !== null) {
				tStat.Current = Math.min(tStat.Max, tStat.Current + availableAmount);
				transferSuccess = true;
			}
		}

		if (transferSuccess) {
			// Deduct from source (sourceStat.Current guaranteed non-null above)
			sourceStat.Current = Math.max(0, sourceStat.Current - availableAmount);

			LogActions.create(
				{
					action: "Stat Transferred",
					details: `${availableAmount} ${statName} was transferred from ${sourceActor.Name} to ${targetName}.`,
					category: "character",
					level: "info",
					visibility: ["all"],
					actorId: params.sourceActorId,
				},
				context
			);
		}
	},
};
