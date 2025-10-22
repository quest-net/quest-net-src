// domains/Character/CharacterActions.ts

import { Context } from "../Context/Context";
import { Character } from "./Character";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import { ActorActions } from "../Actor/ActorActions";
import { Position } from "../Actor/Actor";

/**
 * Character action handlers
 * Characters are actors owned by players (tracked via playedBy field)
 */
export const CharacterActions = {
  
  /**
   * Creates a default character template with campaign stat definitions
   */
  createDefault(context: Context): Character {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    // Initialize stats from campaign settings with Current = Max
    const stats = campaign.Settings.StatDefinitions.map(statDef => ({
      ...statDef,
      Current: statDef.Max
    }));
    
    return {
      Id: crypto.randomUUID(),
      Name: 'New Character',
      Description: '',
      Image: undefined,
      Stats: stats,
      Attributes: {},
      Position: { x: 0, y: 0 },
      MoveSpeed: 30,
      CanFly: false,
      Inventory: [],
      Equipment: [],
      Skills: [],
      Statuses: [],
      Tags: [],
      Notes: []
    };
  },

  /**
   * Creates a new character template in the catalog
   * Sets playedBy to the creating user
   */
  create(params: { character: Omit<Character, 'playedBy'> }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    // Initialize character with playedBy and empty Notes
    const character: Character = {
      ...params.character,
      Notes: params.character.Notes || []
    };
    
    campaign.CharacterTemplates.push(character);
    
    LogActions.create({
      action: 'Character created',
      details: `${character.Name} added to catalog`,
      category: 'character',
      level: 'info',
      visibility: ['dm', 'owner'],
      actorId: character.Id
    }, context);
  },

  /**
   * Spawns a character from template onto the field
   * DM Only
   */
  spawn(params: { templateId: string; position?: Position }, context: Context): void {
    ActorActions.spawnActor('character', params, context);
  },

  /**
   * Removes a character from the field (despawn)
   * CUSTOM LOGIC: Syncs character state back to template
   * DM only - handled by ACTION_REGISTRY
   */
  remove(params: { characterId: string }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    // Find the spawned character
    const index = campaign.GameState.Characters.findIndex(c => c.Id === params.characterId);
    if (index === -1) {
      console.warn(`Character not found on field: ${params.characterId}`);
      return;
    }
    
    const character = campaign.GameState.Characters[index];
    
    // Remove from GameState
    campaign.GameState.Characters.splice(index, 1);
    
    // Find the template with the same ID and overwrite it
    const templateIndex = campaign.CharacterTemplates.findIndex(c => c.Id === params.characterId);
    if (templateIndex !== -1) {
      // Overwrite the template with the current character state
      campaign.CharacterTemplates[templateIndex] = character;
      console.log(`[Character] Synced character state back to template: ${character.Name}`);
    } else {
      console.warn(`Template not found for character: ${params.characterId}. Character removed but not synced.`);
    }
    
    LogActions.create({
      action: 'Character removed',
      details: `${character.Name} left the field and synced to template`,
      category: 'character',
      level: 'important',
      visibility: ['all'],
      actorId: params.characterId
    }, context);
  },

  /**
   * Edits a character's properties
   * Players can ONLY edit spawned characters (GameState), never templates
   * They can claim characters or edit their own claimed characters
   */
  edit(params: { characterId: string; updates: Partial<Character> }, context: Context): void {
    ActorActions.editActor('character', { actorId: params.characterId, updates: params.updates }, context);
  },

  /**
   * Deletes a character from the catalog
   * DM only - handled by ACTION_REGISTRY
   */
  delete(params: { characterId: string }, context: Context): void {
    ActorActions.deleteActor('character', { actorId: params.characterId }, context);
  },

  /**
   * Moves a character to a new position
   * Players can only move their own characters
   */
  move(params: { characterId: string; position: Position }, context: Context): void {
    // Validation: Players can only move their own characters
    if (context.User.Role === 'player') {
      const campaign = CampaignActions.getActiveCampaign(context);
      const character = campaign.GameState.Characters.find(c => c.Id === params.characterId);
      
      if (!character) {
        console.warn(`Character not found on field: ${params.characterId}`);
        return;
      }
    }
    
    ActorActions.moveActor('character', { actorId: params.characterId, position: params.position }, context);
  }
};