import type { Room } from 'trystero/nostr';
import { type GameState, SerializableCharacter, Entity, CombatState, BattleMapPosition, DEFAULT_CHARACTER_POSITIONS, DEFAULT_ENTITY_POSITIONS } from '../types/game';
import { selfId } from 'trystero';

// Combined action types
export const CombatActions = {
  START: 'combatStart',
  END: 'combatEnd',
  NEXT_TURN: 'combatNext',
  PREV_TURN: 'combatPrev',
  REGEN_SP: 'spRegen',
  REQUEST_MOVE: 'reqMove'
} as const;

// DM-only actions for battle map
const DM_ACTIONS = {
  INIT_POSITION: 'initPos',
  MOVE_PIECE: 'movePiece',
  CLEAR_POSITIONS: 'clearPos'
} as const;

interface RequestMovePayload {
  actorId: string;
  position: BattleMapPosition;
  playerId: string;
}

// Helper function to clear movement arrows by removing lastMoveFrom from all positions
const clearMovementArrows = (positions: { [actorId: string]: BattleMapPosition }) => {
  const clearedPositions: { [actorId: string]: BattleMapPosition } = {};
  
  Object.entries(positions).forEach(([actorId, position]) => {
    // Create new position object without lastMoveFrom
    const { lastMoveFrom, ...clearedPosition } = position;
    clearedPositions[actorId] = clearedPosition;
  });
  
  return clearedPositions;
};

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
  const updatedParty = gameState.party.map(character => 
    applySPRegenerationToCharacter(character, isForward)
  );

  const updatedField = gameState.field.map(entity =>
    applySPRegenerationToEntity(entity, isForward)
  );

  return {
    ...gameState,
    party: updatedParty,
    field: updatedField
  };
}

// Helper to find available position for battle map
function findAvailablePosition(
  positions: { [actorId: string]: BattleMapPosition },
  isCharacter: boolean,
  defaultPositions: BattleMapPosition[]
): BattleMapPosition | null {
  const takenPositions = Object.values(positions);

  // Try default positions first
  const availableDefaultPos = defaultPositions.find(pos =>
    !takenPositions.some(taken => taken.x === pos.x && taken.y === pos.y)
  );

  if (availableDefaultPos) return availableDefaultPos;

  // If all defaults taken, find any available spot
  for (let x = 0; x < 63; x++) {
    for (let y = 0; y < 63; y++) {
      if (!takenPositions.some(pos => pos.x === x && pos.y === y)) {
        return { x, y };
      }
    }
  }

  return null;
}

// Helper to ensure combat state is always complete
function createCombatState(
  isActive: boolean,
  currentTurn: number,
  initiativeSide: 'party' | 'enemies',
  positions?: { [actorId: string]: BattleMapPosition }
): CombatState {
  return {
    isActive,
    currentTurn,
    initiativeSide,
    positions: positions || {}
  };
}

