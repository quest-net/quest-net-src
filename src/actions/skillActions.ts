import type { Room } from 'trystero/nostr';
import type { Skill, GameState } from '../types/game';
import { selfId } from 'trystero';
import { SkillActions } from '../components/DungeonMaster/handlers/setupSkillHandlers';

// DM-only actions (not included in setupSkillHandlers since they're DM-exclusive)
const DM_ACTIONS = {
  RESTORE: 'skillRestore',
  GRANT: 'skillGrant'
} as const;

export function setupSkillActions(
  room: Room,
  gameState: GameState,
  onGameStateChange: (newState: GameState) => void,
  isRoomCreator: boolean
) {
  // Set up action senders
  const [sendSkillUse] = room.makeAction(SkillActions.USE);
  const [sendSkillRemove] = room.makeAction(SkillActions.REMOVE);
  const [sendSkillRestore] = room.makeAction(DM_ACTIONS.RESTORE);
  const [sendSkillGrant] = room.makeAction(DM_ACTIONS.GRANT);

  // DM-only actions for direct state modification
  const dmActions = isRoomCreator ? {
    // For creating new skills in the global catalog
    createSkill: (skill: Omit<Skill, 'id'>) => {
      const newId = crypto.randomUUID();
      onGameStateChange({
        ...gameState,
        globalCollections: {
          ...gameState.globalCollections,
          skills: [...gameState.globalCollections.skills, { ...skill, id: newId }]
        }
      });
      return newId;
    },

    // For updating skills in the catalog
    updateSkill: (id: string, updates: Partial<Skill>) => {
      onGameStateChange({
        ...gameState,
        globalCollections: {
          ...gameState.globalCollections,
          skills: gameState.globalCollections.skills.map(skill =>
            skill.id === id ? { ...skill, ...updates } : skill
          )
        }
      });
    },

    // For deleting skills from the catalog and all actors
    deleteSkill: (id: string) => {
      onGameStateChange({
        ...gameState,
        globalCollections: {
          ...gameState.globalCollections,
          skills: gameState.globalCollections.skills.filter(skill => skill.id !== id)
        },
        party: gameState.party.map(char => ({
          ...char,
          skills: char.skills.filter(skill => skill.id !== id)
        })),
        field: gameState.field.map(entity => ({
          ...entity,
          skills: entity.skills.filter(skill => skill.id !== id)
        }))
      });
    },

    // For DM to directly use a skill without going through action system
    useSkillDirect: (skillId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity') => {
      const actor = actorType === 'character'
        ? gameState.party.find(c => c.id === actorId)
        : actorType === 'globalEntity'
        ? gameState.globalCollections.entities.find(e => e.id === actorId)
        : gameState.field.find(e => e.id === actorId);

      if (!actor) return false;

      const skill = actor.skills.find(s => s.id === skillId);
      if (!skill) return false;

      // Handle uses if applicable
      if (skill.uses !== undefined) {
        if (skill.usesLeft === undefined || skill.usesLeft <= 0) return false;
        skill.usesLeft--;
      }

      // Calculate new SP
      const newSp = Math.max(0, actor.sp - skill.spCost);

      const newState = { ...gameState };

      if (actorType === 'character') {
        newState.party = gameState.party.map(char =>
          char.id === actorId ? {
            ...char,
            sp: newSp,
            skills: char.skills.map(s => s.id === skillId ? skill : s)
          } : char
        );
      } else if (actorType === 'globalEntity') {
        newState.globalCollections.entities = gameState.globalCollections.entities.map(entity =>
          entity.id === actorId ? {
            ...entity,
            sp: newSp,
            skills: entity.skills.map(s => s.id === skillId ? skill : s)
          } : entity
        );
      } else {
        newState.field = gameState.field.map(entity =>
          entity.id === actorId ? {
            ...entity,
            sp: newSp,
            skills: entity.skills.map(s => s.id === skillId ? skill : s)
          } : entity
        );
      }

      onGameStateChange(newState);
      return true;
    },

    // For DM to directly grant a skill
    grantSkillDirect: (skillId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity') => {
      const skill = gameState.globalCollections.skills.find(s => s.id === skillId);
      if (!skill) return false;

      const newState = { ...gameState };

      if (actorType === 'character') {
        newState.party = gameState.party.map(char =>
          char.id === actorId ? {
            ...char,
            skills: [...char.skills, { ...skill, usesLeft: skill.uses }]
          } : char
        );
      } else if (actorType === 'globalEntity') {
        newState.globalCollections.entities = gameState.globalCollections.entities.map(entity =>
          entity.id === actorId ? {
            ...entity,
            skills: [...entity.skills, { ...skill, usesLeft: skill.uses }]
          } : entity
        );
      } else {
        newState.field = gameState.field.map(entity =>
          entity.id === actorId ? {
            ...entity,
            skills: [...entity.skills, { ...skill, usesLeft: skill.uses }]
          } : entity
        );
      }

      onGameStateChange(newState);
      return true;
    },

    // For DM to directly remove a skill
    removeSkillDirect: (skillId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity') => {
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
      return true;
    },

    // For DM to directly restore skill uses
    restoreSkillUsesDirect: (skillId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity', newUsesLeft: number) => {
      const newState = { ...gameState };

      if (actorType === 'character') {
        newState.party = gameState.party.map(char =>
          char.id === actorId ? {
            ...char,
            skills: char.skills.map(skill =>
              skill.id === skillId ? { ...skill, usesLeft: newUsesLeft } : skill
            )
          } : char
        );
      } else if (actorType === 'globalEntity') {
        newState.globalCollections.entities = gameState.globalCollections.entities.map(entity =>
          entity.id === actorId ? {
            ...entity,
            skills: entity.skills.map(skill =>
              skill.id === skillId ? { ...skill, usesLeft: newUsesLeft } : skill
            )
          } : entity
        );
      } else {
        newState.field = gameState.field.map(entity =>
          entity.id === actorId ? {
            ...entity,
            skills: entity.skills.map(skill =>
              skill.id === skillId ? { ...skill, usesLeft: newUsesLeft } : skill
            )
          } : entity
        );
      }

      onGameStateChange(newState);
      return true;
    }
  } : undefined;

  // Actions available to both DM and players
  return {
    ...dmActions,

    useSkill: (skillId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity') => {
      if (isRoomCreator) {
        return dmActions?.useSkillDirect(skillId, actorId, actorType);
      }
      return sendSkillUse({ skillId, actorId, actorType });
    },

    grantSkill: (skillId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity') => {
      if (!isRoomCreator) return Promise.resolve(false);
      return dmActions?.grantSkillDirect(skillId, actorId, actorType);
    },

    removeSkill: (skillId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity') => {
      if (isRoomCreator) {
        return dmActions?.removeSkillDirect(skillId, actorId, actorType);
      }
      return sendSkillRemove({ skillId, actorId, actorType });
    },

    restoreSkillUses: (skillId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity', newUsesLeft: number) => {
      if (!isRoomCreator) return Promise.resolve(false);
      return dmActions?.restoreSkillUsesDirect(skillId, actorId, actorType, newUsesLeft);
    }
  };
}

export function useSkillActions(
  room: Room | undefined,
  gameState: GameState,
  onGameStateChange: (newState: GameState) => void,
  isRoomCreator: boolean
) {
  if (!room) return;
  return setupSkillActions(room, gameState, onGameStateChange, isRoomCreator);
}