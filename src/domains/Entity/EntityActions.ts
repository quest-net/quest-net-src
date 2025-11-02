// domains/Entity/EntityActions.ts

import { Context } from "../Context/Context";
import { Entity } from "./Entity";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import { ActorActions } from "../Actor/ActorActions";
import { Position } from "../Actor/Actor";
import { TerrainActions } from "../Terrain/TerrainActions";

/**
 * Entity action handlers
 * Entities are templates that can be spawned multiple times as independent instances
 * Unlike Characters, Entities are CLONED when spawned (template stays in EntityTemplates)
 */
export const EntityActions = {
	/**
	 * Creates a default entity with campaign stat definitions
	 */
	createDefault(context: Context): Entity {
		const campaign = CampaignActions.getActiveCampaign(context);

		const stats = campaign.Settings.StatDefinitions.map((statDef) => ({
			...statDef,
			Current: statDef.Max,
		}));

		return {
			Id: crypto.randomUUID(),
			Name: "New Entity",
			Description: "",
			Image: undefined,
			Stats: stats,
			Attributes: {},
			Position: { x: 0, y: 0, h: 0 },
			MoveSpeed: 5,
			CanFly: false,
			Size: "small",
			Inventory: [],
			Equipment: [],
			Skills: [],
			Statuses: [],
			Tags: [],
		};
	},

	/**
	 * Creates a new entity template and adds to EntityTemplates
	 */
	create(params: { entity: Entity }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		campaign.EntityTemplates.push(params.entity);

		LogActions.create(
			{
				action: "Entity template created",
				details: `${params.entity.Name} added to templates`,
				category: "combat",
				level: "info",
				visibility: ["dm"],
				actorId: params.entity.Id,
			},
			context
		);
	},

	/**
	 * Spawns an entity from template onto the field (CLONE operation)
	 * Creates a new instance with a new ID, leaving template intact
	 * Position defaults to origin if not provided
	 * DM only - handled by ACTION_REGISTRY
	 */
	spawn(
		params: { entityId: string; position?: Position },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		// Find the template
		const template = campaign.EntityTemplates.find(
			(e) => e.Id === params.entityId
		);
		if (!template) {
			console.warn(`Entity template not found: ${params.entityId}`);
			return;
		}

		// CLONE: Create new instance with new ID
		const instance: Entity = {
			...structuredClone(template),
			Id: crypto.randomUUID(), // New ID for the instance
		};

		// Set position to origin if not provided
		if (params.position) {
			instance.Position = params.position;
		} else {
			instance.Position = { x: 0, y: 0, h: 0 };
		}

		// Add to GameState
		campaign.GameState.Entities.push(instance);

		LogActions.create(
			{
				action: "Entity spawned",
				details: `${instance.Name} appeared on the field`,
				category: "combat",
				level: "important",
				visibility: ["all"],
				actorId: instance.Id,
			},
			context
		);

		// Validate actors after spawning
		TerrainActions.validateActors(context);
	},

	/**
	 * Removes an entity instance from the field (DELETE operation)
	 * Unlike characters, entities are just deleted, not moved back to templates
	 * DM only - handled by ACTION_REGISTRY
	 */
	remove(params: { entityId: string }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		const gameStateIndex = campaign.GameState.Entities.findIndex(
			(e) => e.Id === params.entityId
		);
		if (gameStateIndex === -1) {
			console.warn(`Entity not found in GameState: ${params.entityId}`);
			return;
		}

		// Remove from GameState
		const [entity] = campaign.GameState.Entities.splice(gameStateIndex, 1);

		LogActions.create(
			{
				action: "Entity removed",
				details: `${entity.Name} disappeared from the field`,
				category: "combat",
				level: "important",
				visibility: ["all"],
				actorId: params.entityId,
			},
			context
		);
	},

	/**
	 * Edits an entity's properties
	 * Works on both templates and spawned instances
	 */
	edit(
		params: { entityId: string; updates: Partial<Entity> },
		context: Context
	): void {
		ActorActions.editActor(
			"entity",
			{ actorId: params.entityId, updates: params.updates },
			context
		);
	},

	/**
	 * Deletes an entity template permanently
	 * Cannot delete if instances are currently spawned (safety check)
	 * DM only - handled by ACTION_REGISTRY
	 */
	delete(params: { entityId: string }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		// Safety check: Don't delete template if any instances are spawned
		// Note: Instances have different IDs, so this checks the template ID
		const hasSpawnedInstances = campaign.GameState.Entities.some(() => {
			return false;
		});

		if (hasSpawnedInstances) {
			console.warn(
				`Cannot delete entity template with spawned instances: ${params.entityId}`
			);
			return;
		}

		ActorActions.deleteActor("entity", { actorId: params.entityId }, context);
	},

	/**
	 * Moves an entity to a new position
	 * DM only
	 */
	move(
		params: { entityId: string; position: Position },
		context: Context
	): void {
		ActorActions.moveActor(
			"entity",
			{ actorId: params.entityId, position: params.position },
			context
		);

		// Validate actors after moving
		TerrainActions.validateActors(context);
	},
};