export function setupCombatActions(
  room: Room,
  gameState: GameState,
  onGameStateChange: (newState: GameState) => void,
  isRoomCreator: boolean,
  defaultCharacterPositions: BattleMapPosition[],
  defaultEntityPositions: BattleMapPosition[]
) {
  // Set up action senders for battle map
  const [sendInitPosition] = room.makeAction(DM_ACTIONS.INIT_POSITION);
  const [sendMovePiece] = room.makeAction(DM_ACTIONS.MOVE_PIECE);
  const [sendRequestMove] = room.makeAction(CombatActions.REQUEST_MOVE);

  // DM-only actions
  const dmActions = isRoomCreator ? {
    initializePositionDirect: (actorId: string, isCharacter: boolean) => {
      if (!gameState.combat?.isActive) return;

      const position = findAvailablePosition(
        gameState.combat.positions || {},
        isCharacter,
        isCharacter ? defaultCharacterPositions : defaultEntityPositions
      );

      if (!position) {
        console.error('No available positions on battle map');
        return;
      }

      onGameStateChange({
        ...gameState,
        combat: {
          ...gameState.combat,
          positions: {
            ...gameState.combat.positions,
            [actorId]: position
          }
        }
      });
    },

    movePieceDirect: (actorId: string, newPosition: BattleMapPosition) => {
      if (!gameState.combat?.isActive) return;

      const isPositionTaken = Object.entries(gameState.combat.positions || {})
        .some(([id, pos]) => id !== actorId && pos.x === newPosition.x && pos.y === newPosition.y);

      if (isPositionTaken) return;

      const currentPos = gameState.combat.positions?.[actorId];
      const position = {
        ...newPosition,
        lastMoveFrom: currentPos ? { x: currentPos.x, y: currentPos.y } : undefined
      };

      onGameStateChange({
        ...gameState,
        combat: {
          ...gameState.combat,
          positions: {
            ...(gameState.combat.positions || {}),
            [actorId]: position
          }
        }
      });
    },

    clearPositionsDirect: () => {
      if (!gameState.combat) return;
      onGameStateChange({
        ...gameState,
        combat: {
          ...gameState.combat,
          positions: {}
        }
      });
    }
  } : undefined;

  // Combined actions available to both DM and players
  return {
    ...dmActions,

    startCombat: (initialSide: 'party' | 'enemies') => {
      if (!isRoomCreator) return;
      
      const positions: { [actorId: string]: BattleMapPosition } = {};
      
      // Place party members
      gameState.party.forEach((character, index) => {
        const position = findAvailablePosition(
          positions,
          true,
          defaultCharacterPositions
        );
        if (position) {
          positions[character.id] = position;
        }
      });

      // Place field entities
      gameState.field.forEach((entity, index) => {
        const position = findAvailablePosition(
          positions,
          false,
          defaultEntityPositions
        );
        if (position) {
          positions[entity.id] = position;
        }
      });

      onGameStateChange({
        ...gameState,
        combat: createCombatState(true, 1, initialSide, positions)
      });
    },

    endCombat: () => {
      if (!isRoomCreator) return;
      onGameStateChange({
        ...gameState,
        combat: createCombatState(false, 0, 'party')
      });
    },

    nextTurn: () => {
      if (!isRoomCreator || !gameState.combat?.isActive) return;
      
      const updatedState = updateAllActorsSP(gameState, true);
      const currentCombat = gameState.combat;
      
      onGameStateChange({
        ...updatedState,
        combat: {
          ...currentCombat,
          currentTurn: currentCombat.currentTurn + 1,
          initiativeSide: currentCombat.initiativeSide === 'party' ? 'enemies' : 'party',
          positions: clearMovementArrows(currentCombat.positions || {})
        }
      });
    },

    previousTurn: () => {
      if (!isRoomCreator || !gameState.combat?.isActive || gameState.combat.currentTurn <= 1) return;
      
      const updatedState = updateAllActorsSP(gameState, false);
      const currentCombat = gameState.combat;
      
      onGameStateChange({
        ...updatedState,
        combat: {
          ...currentCombat,
          currentTurn: currentCombat.currentTurn - 1,
          initiativeSide: currentCombat.initiativeSide === 'party' ? 'enemies' : 'party',
          positions: clearMovementArrows(currentCombat.positions || {})
        }
      });
    },

    // Battle map actions
    initializePosition: (actorId: string, isCharacter: boolean) => {
      if (isRoomCreator) {
        return dmActions?.initializePositionDirect(actorId, isCharacter);
      }
      return sendInitPosition({ actorId, isCharacter });
    },

    movePiece: (actorId: string, position: BattleMapPosition) => {
      if (isRoomCreator) {
        return dmActions?.movePieceDirect(actorId, position);
      }
      return sendRequestMove({ actorId, position, playerId: selfId });
    },

    requestMove: (actorId: string, position: BattleMapPosition) => {
      return sendRequestMove({ actorId, position, playerId: selfId });
    },

    clearPositions: () => {
      if (!isRoomCreator) return;
      return dmActions?.clearPositionsDirect();
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
      previousTurn: () => {},
      initializePosition: () => {},
      movePiece: () => {},
      requestMove: () => {},
      clearPositions: () => {}
    };
  }

  return setupCombatActions(
    room,
    gameState,
    onGameStateChange,
    isRoomCreator,
    DEFAULT_CHARACTER_POSITIONS,
    DEFAULT_ENTITY_POSITIONS
  );
}