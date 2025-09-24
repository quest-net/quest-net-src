// src/components/DungeonMaster/handlers/setupSkillHandlers.ts

import type { Room } from 'trystero/nostr';
import type { GameState, Character, Entity, EntityReference, SkillReference } from '../../../types/game';
import { getCatalogSkill } from '../../../utils/referenceHelpers';

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
    
    // Find actor based on type with proper typing
    let actor: Character | Entity | EntityReference | null = null;
    
    if (actorType === 'character') {
      actor = gameState.party.find(c => c.id === actorId) || null;
    } else if (actorType === 'globalEntity') {
      actor = gameState.globalCollections.entities.find(e => e.id === actorId) || null;
    } else {
      // ✅ FIXED: For field entities, use instanceId instead of catalogId
      actor = gameState.field.find(e => e.instanceId === actorId) || null;
    }

    if (!actor) {
      console.error('Actor not found:', { actorId, actorType });
      return;
    }

    // Find the skill reference
    const skillRef = actor.skills.find(s => s.catalogId === skillId);
    if (!skillRef) {
      console.error('Skill not found:', skillId);
      return;
    }

    // Get catalog skill for damage/cost data
    const catalogSkill = getCatalogSkill(skillRef.catalogId, gameState);
    if (!catalogSkill) {
      console.error('Catalog skill not found:', skillId);
      return;
    }

    // Check SP requirement
    if (actor.sp < catalogSkill.spCost) {
      console.error('Insufficient SP for skill:', { required: catalogSkill.spCost, current: actor.sp });
      return;
    }

    // Handle uses if applicable
    if (catalogSkill.uses !== undefined) {
      const usesLeft = skillRef.usesLeft ?? catalogSkill.uses;
      if (usesLeft <= 0) {
        console.error('No uses left for skill:', skillId);
        return;
      }
    }

    // Calculate new SP and uses
    const newSp = Math.max(0, actor.sp - catalogSkill.spCost);
    const newUsesLeft = catalogSkill.uses !== undefined 
      ? Math.max(0, (skillRef.usesLeft ?? catalogSkill.uses) - 1)
      : undefined;

    // Update the appropriate collection based on actor type
    const newState = { ...gameState };

    if (actorType === 'character') {
      newState.party = gameState.party.map(char =>
        char.id === actorId ? {
          ...char,
          sp: newSp,
          skills: char.skills.map(s =>
            s.catalogId === skillId ? { ...s, usesLeft: newUsesLeft } : s
          )
        } : char
      );
    } else if (actorType === 'globalEntity') {
      newState.globalCollections = {
        ...newState.globalCollections,
        entities: newState.globalCollections.entities.map(entity =>
          entity.id === actorId ? {
            ...entity,
            sp: newSp,
            skills: entity.skills.map(s =>
              s.catalogId === skillId ? { ...s, usesLeft: newUsesLeft } : s
            )
          } : entity
        )
      };
    } else {
      // ✅ FIXED: Use instanceId for field entity updates
      newState.field = gameState.field.map(entityRef =>
        entityRef.instanceId === actorId ? {
          ...entityRef,
          sp: newSp,
          skills: entityRef.skills.map(s =>
            s.catalogId === skillId ? { ...s, usesLeft: newUsesLeft } : s
          )
        } : entityRef
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
          skills: char.skills.filter(s => s.catalogId !== skillId)
        } : char
      );
    } else if (actorType === 'globalEntity') {
      newState.globalCollections = {
        ...newState.globalCollections,
        entities: newState.globalCollections.entities.map(entity =>
          entity.id === actorId ? {
            ...entity,
            skills: entity.skills.filter(s => s.catalogId !== skillId)
          } : entity
        )
      };
    } else {
      // ✅ FIXED: Use instanceId for field entity updates
      newState.field = gameState.field.map(entityRef =>
        entityRef.instanceId === actorId ? {
          ...entityRef,
          skills: entityRef.skills.filter(s => s.catalogId !== skillId)
        } : entityRef
      );
    }

    onGameStateChange(newState);
  });
}