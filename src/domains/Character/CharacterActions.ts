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
   * Creates a new character template in the catalog
   * Sets playedBy to the creating user
   */
  create(params: { character: Omit<Character, 'playedBy'> }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    // Initialize character with playedBy and empty Notes
    const character: Character = {
      ...params.character,
      Notes: params.character.Notes || [],
      playedBy: null
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
   * DM only - handled by ACTION_REGISTRY
   */
  remove(params: { characterId: string }, context: Context): void {
    ActorActions.removeActor('character', { actorId: params.characterId }, context);
  },

  /**
   * Edits a character's properties
   * Players can edit their own characters OR claim unclaimed characters
   */
  edit(params: { characterId: string; updates: Partial<Character> }, context: Context): void {
    // Validation: Players have special rules
    if (context.User.Role === 'player') {
      const campaign = CampaignActions.getActiveCampaign(context);
      
      // Check both templates and spawned characters
      let character = campaign.CharacterTemplates.find(c => c.Id === params.characterId);
      if (!character) {
        character = campaign.GameState.Characters.find(c => c.Id === params.characterId);
      }
      
      if (!character) {
        console.warn(`Character not found: ${params.characterId}`);
        return;
      }
      
      // If trying to edit playedBy field (claiming a character)
      if (params.updates.playedBy !== undefined) {
        // Can only claim unclaimed characters, and only to self
        if (character.playedBy) {
          console.warn(`Player ${context.User.Name} cannot claim character ${params.characterId} - already played by ${character.playedBy.Name}`);
          return;
        }
        if (params.updates.playedBy !== context.User) {
          console.warn(`Player ${context.User.Name} cannot set playedBy to another user`);
          return;
        }
      } else {
        // Editing other fields - must already own the character
        if (character.playedBy !== context.User) {
          console.warn(`Player ${context.User.Name} cannot edit character ${params.characterId} (played by ${character.playedBy?.Name})`);
          return;
        }
      }
    }
    
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
      
      if (character.playedBy !== context.User) {
        console.warn(`Player ${context.User.Name} cannot move character ${params.characterId} (played by ${character.playedBy?.Name})`);
        return;
      }
    }
    
    ActorActions.moveActor('character', { actorId: params.characterId, position: params.position }, context);
  }
};