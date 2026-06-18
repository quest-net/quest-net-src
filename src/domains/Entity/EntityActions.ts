// domains/Entity/EntityActions.ts

import { Context } from "../Context/Context";
import { Entity } from "./Entity";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { LogActions } from "../Log/LogActions";
import { ACTOR_DEFAULT_COLORS, Position } from "../Actor/Actor";
import { getVoxelSpawnPosition, getVoxelTerrainById } from "../VoxelTerrain/VoxelTerrainQueries";
import { VoxelTerrainUtils } from "../VoxelTerrain/VoxelTerrainUtils";
import { EntityUtils } from "./EntityUtils";
import { toPlain } from "../../utils/toPlain";

/**
 * Entity action handlers
 * Entities are templates that can be spawned multiple times as independent instances
 * Unlike Characters, Entities are CLONED when spawned (template stays in EntityTemplates)
 */
export const EntityActions = {
	/**
	 * Creates a new entity template and adds to EntityTemplates
	 */
	create(params: { entity: Entity }, context: Context): void {
		const campaign = CampaignUtils.getActiveCampaign(context);


		// Ensure stats are fully healed upon creation
		// This fixes a bug where editing Max HP during creation didn't update Current HP
		const entity: Entity = {
			...params.entity,
			Color: params.entity.Color ?? ACTOR_DEFAULT_COLORS.ENTITY,
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
	 * Spawns an entity from template onto the field (CLONE operation)
	 * Creates a new instance with a new ID, leaving template intact
	 * Automatically handles naming for multiple instances
	 * Position defaults to origin if not provided
	 * DM only - handled by ACTION_REGISTRY
	 */
	spawn(
		params: {
			entityId: string;
			terrainId?: string;
			position?: Position;
			repairActors?: boolean;
			// Optional: force the new instance's Id instead of generating one.
			// Used by scenario load to preserve identity so re-loading the same
			// scenario does not duplicate the entity.
			instanceId?: string;
		},
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		// Prefer an explicit position's terrain, then a caller terrain, then the
		// first terrain in the list as the default landing.
		const targetTerrainId =
			params.position?.terrainId ??
			params.terrainId ??
			campaign.VoxelTerrains[0]?.Id ??
			"";

		// Find the template
		const template = campaign.EntityTemplates.find(
			(e) => e.Id === params.entityId
		);
		if (!template) {
			console.warn(`Entity template not found: ${params.entityId}`);
			return;
		}

		// Get the base name from template
		const baseName = EntityUtils.getBaseName(template.Name);

		// Find all existing entities that match this base name
		const matchingEntities = campaign.GameState.Entities.filter((e) => {
			return EntityUtils.getBaseName(e.Name) === baseName;
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
				entity.Name = `${baseName} [${EntityUtils.getLetterSuffix(index)}]`;
			});
		}

		// CLONE: Create new instance with new ID. toPlain unwraps the Valtio proxy
		// (structuredClone throws on proxies); structuredClone then gives a fully
		// independent, mutable deep copy isolated from the template.
		const instance: Entity = {
			...structuredClone(toPlain(template)),
			Id: params.instanceId ?? crypto.randomUUID(), // New ID for the instance
			Color: template.Color ?? ACTOR_DEFAULT_COLORS.ENTITY,
		};
		const voxelSpawnPosition = getVoxelSpawnPosition(
			campaign,
			targetTerrainId,
			instance.CanFly
		);

		// Set the name with appropriate letter suffix
		if (existingCount === 0) {
			// First instance keeps the original name
			instance.Name = baseName;
		} else {
			// Add letter suffix for new instance
			instance.Name = `${baseName} [${EntityUtils.getLetterSuffix(existingCount)}]`;
		}

		// Set position from the target voxel terrain if not provided.
		if (params.position) {
			instance.Position = params.position;
		} else {
			instance.Position = voxelSpawnPosition ?? {
				terrainId: targetTerrainId,
				x: 0,
				y: 0,
				h: 0,
			};
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

		if (
			params.repairActors !== false &&
			getVoxelTerrainById(campaign, targetTerrainId)
		) {
			VoxelTerrainUtils.repairActors(context);
		}
	},

	/**
	 * Removes an entity instance from the field (DELETE operation)
	 * Unlike characters, entities are just deleted, not moved back to templates
	 * DM only - handled by ACTION_REGISTRY
	 */
	remove(params: { entityId: string }, context: Context): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

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

};
