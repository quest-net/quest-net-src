// src/actions/equipmentActions.ts

import type { Room } from 'trystero/nostr';
import type { GameState, InventorySlot, ItemReference } from '../types/game';
import { selfId } from 'trystero';
import { EquipmentActions } from '../components/DungeonMaster/handlers/setupEquipmentHandlers';

export function setupEquipmentActions(
  room: Room,
  gameState: GameState,
  onGameStateChange: (newState: GameState) => void,
  isRoomCreator: boolean
) {
  // Set up action sender
  const [sendUnequip] = room.makeAction(EquipmentActions.UNEQUIP);

  // DM-only actions
  const dmActions = isRoomCreator ? {
    unequipDirect: (characterId: string, equipmentIndex: number) => {
      const character = gameState.party.find(c => c.id === characterId);
      if (!character) return false;

      const equippedItemRef = character.equipment[equipmentIndex];
      if (!equippedItemRef) return false;

      // Create new inventory slot for the unequipped item reference
      // We preserve the ItemReference with its current usesLeft value
      const newInventorySlot: InventorySlot = [{ ...equippedItemRef }, 1];

      onGameStateChange({
        ...gameState,
        party: gameState.party.map(char => {
          if (char.id !== characterId) return char;

          return {
            ...char,
            equipment: char.equipment.filter((_, index) => index !== equipmentIndex),
            inventory: [...char.inventory, newInventorySlot]
          };
        })
      });
      return true;
    }
  } : undefined;

  // Actions available to both DM and players
  return {
    ...dmActions,

    // Player action: Unequip an item (sends P2P message with itemId for handler to process)
    unequipItem: (characterId: string, equipmentIndex: number, itemId: string) => {
      if (isRoomCreator) {
        return dmActions?.unequipDirect(characterId, equipmentIndex);
      }
      return sendUnequip({ characterId, equipmentIndex, itemId });
    }
  };
}

// Hook to use equipment actions
export function useEquipmentActions(
  room: Room | undefined,
  gameState: GameState,
  onGameStateChange: (newState: GameState) => void,
  isRoomCreator: boolean
) {
  if (!room) {
    return {
      unequipItem: () => Promise.resolve()
    };
  }

  return setupEquipmentActions(room, gameState, onGameStateChange, isRoomCreator);
}