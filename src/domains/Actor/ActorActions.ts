import { CampaignActions } from "../Campaign/CampaignActions";
import { Context } from "../Context/Context";
import { LogActions } from "../Log/LogActions";
import { Actor, Position } from "./Actor";

/**
 * Shared actor logic for both Characters and Entities
 * Domain-specific spawn/remove logic belongs in CharacterActions/EntityActions
 */
export const ActorActions = {
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

		// Permission check for players moving characters
		if (context.User.Role === "player" && type === "character") {
			// Add ownership validation here when you implement it
			// For now, you might check Character.OwnerId === context.User.Id
		}

		const oldPosition = actor.Position;
		actor.Position = params.position;

		LogActions.create(
			{
				action: `${type} moved`,
				details: oldPosition
					? `${actor.Name} moved from (${oldPosition.x}, ${oldPosition.y}) to (${params.position.x}, ${params.position.y})`
					: `${actor.Name} moved to (${params.position.x}, ${params.position.y})`,
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
		if (!actor) {
			actor = gameState.find((a) => a.Id === params.actorId);
		}

		if (!actor) {
			console.warn(`${type} not found: ${params.actorId}`);
			return;
		}

		Object.assign(actor, params.updates);

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
				`${type} not found in ${
					type === "character" ? "roster" : "templates"
				}: ${params.actorId}`
			);
			return;
		}

		const actor = roster[index];
		roster.splice(index, 1);

		LogActions.create(
			{
				action: `${type} deleted`,
				details: `${actor.Name} removed from ${
					type === "character" ? "roster" : "catalog"
				}`,
				category: "character",
				level: "important",
				visibility: ["dm"],
				actorId: params.actorId,
			},
			context
		);
	},
};
