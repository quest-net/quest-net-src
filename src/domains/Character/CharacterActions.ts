// domains/Character/CharacterActions.ts

import { Context } from "../Context/Context";
import { Character } from "./Character";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import { ActorActions } from "../Actor/ActorActions";
import { Position } from "../Actor/Actor";

/**
 * Character action handlers
 * Characters are unique, persistent actors that move between Roster and GameState
 * Unlike Entities, Characters are never cloned - they MOVE between locations
 */
export const CharacterActions = {
  
  /**
   * Creates a default character with campaign stat definitions
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
      Position: { x: 0, y: 0, h: 0 },
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
   * Creates a new character and adds to the roster
   */
  create(params: { character: Omit<Character, 'playedBy'> }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    // Initialize character with empty Notes if not provided
    const character: Character = {
      ...params.character,
      Notes: params.character.Notes || []
    };
    
    campaign.CharacterRoster.push(character);
    
    LogActions.create({
      action: 'Character created',
      details: `${character.Name} added to roster`,
      category: 'character',
      level: 'info',
      visibility: ['dm', 'owner'],
      actorId: character.Id
    }, context);
  },

  /**
   * Spawns a character from roster onto the field (MOVE operation)
   * DM only - handled by ACTION_REGISTRY
   */
  spawn(params: { characterId: string; position?: Position }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    // Find character in roster
    const rosterIndex = campaign.CharacterRoster.findIndex(c => c.Id === params.characterId);
    if (rosterIndex === -1) {
      console.warn(`Character not found in roster: ${params.characterId}`);
      return;
    }
    
    // Check if already spawned (safety check - shouldn't happen with proper UI)
    const alreadySpawned = campaign.GameState.Characters.some(c => c.Id === params.characterId);
    if (alreadySpawned) {
      console.warn(`Character already spawned: ${params.characterId}`);
      return;
    }
    
    // MOVE: Remove from roster
    const [character] = campaign.CharacterRoster.splice(rosterIndex, 1);
    
    // Update position if provided
    if (params.position) {
      character.Position = params.position;
    }
    
    // Add to GameState
    campaign.GameState.Characters.push(character);
    
    LogActions.create({
      action: 'Character spawned',
      details: `${character.Name} entered the field`,
      category: 'character',
      level: 'important',
      visibility: ['all'],
      actorId: character.Id
    }, context);
  },

  /**
   * Removes a character from the field (MOVE operation)
   * Moves character back to roster, preserving all state changes
   * DM only - handled by ACTION_REGISTRY
   */
  remove(params: { characterId: string }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    // Find the spawned character
    const gameStateIndex = campaign.GameState.Characters.findIndex(c => c.Id === params.characterId);
    if (gameStateIndex === -1) {
      console.warn(`Character not found in GameState: ${params.characterId}`);
      return;
    }
    
    // Check if already in roster (safety check - shouldn't happen)
    const alreadyInRoster = campaign.CharacterRoster.some(c => c.Id === params.characterId);
    if (alreadyInRoster) {
      console.warn(`Character already in roster: ${params.characterId}. Removing from GameState only.`);
      campaign.GameState.Characters.splice(gameStateIndex, 1);
      return;
    }
    
    // MOVE: Remove from GameState
    const [character] = campaign.GameState.Characters.splice(gameStateIndex, 1);
    
    // Add back to roster
    campaign.CharacterRoster.push(character);
    
    LogActions.create({
      action: 'Character removed',
      details: `${character.Name} left the field and returned to roster`,
      category: 'character',
      level: 'important',
      visibility: ['all'],
      actorId: params.characterId
    }, context);
  },

  /**
   * Edits a character's properties
   * Works on characters in either Roster or GameState
   * Players can edit their own characters, DM can edit any
   */
  edit(params: { characterId: string; updates: Partial<Character> }, context: Context): void {
    ActorActions.editActor('character', { actorId: params.characterId, updates: params.updates }, context);
  },

  /**
   * Deletes a character from the roster permanently
   * Character must NOT be in GameState (must be removed first)
   * DM only - handled by ACTION_REGISTRY
   */
  delete(params: { characterId: string }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    // Safety check: Don't delete if character is currently spawned
    const isSpawned = campaign.GameState.Characters.some(c => c.Id === params.characterId);
    if (isSpawned) {
      console.warn(`Cannot delete spawned character: ${params.characterId}. Remove from field first.`);
      return;
    }
    
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
        console.warn(`Character not found in GameState: ${params.characterId}`);
        return;
      }
      
      // TODO: Add ownership validation here when implemented
      // if (character.OwnerId !== context.User.Id) { return; }
    }
    
    ActorActions.moveActor('character', { actorId: params.characterId, position: params.position }, context);
  },

  /**
 * Bulk edit tags for multiple characters
 * More efficient than individual edits - single log entry, single state sync
 */
  bulkEditTags(
    params: { updates: Array<{ characterId: string; tags: string[] }> },
    context: Context
  ): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    let successCount = 0;
    
    // Apply all updates
    params.updates.forEach(update => {
      // Try to find in roster first, then in gamestate
      let character = campaign.CharacterRoster.find(c => c.Id === update.characterId);
      if (!character) {
        character = campaign.GameState.Characters.find(c => c.Id === update.characterId);
      }
      
      if (character) {
        character.Tags = update.tags;
        successCount++;
      } else {
        console.warn(`Character not found for bulk update: ${update.characterId}`);
      }
    });
    
    // Single log entry for the entire bulk operation
    LogActions.create({
      action: 'Characters organized',
      details: `Updated tags for ${successCount} character(s)`,
      category: 'character',
      level: 'info',
      visibility: ['dm']
    }, context);
  }

};