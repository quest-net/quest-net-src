// src/components/DungeonMaster/handlers/setupCombatHandlers.ts

import type { Room } from 'trystero/nostr';
import type { GameState, BattleMapPosition } from '../../../types/game';
import { DEFAULT_CHARACTER_POSITIONS, DEFAULT_ENTITY_POSITIONS } from '../../../types/game';

// These must be 12 bytes or less for Trystero
export const CombatActions = {
  START: 'combatStart',
  END: 'combatEnd',
  NEXT_TURN: 'combatNext',
  PREV_TURN: 'combatPrev',
  REQUEST_MOVE: 'reqMove'
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

export function setupCombatHandlers(
  room: Room,
  gameState: GameState,
  onGameStateChange: (newState: GameState) => void
) {
  // Helper function to find available position
  const findAvailablePosition = (isCharacter: boolean): BattleMapPosition | null => {
    if (!gameState.combat) return null;

    const defaultPositions = isCharacter ? DEFAULT_CHARACTER_POSITIONS : DEFAULT_ENTITY_POSITIONS;
    const takenPositions = Object.values(gameState.combat.positions);

    // Try default positions first
    const availableDefaultPos = defaultPositions.find(pos =>
      !takenPositions.some(taken => taken.x === pos.x && taken.y === pos.y)
    );

    if (availableDefaultPos) return availableDefaultPos;

    // If all default positions are taken, find any available spot
    for (let x = 0; x < 63; x++) {
      for (let y = 0; y < 63; y++) {
        if (!takenPositions.some(pos => pos.x === x && pos.y === y)) {
          return { x, y };
        }
      }
    }

    return null;
  };

  // Handle move requests from players
  const [_, getMoveRequest] = room.makeAction<RequestMovePayload>(CombatActions.REQUEST_MOVE);
  getMoveRequest(({ actorId, position, playerId }) => {
    if (!gameState.combat?.isActive) return;

    // Verify player owns this character
    const character = gameState.party.find(c => c.id === actorId);
    if (!character || character.playerId !== playerId) {
      console.warn('Player tried to move character they don\'t own:', { playerId, actorId });
      return;
    }

    // Verify position is available
    const isPositionTaken = Object.entries(gameState.combat.positions)
      .some(([id, pos]) => id !== actorId && pos.x === position.x && pos.y === position.y);

    if (isPositionTaken) {
      console.warn('Position is already taken:', position);
      return;
    }

    // Store the current position as lastMoveFrom
    const currentPos = gameState.combat.positions[actorId];
    const newPosition = {
      ...position,
      lastMoveFrom: currentPos ? { x: currentPos.x, y: currentPos.y } : undefined
    };

    onGameStateChange({
      ...gameState,
      combat: {
        ...gameState.combat,
        positions: {
          ...gameState.combat.positions,
          [actorId]: newPosition
        }
      }
    });
  });

  // Handle combat start
  const [__, getCombatStart] = room.makeAction<{ initiativeSide: 'party' | 'enemies' }>(CombatActions.START);
  getCombatStart(({ initiativeSide }) => {
    // Initialize positions for all existing actors
    const positions: { [actorId: string]: BattleMapPosition } = {};

    // Place party members
    gameState.party.forEach(character => {
      const position = findAvailablePosition(true);
      if (position) {
        positions[character.id] = position;
      }
    });

    // Place field entities (now EntityReference objects)
    gameState.field.forEach(entityRef => {
      const position = findAvailablePosition(false);
      if (position) {
        // Use the entity reference's instanceId for combat positioning
        positions[entityRef.instanceId] = position;
      }
    });

    onGameStateChange({
      ...gameState,
      combat: {
        isActive: true,
        currentTurn: 1,
        initiativeSide,
        positions
      }
    });
  });

  // Handle combat end
  const [___, getCombatEnd] = room.makeAction(CombatActions.END);
  getCombatEnd(() => {
    onGameStateChange({
      ...gameState,
      combat: {
        isActive: false,
        currentTurn: 0,
        initiativeSide: 'party',
        positions: {}
      }
    });
  });

  // Handle next turn
  const [____, getNextTurn] = room.makeAction(CombatActions.NEXT_TURN);
  getNextTurn(() => {
    if (!gameState.combat?.isActive) return;

    onGameStateChange({
      ...gameState,
      combat: {
        ...gameState.combat,
        currentTurn: gameState.combat.currentTurn + 1,
        initiativeSide: gameState.combat.initiativeSide === 'party' ? 'enemies' : 'party',
        positions: clearMovementArrows(gameState.combat.positions || {})
      }
    });
  });

  // Handle previous turn
  const [_____, getPrevTurn] = room.makeAction(CombatActions.PREV_TURN);
  getPrevTurn(() => {
    if (!gameState.combat?.isActive || gameState.combat.currentTurn <= 1) return;

    onGameStateChange({
      ...gameState,
      combat: {
        ...gameState.combat,
        currentTurn: gameState.combat.currentTurn - 1,
        initiativeSide: gameState.combat.initiativeSide === 'party' ? 'enemies' : 'party',
        positions: clearMovementArrows(gameState.combat.positions || {})
      }
    });
  });
}