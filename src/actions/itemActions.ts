// src/actions/itemActions.ts

import type { Room } from 'trystero/nostr';
import type { Item, GameState, InventorySlot, ItemReference, EntityReference } from '../types/game';
import { selfId } from 'trystero';
import { ItemActions } from '../components/DungeonMaster/handlers/setupItemHandlers';
import { createItemReference, getCatalogItem } from '../utils/referenceHelpers';

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
      return true;
    },

    // For deleting items from the catalog and all references
    deleteItem: (id: string) => {
      onGameStateChange({
        ...gameState,
        globalCollections: {
          ...gameState.globalCollections,
          items: gameState.globalCollections.items.filter(item => item.id !== id)
        },
        party: gameState.party.map(char => ({
          ...char,
          inventory: char.inventory.filter(([itemRef]) => itemRef.catalogId !== id),
          equipment: char.equipment.filter(itemRef => itemRef.catalogId !== id)
        })),
        field: gameState.field.map(entityRef => ({
          ...entityRef,
          inventory: entityRef.inventory.filter(([itemRef]) => itemRef.catalogId !== id)
        }))
      });
      return true;
    },

    // For DM to directly use items - handles uses and removal
    useItemDirect: (actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity', slotIndex: number, isEquipped: boolean = false) => {
      const newState = { ...gameState };

      if (actorType === 'character') {
        const character = gameState.party.find(c => c.id === actorId);
        if (!character) return false;

        const itemSlot = isEquipped ? null : character.inventory[slotIndex];
        const equipmentItem = isEquipped ? character.equipment[slotIndex] : null;
        
        if (!itemSlot && !equipmentItem) return false;

        const itemRef = itemSlot ? itemSlot[0] : equipmentItem!;
        const count = itemSlot ? itemSlot[1] : 1;
        const catalogItem = getCatalogItem(itemRef.catalogId, gameState);
        if (!catalogItem) return false;

        if (catalogItem.uses !== undefined) {
          const usesLeft = itemRef.usesLeft ?? catalogItem.uses;
          if (usesLeft <= 0) return false;

          const newUsesLeft = usesLeft - 1;
          
          if (isEquipped) {
            newState.party = gameState.party.map(char =>
              char.id === actorId ? {
                ...char,
                equipment: char.equipment.map((item, index) =>
                  index === slotIndex ? { ...itemRef, usesLeft: newUsesLeft } : item
                )
              } : char
            );
          } else {
            newState.party = gameState.party.map(char =>
              char.id === actorId ? {
                ...char,
                inventory: char.inventory.map((slot, index) =>
                  index === slotIndex ? [{ ...itemRef, usesLeft: newUsesLeft }, count] : slot
                )
              } : char
            );
          }
        }
      } else if (actorType === 'globalEntity') {
        const entity = gameState.globalCollections.entities.find(e => e.id === actorId);
        if (!entity) return false;

        const itemSlot = entity.inventory[slotIndex];
        if (!itemSlot) return false;

        const [itemRef, count] = itemSlot;
        const catalogItem = getCatalogItem(itemRef.catalogId, gameState);
        if (!catalogItem) return false;

        if (catalogItem.uses !== undefined) {
          const usesLeft = itemRef.usesLeft ?? catalogItem.uses;
          if (usesLeft <= 0) return false;

          const newUsesLeft = usesLeft - 1;
          
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
        }
      } else {
        // ✅ FIXED: Use instanceId for field entity lookup
        const entityRef = gameState.field.find(e => e.instanceId === actorId);
        if (!entityRef) return false;

        const itemSlot = entityRef.inventory[slotIndex];
        if (!itemSlot) return false;

        const [itemRef, count] = itemSlot;
        const catalogItem = getCatalogItem(itemRef.catalogId, gameState);
        if (!catalogItem) return false;

        if (catalogItem.uses !== undefined) {
          const usesLeft = itemRef.usesLeft ?? catalogItem.uses;
          if (usesLeft <= 0) return false;

          const newUsesLeft = usesLeft - 1;
          
          // ✅ FIXED: Always keep the item, just update uses left (can be 0)
          // ✅ FIXED: Use instanceId for field entity lookup
          newState.field = gameState.field.map(entityRef =>
            entityRef.instanceId === actorId ? {
              ...entityRef,
              inventory: entityRef.inventory.map((slot, index) =>
                index === slotIndex ? [{ ...itemRef, usesLeft: newUsesLeft }, count] : slot
              )
            } : entityRef
          );
        }
      }

      onGameStateChange(newState);
      return true;
    },

    restoreItemUsesDirect: (actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity', slotIndex: number, newUsesLeft: number) => {
      const newState = { ...gameState };

      if (actorType === 'character') {
        const character = gameState.party.find(c => c.id === actorId);
        if (!character) return false;

        const itemSlot = character.inventory[slotIndex];
        if (!itemSlot) return false;

        const [itemRef, count] = itemSlot;
        const catalogItem = getCatalogItem(itemRef.catalogId, gameState);
        if (!catalogItem?.uses) return false; // Can't restore infinite use items

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
                index === slotIndex ? [{ ...slot[0], usesLeft: newUsesLeft }, slot[1]] : slot
              )
            } : entity
          )
        };
      } else {
        // ✅ FIXED: Use instanceId for field entity lookup
        newState.field = gameState.field.map(entityRef =>
          entityRef.instanceId === actorId ? {
            ...entityRef,
            inventory: entityRef.inventory.map((slot, index) =>
              index === slotIndex ? [{ ...slot[0], usesLeft: newUsesLeft }, slot[1]] : slot
            )
          } : entityRef
        );
      }

      onGameStateChange(newState);
      return true;
    },

    equipItemDirect: (actorId: string, slotIndex: number) => {
      const character = gameState.party.find(c => c.id === actorId);
      if (!character) return false;

      const itemSlot = character.inventory[slotIndex];
      if (!itemSlot) return false;

      const [itemRef, count] = itemSlot;
      const catalogItem = getCatalogItem(itemRef.catalogId, gameState);
      if (!catalogItem?.isEquippable) return false;

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
        // ✅ FIXED: Use instanceId for field entity lookup
        newState.field = gameState.field.map(entityRef =>
          entityRef.instanceId === actorId ? {
            ...entityRef,
            inventory: entityRef.inventory.filter((_, index) => index !== slotIndex)
          } : entityRef
        );
      }

      onGameStateChange(newState);
      return true;
    },

    // For DM to give items to actors - creates ItemReference objects
    giveItem: (itemId: string, targetActorId: string, targetActorType: 'character' | 'globalEntity' | 'fieldEntity', amount: number = 1) => {
      const catalogItem = gameState.globalCollections.items.find(i => i.id === itemId);
      if (!catalogItem) return false;

      const newState = { ...gameState };
      
      // Helper function to add item reference to actor
      const addItemToActor = (actor: any) => {
        if (!catalogItem.uses && !catalogItem.isEquippable) {
          // Stackable items - check for existing reference to same catalog item
          const existingSlotIndex = actor.inventory.findIndex(([itemRef]: [ItemReference, number]) => 
            itemRef.catalogId === catalogItem.id
          );
          
          if (existingSlotIndex >= 0) {
            // Add to existing stack
            const [itemRef, count] = actor.inventory[existingSlotIndex];
            actor.inventory = actor.inventory.map((slot: InventorySlot, index: number) =>
              index === existingSlotIndex ? [itemRef, count + amount] : slot
            );
          } else {
            // Create new stack
            actor.inventory = [...actor.inventory, [createItemReference(catalogItem.id), amount] as InventorySlot];
          }
        } else {
          // Non-stackable items (create separate slots with usesLeft set)
          const newSlots: InventorySlot[] = Array(amount).fill(null).map(() => [
            createItemReference(catalogItem.id, catalogItem.uses),
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
        newState.globalCollections = {
          ...newState.globalCollections,
          entities: newState.globalCollections.entities.map(entity => {
            if (entity.id === targetActorId) {
              addItemToActor(entity);
            }
            return entity;
          })
        };
      } else {
        // ✅ FIXED: Use instanceId for field entity lookup instead of catalogId
        newState.field = newState.field.map(entityRef => {
          if (entityRef.instanceId === targetActorId) {
            addItemToActor(entityRef);
          }
          return entityRef;
        });
      }

      onGameStateChange(newState);
      return true;
    }
  } : undefined;

  // Actions available to both DM and players
  return {
    ...dmActions,

    // Player action: Use an item (sends P2P message with itemId for handler to process)
    useItem: (itemId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity', slotIndex: number, isEquipped: boolean) => {
      if (isRoomCreator) {
        return dmActions?.useItemDirect(actorId, actorType, slotIndex, isEquipped);
      }
      return sendItemUse({ itemId, actorId, actorType, slotIndex, isEquipped });
    },

    // Player action: Equip an item
    equipItem: (itemId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity', slotIndex: number) => {
      if (isRoomCreator) {
        return dmActions?.equipItemDirect(actorId, slotIndex);
      }
      return sendItemEquip({ itemId, actorId, actorType, slotIndex });
    },

    // Player action: Discard an item
    discardItem: (itemId: string, actorId: string, actorType: 'character' | 'globalEntity' | 'fieldEntity', slotIndex: number) => {
      if (isRoomCreator) {
        return dmActions?.discardItemDirect(actorId, actorType, slotIndex);
      }
      return sendItemDiscard({ itemId, actorId, actorType, slotIndex });
    },

    // DM action: Restore item uses
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