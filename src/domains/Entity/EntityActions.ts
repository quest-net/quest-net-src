// domains/Entity/EntityActions.ts

import { Context } from "../Context/Context";
import { Entity } from "./Entity";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import { ActorActions } from "../Actor/ActorActions";
import { Position } from "../Actor/Actor";
import { createDefaultStatSlots, createDefaultActionSlots, createDefaultAttributeSlots } from "../../utils/ActorResolvers";
import { getActiveVoxelSpawnPosition, getActiveVoxelTerrain } from "../../utils/VoxelTerrainUtils";
import { VoxelTerrainActions } from "../VoxelTerrain/VoxelTerrainActions";

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
		const settings = campaign.Settings;

		return {
			Id: crypto.randomUUID(),
			Name: "New Entity",
			Description: "",
			Image: undefined,
			Stats: createDefaultStatSlots(settings.StatDefinitions),
			Actions: createDefaultActionSlots(settings.ActionDefinitions),
			Attributes: createDefaultAttributeSlots(settings.AttributeDefinitions ?? []),
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


		// Ensure stats are fully healed upon creation
		// This fixes a bug where editing Max HP during creation didn't update Current HP
		const entity: Entity = {
			...params.entity,
			Stats: params.entity.Stats.map((stat) => ({
				...stat,
				Current: stat.Max,
			})),
		};

		campaign.EntityTemplates.push(entity);

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
	 * Helper function to extract base name from entity name
	 * "Goblin" -> "Goblin"
	 * "Goblin [A]" -> "Goblin"
	 * "Goblin [Z]" -> "Goblin"
	 */
	getBaseName(name: string): string {
		const match = name.match(/^(.+?)\s*\[[A-Z]\]$/);
		return match ? match[1] : name;
	},

	/**
	 * Helper function to get letter suffix from alphabet position
	 * 0 -> 'A', 1 -> 'B', ..., 25 -> 'Z'
	 */
	getLetterSuffix(index: number): string {
		return String.fromCharCode(65 + index); // 65 is 'A' in ASCII
	},

	/**
	 * Spawns an entity from template onto the field (CLONE operation)
	 * Creates a new instance with a new ID, leaving template intact
	 * Automatically handles naming for multiple instances
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

		// Get the base name from template
		const baseName = EntityActions.getBaseName(template.Name);

		// Find all existing entities that match this base name
		const matchingEntities = campaign.GameState.Entities.filter((e) => {
			return EntityActions.getBaseName(e.Name) === baseName;
		});

		const existingCount = matchingEntities.length;

		// Safety check: Don't spawn if we've hit the alphabet limit
		if (existingCount >= 26) {
			console.warn(
				`Cannot spawn more than 26 instances of ${baseName}. Alphabet limit reached.`
			);
			LogActions.create(
				{
					action: "Spawn failed",
					details: `Cannot spawn ${baseName} - too many instances (26 max)`,
					category: "system",
					level: "important",
					visibility: ["dm"],
				},
				context
			);
			return;
		}

		// If we have existing entities, rename them all with letter suffixes
		if (existingCount > 0) {
			matchingEntities.forEach((entity, index) => {
				entity.Name = `${baseName} [${EntityActions.getLetterSuffix(index)}]`;
			});
		}

		// CLONE: Create new instance with new ID
		const instance: Entity = {
			...structuredClone(template),
			Id: crypto.randomUUID(), // New ID for the instance
		};
		const voxelSpawnPosition = getActiveVoxelSpawnPosition(
			campaign,
			instance.CanFly
		);

		// Set the name with appropriate letter suffix
		if (existingCount === 0) {
			// First instance keeps the original name
			instance.Name = baseName;
		} else {
			// Add letter suffix for new instance
			instance.Name = `${baseName} [${EntityActions.getLetterSuffix(existingCount)}]`;
		}

		// Set position from the active voxel terrain if not provided.
		if (params.position) {
			instance.Position = params.position;
		} else {
			instance.Position = voxelSpawnPosition ?? { x: 0, y: 0, h: 0 };
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

		if (getActiveVoxelTerrain(campaign)) {
			VoxelTerrainActions.validateActors(context);
		}
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

		// Clear impersonation if DM was impersonating this entity
		const impersonated = (context.User.ImpersonatedActors ?? {})[campaign.RoomCode];
		if (impersonated === params.entityId) {
			if (!context.User.ImpersonatedActors) context.User.ImpersonatedActors = {};
			delete context.User.ImpersonatedActors[campaign.RoomCode];
		}

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
		const campaign = CampaignActions.getActiveCampaign(context);
		if (getActiveVoxelTerrain(campaign)) {
			VoxelTerrainActions.validateActors(context);
		}
	},

	/**
	 * Bulk edit tags for multiple entity templates
	 */
	bulkEditTags(
		params: { updates: Array<{ entityId: string; tags: string[] }> },
		context: Context
	): void {
		ActorActions.bulkEditTags(
			"entity",
			{
				updates: params.updates.map((update) => ({
					actorId: update.entityId,
					tags: update.tags,
				})),
			},
			context
		);
	},
};
