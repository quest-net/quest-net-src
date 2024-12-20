import type { Room } from 'trystero/nostr';
import type { Item, GameState, InventorySlot } from '../types/game';
import { selfId } from 'trystero';
import { ItemActions } from '../components/DungeonMaster/handlers/setupItemHandlers';

const DM_ACTIONS = {
  RESTORE: 'itemRestore'  // DM-only action
} as const;

interface ItemRestorePayload {
  itemId: string;
  actorId: string;
  actorType: 'character' | 'globalEntity' | 'fieldEntity';
  slotIndex: number;
  newUsesLeft: number;
}

export function setupItemActions(
  room: Room,
  gameState: GameState,
  onGameStateChange: (newState: GameState) => void,
  isRoomCreator: boolean
) {
  // Set up action senders
  const [sendItemUse] = room.makeAction(ItemActions.USE);
  const [sendItemEquip] = room.makeAction(ItemActions.EQUIP);
  const [sendItemDiscard] = room.makeAction(ItemActions.DISCARD);
  const [sendItemRestore] = room.makeAction(DM_ACTIONS.RESTORE);


  // DM-only actions for direct state modification
  const dmActions = isRoomCreator ? {
    // For creating new items in the global catalog
    createItem: (item: Omit<Item, 'id'>) => {
      const newId = crypto.randomUUID();
      onGameStateChange({
        ...gameState,
        globalCollections: {
          ...gameState.globalCollections,
          items: [...gameState.globalCollections.items, { ...item, id: newId }]
        }
      });
      return newId;
    },

    // For updating items in the catalog
    updateItem: (id: string, updates: Partial<Item>) => {
      onGameStateChange({
        ...gameState,
        globalCollections: {
          ...gameState.globalCollections,
          items: gameState.globalCollections.items.map(item =>
            item.id === id ? { ...item, ...updates } : item
          )
        }
      });
    },

    // For deleting items from the catalog and all inventories
    deleteItem: (id: string) => {
      onGameStateChange({
        ...gameState,
        globalCollections: {
          ...gameState.globalCollections,
          items: gameState.globalCollections.items.filter(item => item.id !== id)
        },
        party: gameState.party.map(char => ({
          ...char,
          inventory: char.inventory.filter(([item]) => item.id !== id),
          equipment: char.equipment.filter(item => item.id !== id)
        }))
      });
    },

    // For DM to directly modify inventory without going through action system
    useItemDirect: (actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity', slotIndex: number) => {
      const actor = actorType === 'character'
        ? gameState.party.find(c => c.id === actorId)
        : actorType === 'globalEntity'
        ? gameState.globalCollections.entities.find(e => e.id === actorId)
        : gameState.field.find(e => e.id === actorId);

      if (!actor) return false;

      const itemSlot = actor.inventory[slotIndex];
      if (!itemSlot?.[0].usesLeft) return false;

      const [item] = itemSlot;
      const newUsesLeft = item.usesLeft! - 1;
      if (newUsesLeft < 0) return false;

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
        newState.globalCollections.entities = gameState.globalCollections.entities.map(entity =>
          entity.id === actorId ? {
            ...entity,
            inventory: entity.inventory.map((slot, index) =>
              index === slotIndex ? [{ ...slot[0], usesLeft: newUsesLeft }, slot[1]] : slot
            )
          } : entity
        );
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
      return true;
    },

    equipItemDirect: (actorId: string, slotIndex: number) => {
      const character = gameState.party.find(c => c.id === actorId);
      if (!character) return false;

      const itemSlot = character.inventory[slotIndex];
      if (!itemSlot?.[0].isEquippable) return false;

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
      return true;
    },

    discardItemDirect: (actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity', slotIndex: number) => {
      const newState = { ...gameState };

      if (actorType === 'character') {
        newState.party = gameState.party.map(char =>
          char.id === actorId ? {
            ...char,
            inventory: char.inventory.filter((_, index) => index !== slotIndex)
          } : char
        );
      } else if (actorType === 'globalEntity') {
        newState.globalCollections.entities = gameState.globalCollections.entities.map(entity =>
          entity.id === actorId ? {
            ...entity,
            inventory: entity.inventory.filter((_, index) => index !== slotIndex)
          } : entity
        );
      } else {
        newState.field = gameState.field.map(entity =>
          entity.id === actorId ? {
            ...entity,
            inventory: entity.inventory.filter((_, index) => index !== slotIndex)
          } : entity
        );
      }

      onGameStateChange(newState);
      return true;
    },

    // For DM to give items to actors
    giveItem: (itemId: string, targetActorId: string, targetActorType: 'character' | 'globalEntity' | 'fieldEntity', amount: number = 1) => {
      const item = gameState.globalCollections.items.find(i => i.id === itemId);
      if (!item) return false;

      const newState = { ...gameState };
      
      // Helper function to add item to actor
      const addItemToActor = (actor: any) => {
        if (!item.uses && !item.isEquippable) {
          // Stackable items
          const existingSlot = actor.inventory.find(([existingItem]: any) => existingItem.id === item.id);
          if (existingSlot) {
            actor.inventory = actor.inventory.map(([slotItem, count]: any) =>
              slotItem.id === item.id ? [slotItem, count + amount] : [slotItem, count]
            );
          } else {
            actor.inventory = [...actor.inventory, [item, amount] as InventorySlot];
          }
        } else {
          // Non-stackable items (create separate slots)
          const newSlots: InventorySlot[] = Array(amount).fill(null).map(() => [
            { ...item, usesLeft: item.uses },
            1
          ]);
          actor.inventory = [...actor.inventory, ...newSlots];
        }
      };

      // Update the appropriate collection
      if (targetActorType === 'character') {
        newState.party = newState.party.map(char => {
          if (char.id === targetActorId) {
            addItemToActor(char);
          }
          return char;
        });
      } else if (targetActorType === 'globalEntity') {
        newState.globalCollections.entities = newState.globalCollections.entities.map(entity => {
          if (entity.id === targetActorId) {
            addItemToActor(entity);
          }
          return entity;
        });
      } else {
        newState.field = newState.field.map(entity => {
          if (entity.id === targetActorId) {
            addItemToActor(entity);
          }
          return entity;
        });
      }

      onGameStateChange(newState);
      return true;
    },
    restoreItemUsesDirect: (actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity', slotIndex: number, newUsesLeft: number) => {
      const actor = actorType === 'character'
        ? gameState.party.find(c => c.id === actorId)
        : actorType === 'globalEntity'
        ? gameState.globalCollections.entities.find(e => e.id === actorId)
        : gameState.field.find(e => e.id === actorId);

      if (!actor) return false;

      const itemSlot = actor.inventory[slotIndex];
      if (!itemSlot?.[0].uses) return false;

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
        newState.globalCollections.entities = gameState.globalCollections.entities.map(entity =>
          entity.id === actorId ? {
            ...entity,
            inventory: entity.inventory.map((slot, index) =>
              index === slotIndex ? [{ ...slot[0], usesLeft: newUsesLeft }, slot[1]] : slot
            )
          } : entity
        );
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
      return true;
    }
  } : undefined;

  // Actions available to both DM and players
  return {
    ...dmActions,

    useItem: (itemId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity', slotIndex: number) => {
      if (isRoomCreator) {
        return dmActions?.useItemDirect(actorId, actorType, slotIndex);
      }
      return sendItemUse({ itemId, actorId, actorType, slotIndex });
    },

    equipItem: (itemId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity', slotIndex: number) => {
      if (isRoomCreator) {
        return dmActions?.equipItemDirect(actorId, slotIndex);
      }
      return sendItemEquip({ itemId, actorId, actorType, slotIndex });
    },

    discardItem: (itemId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity', slotIndex: number) => {
      if (isRoomCreator) {
        return dmActions?.discardItemDirect(actorId, actorType, slotIndex);
      }
      return sendItemDiscard({ itemId, actorId, actorType, slotIndex });
    },
    restoreItemUses: (itemId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity', slotIndex: number, newUsesLeft: number) => {
      if (!isRoomCreator) return Promise.resolve(false);
      
      if (isRoomCreator) {
        return dmActions?.restoreItemUsesDirect(actorId, actorType, slotIndex, newUsesLeft);
      }
      return sendItemRestore({ itemId, actorId, actorType, slotIndex, newUsesLeft });
    }
  };
}

export function useItemActions(
  room: Room | undefined,
  gameState: GameState,
  onGameStateChange: (newState: GameState) => void,
  isRoomCreator: boolean
) {
  if (!room) return;
  return setupItemActions(room, gameState, onGameStateChange, isRoomCreator);
}