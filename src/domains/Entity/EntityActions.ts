// domains/Entity/EntityActions.ts

import { Context } from "../Context/Context";
import { Entity } from "./Entity";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import { ActorActions } from "../Actor/ActorActions";
import { Position } from "../Actor/Actor";

/**
 * Entity action handlers
 * Entities are DM-controlled actors (NPCs, monsters, objects, etc.)
 * All entity actions are DM-only, enforced by ACTION_REGISTRY
 */
export const EntityActions = {
  
  /**
   * Creates a new entity template in the catalog
   */
  create(params: { entity: Entity }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    campaign.EntityTemplates.push(params.entity);
    
    LogActions.create({
      action: 'Entity created',
      details: `${params.entity.Name} added to catalog`,
      category: 'character',
      level: 'info',
      visibility: ['dm'],
      actorId: params.entity.Id
    }, context);
  },

  /**
   * Spawns an entity from template onto the field
   */
  spawn(params: { templateId: string; position?: Position }, context: Context): void {
    ActorActions.spawnActor('entity', params, context);
  },

  /**
   * Removes an entity from the field
   */
  remove(params: { entityId: string }, context: Context): void {
    ActorActions.removeActor('entity', { actorId: params.entityId }, context);
  },

  /**
   * Edits an entity's properties
   */
  edit(params: { entityId: string; updates: Partial<Entity> }, context: Context): void {
    ActorActions.editActor('entity', { actorId: params.entityId, updates: params.updates }, context);
  },

  /**
   * Deletes an entity from the catalog
   */
  delete(params: { entityId: string }, context: Context): void {
    ActorActions.deleteActor('entity', { actorId: params.entityId }, context);
  },

  /**
   * Moves an entity to a new position
   */
  move(params: { entityId: string; position: Position }, context: Context): void {
    ActorActions.moveActor('entity', { actorId: params.entityId, position: params.position }, context);
  }
};