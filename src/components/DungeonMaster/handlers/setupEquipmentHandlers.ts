// src/components/DungeonMaster/handlers/setupEquipmentHandlers.ts

import type { Room } from 'trystero/nostr';
import type { GameState, ItemReference, InventorySlot } from '../../../types/game';

// These must be 12 bytes or less for Trystero
export const EquipmentActions = {
  UNEQUIP: 'equipUnequip'
} as const;

interface EquipmentActionPayload {
  itemId: string;
  characterId: string;
  equipmentIndex: number;
}

export function setupEquipmentHandlers(
  room: Room,
  gameState: GameState,
  onGameStateChange: (newState: GameState) => void
) {
  // Handle unequip requests from players
  const [_, getUnequip] = room.makeAction<EquipmentActionPayload>(EquipmentActions.UNEQUIP);
  getUnequip(({ itemId, characterId, equipmentIndex }) => {
    console.log('DM received unequip request:', { itemId, characterId, equipmentIndex });
    
    // Find the character
    const character = gameState.party.find(c => c.id === characterId);
    if (!character) {
      console.error('Character not found:', characterId);
      return;
    }

    // Get the item reference being unequipped
    const equippedItemRef = character.equipment[equipmentIndex];
    if (!equippedItemRef) {
      console.error('Equipment slot not found:', equipmentIndex);
      return;
    }

    // Create a new inventory slot for the unequipped item reference
    // We preserve the ItemReference with its current usesLeft value
    const newInventorySlot: InventorySlot = [{ ...equippedItemRef }, 1];

    // Update the game state
    onGameStateChange({
      ...gameState,
      party: gameState.party.map(char => {
        if (char.id !== characterId) return char;

        return {
          ...char,
          // Remove the item reference from equipment
          equipment: char.equipment.filter((_, index) => index !== equipmentIndex),
          // Add the item reference to inventory as a new slot
          inventory: [...char.inventory, newInventorySlot]
        };
      })
    });
  });
}