// src/components/DungeonMaster/handlers/setupItemHandlers.ts

import type { Room } from 'trystero/nostr';
import type { GameState, Character, ItemReference } from '../../../types/game';
import { getCatalogItem } from '../../../utils/referenceHelpers';

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
  isEquipped?: boolean;
}

export function setupItemHandlers(
  room: Room,
  gameState: GameState,
  onGameStateChange: (newState: GameState) => void
) {
  // Handle item use requests from players
  const [_, getItemUse] = room.makeAction<ItemActionPayload>(ItemActions.USE);
  getItemUse(({ itemId, actorId, actorType, slotIndex, isEquipped }) => {
    console.log('DM received item use request:', { itemId, actorId, actorType, slotIndex, isEquipped });
    
    // Find actor based on type
    let actor: any = null;
    if (actorType === 'character') {
      actor = gameState.party.find(c => c.id === actorId);
    } else if (actorType === 'globalEntity') {
      actor = gameState.globalCollections.entities.find(e => e.id === actorId);
    } else {
      // ✅ FIXED: For field entities, use instanceId instead of catalogId
      actor = gameState.field.find(e => e.instanceId === actorId);
    }

    if (!actor) {
      console.error('Actor not found:', { actorId, actorType });
      return;
    }

    // Handle equipped items
    if (isEquipped && actorType === 'character') {
      const character = actor as Character;
      const equippedItemRef = character.equipment[slotIndex];
      if (!equippedItemRef) {
        console.error('Equipment slot not found:', { slotIndex });
        return;
      }

      const catalogItem = getCatalogItem(equippedItemRef.catalogId, gameState);
      if (!catalogItem?.uses) {
        console.error('Item cannot be used (infinite uses or not usable)');
        return;
      }

      const usesLeft = equippedItemRef.usesLeft ?? catalogItem.uses;
      if (usesLeft <= 0) {
        console.error('No uses left');
        return;
      }

      const newUsesLeft = usesLeft - 1;

      onGameStateChange({
        ...gameState,
        party: gameState.party.map(char =>
          char.id === actorId ? {
            ...char,
            equipment: char.equipment.map((itemRef, index) =>
              index === slotIndex ? { ...itemRef, usesLeft: newUsesLeft } : itemRef
            )
          } : char
        )
      });
      return;
    }

    // Handle inventory items
    const itemSlot = actor.inventory[slotIndex];
    if (!itemSlot) {
      console.error('Item slot not found:', { slotIndex });
      return;
    }

    const [itemRef, count] = itemSlot;
    const catalogItem = getCatalogItem(itemRef.catalogId, gameState);
    
    if (!catalogItem?.uses) {
      console.error('Item cannot be used (infinite uses or not usable)');
      return;
    }

    const usesLeft = itemRef.usesLeft ?? catalogItem.uses;
    if (usesLeft <= 0) {
      console.error('No uses left');
      return;
    }

    const newUsesLeft = usesLeft - 1;

    // Update the appropriate collection based on actor type
    const newState = { ...gameState };

    if (actorType === 'character') {
      newState.party = gameState.party.map(char =>
        char.id === actorId ? {
          ...char,
          inventory: char.inventory.map((slot, index) =>
            index === slotIndex ? [{ ...itemRef, usesLeft: newUsesLeft }, count] : slot
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
              index === slotIndex ? [{ ...itemRef, usesLeft: newUsesLeft }, count] : slot
            )
          } : entity
        )
      };
    } else {
      // ✅ FIXED: Use instanceId for field entity updates
      newState.field = gameState.field.map(entityRef =>
        entityRef.instanceId === actorId ? {
          ...entityRef,
          inventory: entityRef.inventory.map((slot, index) =>
            index === slotIndex ? [{ ...itemRef, usesLeft: newUsesLeft }, count] : slot
          )
        } : entityRef
      );
    }

    onGameStateChange(newState);
  });

  // Handle item equip requests from players
  const [__, getItemEquip] = room.makeAction<ItemActionPayload>(ItemActions.EQUIP);
  getItemEquip(({ itemId, actorId, actorType, slotIndex }) => {
    console.log('DM received item equip request:', { itemId, actorId, actorType, slotIndex });
    
    if (actorType !== 'character') {
      console.error('Only characters can equip items');
      return;
    }

    const character = gameState.party.find(c => c.id === actorId);
    if (!character) {
      console.error('Character not found:', actorId);
      return;
    }

    const itemSlot = character.inventory[slotIndex];
    if (!itemSlot) {
      console.error('Item slot not found:', slotIndex);
      return;
    }

    const [itemRef, count] = itemSlot;
    const catalogItem = getCatalogItem(itemRef.catalogId, gameState);
    
    if (!catalogItem?.isEquippable) {
      console.error('Item is not equippable');
      return;
    }

    onGameStateChange({
      ...gameState,
      party: gameState.party.map(char =>
        char.id === actorId ? {
          ...char,
          inventory: char.inventory.filter((_, index) => index !== slotIndex),
          equipment: [...char.equipment, itemRef]
        } : char
      )
    });
  });

  // Handle item discard requests from players
  const [___, getItemDiscard] = room.makeAction<ItemActionPayload>(ItemActions.DISCARD);
  getItemDiscard(({ itemId, actorId, actorType, slotIndex }) => {
    console.log('DM received item discard request:', { itemId, actorId, actorType, slotIndex });
    
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
      // ✅ FIXED: Use instanceId for field entity updates
      newState.field = gameState.field.map(entityRef =>
        entityRef.instanceId === actorId ? {
          ...entityRef,
          inventory: entityRef.inventory.filter((_, index) => index !== slotIndex)
        } : entityRef
      );
    }

    onGameStateChange(newState);
  });
}