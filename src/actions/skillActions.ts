// src/actions/skillActions.ts

import type { Room } from 'trystero/nostr';
import type { Skill, GameState, SkillReference } from '../types/game';
import { selfId } from 'trystero';
import { SkillActions } from '../components/DungeonMaster/handlers/setupSkillHandlers';
import { createSkillReference, getCatalogSkill } from '../utils/referenceHelpers';

const DM_ACTIONS = {
  RESTORE: 'skillRestore'  // DM-only action
} as const;

interface SkillRestorePayload {
  skillId: string;
  actorId: string;
  actorType: 'character' | 'globalEntity' | 'fieldEntity';
  newUsesLeft: number;
}

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

    // For deleting skills from the catalog and all references
    deleteSkill: (id: string) => {
      onGameStateChange({
        ...gameState,
        globalCollections: {
          ...gameState.globalCollections,
          skills: gameState.globalCollections.skills.filter(skill => skill.id !== id)
        },
        party: gameState.party.map(char => ({
          ...char,
          skills: char.skills.filter(skillRef => skillRef.catalogId !== id)
        })),
        field: gameState.field.map(entityRef => ({
          ...entityRef,
          skills: entityRef.skills.filter(skillRef => skillRef.catalogId !== id)
        }))
      });
    },

    // For DM to directly use a skill without going through action system
    useSkillDirect: (skillId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity') => {
      const catalogSkill = gameState.globalCollections.skills.find(s => s.id === skillId);
      if (!catalogSkill) return false;

      if (actorType === 'character') {
        const character = gameState.party.find(c => c.id === actorId);
        if (!character) return false;

        const skillRef = character.skills.find(s => s.catalogId === skillId);
        if (!skillRef) return false;

        // Check SP cost
        if (character.sp < catalogSkill.spCost) return false;

        // Handle uses if applicable
        if (catalogSkill.uses !== undefined) {
          const usesLeft = skillRef.usesLeft ?? catalogSkill.uses;
          if (usesLeft <= 0) return false;
        }

        const newSp = Math.max(0, character.sp - catalogSkill.spCost);
        const newUsesLeft = catalogSkill.uses !== undefined 
          ? Math.max(0, (skillRef.usesLeft ?? catalogSkill.uses) - 1)
          : undefined;

        onGameStateChange({
          ...gameState,
          party: gameState.party.map(char =>
            char.id === actorId ? {
              ...char,
              sp: newSp,
              skills: char.skills.map(s =>
                s.catalogId === skillId ? { ...s, usesLeft: newUsesLeft } : s
              )
            } : char
          )
        });
        return true;
      } else if (actorType === 'globalEntity') {
        const entity = gameState.globalCollections.entities.find(e => e.id === actorId);
        if (!entity) return false;

        const skillRef = entity.skills.find(s => s.catalogId === skillId);
        if (!skillRef) return false;

        if (entity.sp < catalogSkill.spCost) return false;

        if (catalogSkill.uses !== undefined) {
          const usesLeft = skillRef.usesLeft ?? catalogSkill.uses;
          if (usesLeft <= 0) return false;
        }

        const newSp = Math.max(0, entity.sp - catalogSkill.spCost);
        const newUsesLeft = catalogSkill.uses !== undefined 
          ? Math.max(0, (skillRef.usesLeft ?? catalogSkill.uses) - 1)
          : undefined;

        onGameStateChange({
          ...gameState,
          globalCollections: {
            ...gameState.globalCollections,
            entities: gameState.globalCollections.entities.map(entity =>
              entity.id === actorId ? {
                ...entity,
                sp: newSp,
                skills: entity.skills.map(s =>
                  s.catalogId === skillId ? { ...s, usesLeft: newUsesLeft } : s
                )
              } : entity
            )
          }
        });
        return true;
      } else {
        // ✅ FIXED: Use instanceId for field entity lookup
        const entityRef = gameState.field.find(e => e.instanceId === actorId);
        if (!entityRef) return false;

        const skillRef = entityRef.skills.find(s => s.catalogId === skillId);
        if (!skillRef) return false;

        if (entityRef.sp < catalogSkill.spCost) return false;

        if (catalogSkill.uses !== undefined) {
          const usesLeft = skillRef.usesLeft ?? catalogSkill.uses;
          if (usesLeft <= 0) return false;
        }

        const newSp = Math.max(0, entityRef.sp - catalogSkill.spCost);
        const newUsesLeft = catalogSkill.uses !== undefined 
          ? Math.max(0, (skillRef.usesLeft ?? catalogSkill.uses) - 1)
          : undefined;

        onGameStateChange({
          ...gameState,
          field: gameState.field.map(entRef =>
            entRef.instanceId === actorId ? {
              ...entRef,
              sp: newSp,
              skills: entRef.skills.map(s =>
                s.catalogId === skillId ? { ...s, usesLeft: newUsesLeft } : s
              )
            } : entRef
          )
        });
        return true;
      }
    },

    // For DM to directly grant a skill - creates SkillReference objects
    grantSkillDirect: (skillId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity') => {
      const catalogSkill = gameState.globalCollections.skills.find(s => s.id === skillId);
      if (!catalogSkill) return false;

      const skillRef = createSkillReference(skillId, catalogSkill.uses);
      const newState = { ...gameState };

      if (actorType === 'character') {
        // Check if character already has this skill
        const character = gameState.party.find(c => c.id === actorId);
        if (!character || character.skills.some(s => s.catalogId === skillId)) return false;

        newState.party = gameState.party.map(char =>
          char.id === actorId ? {
            ...char,
            skills: [...char.skills, skillRef]
          } : char
        );
      } else if (actorType === 'globalEntity') {
        const entity = gameState.globalCollections.entities.find(e => e.id === actorId);
        if (!entity || entity.skills.some(s => s.catalogId === skillId)) return false;

        newState.globalCollections = {
          ...gameState.globalCollections,
          entities: gameState.globalCollections.entities.map(entity =>
            entity.id === actorId ? {
              ...entity,
              skills: [...entity.skills, skillRef]
            } : entity
          )
        };
      } else {
        // ✅ FIXED: Use instanceId for field entity lookup
        const entityRef = gameState.field.find(e => e.instanceId === actorId);
        if (!entityRef || entityRef.skills.some(s => s.catalogId === skillId)) return false;

        newState.field = gameState.field.map(entRef =>
          entRef.instanceId === actorId ? {
            ...entRef,
            skills: [...entRef.skills, skillRef]
          } : entRef
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
            skills: char.skills.filter(s => s.catalogId !== skillId)
          } : char
        );
      } else if (actorType === 'globalEntity') {
        newState.globalCollections = {
          ...gameState.globalCollections,
          entities: gameState.globalCollections.entities.map(entity =>
            entity.id === actorId ? {
              ...entity,
              skills: entity.skills.filter(s => s.catalogId !== skillId)
            } : entity
          )
        };
      } else {
        // ✅ FIXED: Use instanceId for field entity lookup
        newState.field = gameState.field.map(entityRef =>
          entityRef.instanceId === actorId ? {
            ...entityRef,
            skills: entityRef.skills.filter(s => s.catalogId !== skillId)
          } : entityRef
        );
      }

      onGameStateChange(newState);
      return true;
    },

    // For DM to directly restore skill uses
    restoreSkillUsesDirect: (skillId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity', newUsesLeft: number) => {
      const catalogSkill = gameState.globalCollections.skills.find(s => s.id === skillId);
      if (!catalogSkill?.uses) return false; // Can't restore infinite use skills

      const newState = { ...gameState };

      if (actorType === 'character') {
        newState.party = gameState.party.map(char =>
          char.id === actorId ? {
            ...char,
            skills: char.skills.map(skillRef =>
              skillRef.catalogId === skillId ? { ...skillRef, usesLeft: newUsesLeft } : skillRef
            )
          } : char
        );
      } else if (actorType === 'globalEntity') {
        newState.globalCollections = {
          ...gameState.globalCollections,
          entities: gameState.globalCollections.entities.map(entity =>
            entity.id === actorId ? {
              ...entity,
              skills: entity.skills.map(skillRef =>
                skillRef.catalogId === skillId ? { ...skillRef, usesLeft: newUsesLeft } : skillRef
              )
            } : entity
          )
        };
      } else {
        // ✅ FIXED: Use instanceId for field entity lookup
        newState.field = gameState.field.map(entityRef =>
          entityRef.instanceId === actorId ? {
            ...entityRef,
            skills: entityRef.skills.map(skillRef =>
              skillRef.catalogId === skillId ? { ...skillRef, usesLeft: newUsesLeft } : skillRef
            )
          } : entityRef
        );
      }

      onGameStateChange(newState);
      return true;
    }
  } : undefined;

  // Actions available to both DM and players
  return {
    ...dmActions,

    // Player action: Use a skill (sends P2P message with skillId for handler to process)
    useSkill: (skillId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity') => {
      if (isRoomCreator) {
        return dmActions?.useSkillDirect(skillId, actorId, actorType);
      }
      return sendSkillUse({ skillId, actorId, actorType });
    },

    // DM action: Grant a skill to an actor
    grantSkill: (skillId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity') => {
      if (!isRoomCreator) return Promise.resolve(false);
      return dmActions?.grantSkillDirect(skillId, actorId, actorType);
    },

    // Player action: Remove/forget a skill
    removeSkill: (skillId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity') => {
      if (isRoomCreator) {
        return dmActions?.removeSkillDirect(skillId, actorId, actorType);
      }
      return sendSkillRemove({ skillId, actorId, actorType });
    },

    // DM action: Restore skill uses
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