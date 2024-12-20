import type { Room } from 'trystero/nostr';
import type { GameState, Item } from '../../../types/game';

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

    // Get the item being unequipped
    const equippedItem = character.equipment[equipmentIndex];
    if (!equippedItem) {
      console.error('Equipment slot not found:', equipmentIndex);
      return;
    }

    // Create a new inventory slot for the unequipped item
    // Note: We always create a new slot even if there's an identical item
    // in the inventory to preserve item instances
    const newInventorySlot: [Item, number] = [{ ...equippedItem }, 1];

    // Update the game state
    onGameStateChange({
      ...gameState,
      party: gameState.party.map(char => {
        if (char.id !== characterId) return char;

        return {
          ...char,
          // Remove the item from equipment
          equipment: char.equipment.filter((_, index) => index !== equipmentIndex),
          // Add the item to inventory as a new slot
          inventory: [...char.inventory, newInventorySlot]
        };
      })
    });
  });
}