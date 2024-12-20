import type { Room } from 'trystero/nostr';
import type { GameState } from '../../../types/game';

// These must be 12 bytes or less for Trystero
export const SkillActions = {
  USE: 'skillUse',
  REMOVE: 'skillRemove'
} as const;

interface SkillActionPayload {
  skillId: string;
  actorId: string;
  actorType: 'character' | 'globalEntity' | 'fieldEntity';
}

export function setupSkillHandlers(
  room: Room,
  gameState: GameState,
  onGameStateChange: (newState: GameState) => void
) {
  // Handle skill use requests from players
  const [_, getSkillUse] = room.makeAction<SkillActionPayload>(SkillActions.USE);
  getSkillUse(({ skillId, actorId, actorType }) => {
    console.log('DM received skill use request:', { skillId, actorId, actorType });
    
    const actor = actorType === 'character'
      ? gameState.party.find(c => c.id === actorId)
      : actorType === 'globalEntity'
      ? gameState.globalCollections.entities.find(e => e.id === actorId)
      : gameState.field.find(e => e.id === actorId);

    if (!actor) {
      console.error('Actor not found:', { actorId, actorType });
      return;
    }

    const skill = actor.skills.find(s => s.id === skillId);
    if (!skill) {
      console.error('Skill not found:', skillId);
      return;
    }

    // Handle uses if applicable
    if (skill.uses !== undefined) {
      if (skill.usesLeft === undefined || skill.usesLeft <= 0) {
        console.error('No uses left for skill:', skillId);
        return;
      }
      skill.usesLeft--;
    }

    // Calculate new SP, ensuring it doesn't go below 0
    const newSp = Math.max(0, actor.sp - skill.spCost);

    // Update the appropriate collection based on actor type
    const newState = { ...gameState };

    if (actorType === 'character') {
      newState.party = gameState.party.map(char =>
        char.id === actorId ? {
          ...char,
          sp: newSp,
          skills: char.skills.map(s =>
            s.id === skillId ? skill : s
          )
        } : char
      );
    } else if (actorType === 'globalEntity') {
      newState.globalCollections.entities = gameState.globalCollections.entities.map(entity =>
        entity.id === actorId ? {
          ...entity,
          sp: newSp,
          skills: entity.skills.map(s =>
            s.id === skillId ? skill : s
          )
        } : entity
      );
    } else {
      newState.field = gameState.field.map(entity =>
        entity.id === actorId ? {
          ...entity,
          sp: newSp,
          skills: entity.skills.map(s =>
            s.id === skillId ? skill : s
          )
        } : entity
      );
    }

    onGameStateChange(newState);
  });

  // Handle skill removal requests from players
  const [__, getSkillRemove] = room.makeAction<SkillActionPayload>(SkillActions.REMOVE);
  getSkillRemove(({ skillId, actorId, actorType }) => {
    console.log('DM received skill remove request:', { skillId, actorId, actorType });
    
    const newState = { ...gameState };

    if (actorType === 'character') {
      newState.party = gameState.party.map(char =>
        char.id === actorId ? {
          ...char,
          skills: char.skills.filter(s => s.id !== skillId)
        } : char
      );
    } else if (actorType === 'globalEntity') {
      newState.globalCollections.entities = gameState.globalCollections.entities.map(entity =>
        entity.id === actorId ? {
          ...entity,
          skills: entity.skills.filter(s => s.id !== skillId)
        } : entity
      );
    } else {
      newState.field = gameState.field.map(entity =>
        entity.id === actorId ? {
          ...entity,
          skills: entity.skills.filter(s => s.id !== skillId)
        } : entity
      );
    }

    onGameStateChange(newState);
  });
}