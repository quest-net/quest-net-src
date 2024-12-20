import type { Room } from 'trystero/nostr';
import type { GameState } from '../../../types/game';

// These must be 12 bytes or less for Trystero
export const ItemActions = {
  USE: 'itemUse',
  EQUIP: 'itemEquip',
  DISCARD: 'itemDiscard'
} as const;

interface ItemActionPayload {
  itemId: string;
  actorId: string;
  actorType: 'character' | 'globalEntity' | 'fieldEntity';
  slotIndex: number;
}

export function setupItemHandlers(
  room: Room,
  gameState: GameState,
  onGameStateChange: (newState: GameState) => void
) {
  // Handle item use requests from players
  const [_, getItemUse] = room.makeAction<ItemActionPayload>(ItemActions.USE);
  getItemUse(({ itemId, actorId, actorType, slotIndex }) => {
    console.log('DM received item use request:', { itemId, actorId, actorType, slotIndex });
    
    const actor = actorType === 'character'
      ? gameState.party.find(c => c.id === actorId)
      : actorType === 'globalEntity'
      ? gameState.globalCollections.entities.find(e => e.id === actorId)
      : gameState.field.find(e => e.id === actorId);

    if (!actor) {
      console.error('Actor not found:', { actorId, actorType });
      return;
    }

    const itemSlot = actor.inventory[slotIndex];
    if (!itemSlot?.[0].usesLeft) {
      console.error('Item slot or uses not found:', { itemSlot });
      return;
    }

    const [item] = itemSlot;
    const newUsesLeft = item.usesLeft! - 1;
    if (newUsesLeft < 0) {
      console.error('No uses left');
      return;
    }

    // Create new state with the update
    const newState = { ...gameState };

    if (actorType === 'character') {
      newState.party = gameState.party.map(char =>
        char.id === actorId ? {
          ...char,
          inventory: char.inventory.map((slot, index) =>
            index === slotIndex ? [{ ...slot[0], usesLeft: newUsesLeft }, slot[1]] : slot
          )
        } : char
      );
    } else if (actorType === 'globalEntity') {
      newState.globalCollections = {
        ...gameState.globalCollections,
        entities: gameState.globalCollections.entities.map(entity =>
          entity.id === actorId ? {
            ...entity,
            inventory: entity.inventory.map((slot, index) =>
              index === slotIndex ? [{ ...slot[0], usesLeft: newUsesLeft }, slot[1]] : slot
            )
          } : entity
        )
      };
    } else {
      newState.field = gameState.field.map(entity =>
        entity.id === actorId ? {
          ...entity,
          inventory: entity.inventory.map((slot, index) =>
            index === slotIndex ? [{ ...slot[0], usesLeft: newUsesLeft }, slot[1]] : slot
          )
        } : entity
      );
    }

    onGameStateChange(newState);
  });

  // Handle item equip requests from players
  const [__, getItemEquip] = room.makeAction<ItemActionPayload>(ItemActions.EQUIP);
  getItemEquip(({ itemId, actorId, actorType, slotIndex }) => {
    if (actorType !== 'character') return;

    const character = gameState.party.find(c => c.id === actorId);
    if (!character) return;

    const itemSlot = character.inventory[slotIndex];
    if (!itemSlot?.[0].isEquippable) return;

    onGameStateChange({
      ...gameState,
      party: gameState.party.map(char =>
        char.id === actorId ? {
          ...char,
          inventory: char.inventory.filter((_, index) => index !== slotIndex),
          equipment: [...char.equipment, itemSlot[0]]
        } : char
      )
    });
  });

  // Handle item discard requests from players
  const [___, getItemDiscard] = room.makeAction<ItemActionPayload>(ItemActions.DISCARD);
  getItemDiscard(({ itemId, actorId, actorType, slotIndex }) => {
    const newState = { ...gameState };

    if (actorType === 'character') {
      newState.party = gameState.party.map(char =>
        char.id === actorId ? {
          ...char,
          inventory: char.inventory.filter((_, index) => index !== slotIndex)
        } : char
      );
    } else if (actorType === 'globalEntity') {
      newState.globalCollections = {
        ...gameState.globalCollections,
        entities: gameState.globalCollections.entities.map(entity =>
          entity.id === actorId ? {
            ...entity,
            inventory: entity.inventory.filter((_, index) => index !== slotIndex)
          } : entity
        )
      };
    } else {
      newState.field = gameState.field.map(entity =>
        entity.id === actorId ? {
          ...entity,
          inventory: entity.inventory.filter((_, index) => index !== slotIndex)
        } : entity
      );
    }

    onGameStateChange(newState);
  });
}