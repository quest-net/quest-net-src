import type { Room } from 'trystero/nostr';
import { type GameState, SerializableCharacter, Entity, CombatState } from '../types/game';

export const CombatActions = {
  START: 'combatStart',
  END: 'combatEnd',
  NEXT_TURN: 'combatNext',
  PREV_TURN: 'combatPrev',
  REGEN_SP: 'spRegen',
} as const;

// Helper function to apply SP regeneration to a character
function applySPRegenerationToCharacter(character: SerializableCharacter, isForward: boolean = true): SerializableCharacter {
  const multiplier = isForward ? 1 : -1;
  const newSP = Math.min(
    character.maxSp,
    Math.max(0, character.sp + (character.spRegenRate * multiplier))
  );
  
  return {
    ...character,
    sp: newSP
  };
}

// Helper function to apply SP regeneration to an entity
function applySPRegenerationToEntity(entity: Entity, isForward: boolean = true): Entity {
  const multiplier = isForward ? 1 : -1;
  const newSP = Math.min(
    entity.maxSp,
    Math.max(0, entity.sp + (entity.spRegenRate * multiplier))
  );
  
  return {
    ...entity,
    sp: newSP
  };
}

// Helper function to update all actors' SP in the game state
function updateAllActorsSP(gameState: GameState, isForward: boolean = true): GameState {
  // Update party members (Characters)
  const updatedParty = gameState.party.map(character => 
    applySPRegenerationToCharacter(character, isForward)
  );

  // Update field entities
  const updatedField = gameState.field.map(entity =>
    applySPRegenerationToEntity(entity, isForward)
  );

  return {
    ...gameState,
    party: updatedParty,
    field: updatedField
  };
}

// Helper to ensure combat state is always complete
function createCombatState(
  isActive: boolean,
  currentTurn: number,
  initiativeSide: 'party' | 'enemies'
): CombatState {
  return {
    isActive,
    currentTurn,
    initiativeSide
  };
}

export function setupCombatActions(
  room: Room,
  gameState: GameState,
  onGameStateChange: (newState: GameState) => void,
  isRoomCreator: boolean
) {
  if (!isRoomCreator) {
    return {
      startCombat: () => {},
      endCombat: () => {},
      nextTurn: () => {},
      previousTurn: () => {},
    };
  }

  return {
    startCombat: (initialSide: 'party' | 'enemies') => {
      console.log(`DM starting combat with ${initialSide} initiative`);
      onGameStateChange({
        ...gameState,
        combat: createCombatState(true, 1, initialSide)
      });
    },

    endCombat: () => {
      console.log('DM ending combat');
      onGameStateChange({
        ...gameState,
        combat: createCombatState(false, 0, 'party')
      });
    },

    nextTurn: () => {
      if (!gameState.combat?.isActive) return;
      
      console.log('DM advancing to next turn');
      
      const updatedState = updateAllActorsSP(gameState, true);
      const currentCombat = gameState.combat;

      if (!currentCombat) {
        console.error('Combat state is undefined');
        return;
      }
      
      onGameStateChange({
        ...updatedState,
        combat: createCombatState(
          true,
          currentCombat.currentTurn + 1,
          currentCombat.initiativeSide === 'party' ? 'enemies' : 'party'
        )
      });
    },

    previousTurn: () => {
      const currentCombat = gameState.combat;
      if (!currentCombat?.isActive || currentCombat.currentTurn <= 1) return;
      
      console.log('DM going to previous turn');
      
      const updatedState = updateAllActorsSP(gameState, false);
      
      onGameStateChange({
        ...updatedState,
        combat: createCombatState(
          true,
          currentCombat.currentTurn - 1,
          currentCombat.initiativeSide === 'party' ? 'enemies' : 'party'
        )
      });
    }
  };
}

export function useCombatActions(
  room: Room | undefined,
  gameState: GameState,
  onGameStateChange: (newState: GameState) => void,
  isRoomCreator: boolean
) {
  if (!room) {
    return {
      startCombat: () => {},
      endCombat: () => {},
      nextTurn: () => {},
      previousTurn: () => {}
    };
  }

  return setupCombatActions(room, gameState, onGameStateChange, isRoomCreator);
}