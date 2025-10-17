import { CampaignActions } from "../Campaign/CampaignActions";
import { Character } from "../Character/Character";
import { Context } from "../Context/Context";
import { LogActions } from "../Log/LogActions";
import { Actor, Position } from "./Actor";

// ActorActions.ts
export const ActorActions = {
  spawnActor(
    type: 'character' | 'entity',
    params: { templateId: string; position?: Position },
    context: Context
  ): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    const templates = type === 'character' 
      ? campaign.CharacterTemplates 
      : campaign.EntityTemplates;
    
    const template = templates.find(t => t.Id === params.templateId);
    if (!template) return;
    
    const instance = {
      ...template,
      Id: crypto.randomUUID(),
      ...(params.position && { Position: params.position })
    };
    
    if (type === 'character') {
      campaign.GameState.Characters.push(instance as Character);
    } else {
      campaign.GameState.Entities.push(instance);
    }
    
    LogActions.create({
      action: `${type} spawned`,
      details: `${instance.Name} entered the field`,
      category: 'character',
      level: 'important',
      visibility: ['all'],
      targetId: instance.Id
    }, context);
  },

  moveActor(
    type: 'character' | 'entity',
    params: { actorId: string; position: Position },
    context: Context
  ): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    const actors = type === 'character' 
      ? campaign.GameState.Characters 
      : campaign.GameState.Entities;
    
    const actor = actors.find(a => a.Id === params.actorId);
    if (!actor) return;
    
    // Permission check for players moving characters
    if (context.User.Role === 'player' && type === 'character') {
      // Add ownership validation here when you implement it
      // For now, you might check Character.OwnerId === context.User.Id
    }
    
    const oldPosition = actor.Position;
    actor.Position = params.position;
    
    LogActions.create({
      action: `${type} moved`,
      details: oldPosition 
        ? `${actor.Name} moved from (${oldPosition.x}, ${oldPosition.y}) to (${params.position.x}, ${params.position.y})`
        : `${actor.Name} moved to (${params.position.x}, ${params.position.y})`,
      category: 'movement',
      level: 'verbose',
      visibility: ['all'],
      actorId: params.actorId
    }, context);
  },

  removeActor(
  type: 'character' | 'entity',
  params: { actorId: string },
  context: Context
): void {
  const campaign = CampaignActions.getActiveCampaign(context);
  const actors = type === 'character' 
    ? campaign.GameState.Characters 
    : campaign.GameState.Entities;
  
  const index = actors.findIndex(a => a.Id === params.actorId);
  if (index === -1) {
    console.warn(`${type} not found on field: ${params.actorId}`);
    return;
  }
  
  const actor = actors[index];
  actors.splice(index, 1);
  
  LogActions.create({
    action: `${type} removed`,
    details: `${actor.Name} left the field`,
    category: 'character',
    level: 'important',
    visibility: ['all'],
    actorId: params.actorId
  }, context);
},

editActor(
  type: 'character' | 'entity',
  params: { actorId: string; updates: Partial<Actor> },
  context: Context
): void {
  const campaign = CampaignActions.getActiveCampaign(context);
  
  // Check both templates and spawned actors
  const templates = type === 'character' 
    ? campaign.CharacterTemplates 
    : campaign.EntityTemplates;
  const spawned = type === 'character' 
    ? campaign.GameState.Characters 
    : campaign.GameState.Entities;
  
  let actor = templates.find(a => a.Id === params.actorId);
  if (!actor) {
    actor = spawned.find(a => a.Id === params.actorId);
  }
  
  if (!actor) {
    console.warn(`${type} not found: ${params.actorId}`);
    return;
  }
  
  Object.assign(actor, params.updates);
  
  LogActions.create({
    action: `${type} edited`,
    details: `${actor.Name} was updated`,
    category: 'character',
    level: 'info',
    visibility: ['dm'],
    actorId: params.actorId
  }, context);
},

deleteActor(
  type: 'character' | 'entity',
  params: { actorId: string },
  context: Context
): void {
  const campaign = CampaignActions.getActiveCampaign(context);
  const templates = type === 'character' 
    ? campaign.CharacterTemplates 
    : campaign.EntityTemplates;
  
  const index = templates.findIndex(a => a.Id === params.actorId);
  if (index === -1) {
    console.warn(`${type} template not found: ${params.actorId}`);
    return;
  }
  
  const actor = templates[index];
  templates.splice(index, 1);
  
  LogActions.create({
    action: `${type} deleted`,
    details: `${actor.Name} removed from catalog`,
    category: 'character',
    level: 'important',
    visibility: ['dm'],
    actorId: params.actorId
  }, context);
}
};