import React, { useState, useEffect } from 'react';
import type { Room } from 'trystero/nostr';
import { Item, GameState, Character, ItemReference, EntityReference } from '../../types/game';
import BasicObjectView from '../ui/BasicObjectView';
import Modal from './Modal';
import { useItemActions } from '../../actions/itemActions';
import { useEquipmentActions } from '../../actions/equipmentActions';
import { useTransferActions } from '../../actions/transferActions';
import { ItemEditor } from '../DungeonMaster/ItemEditor';
import { Plus, Minus, RefreshCw } from 'lucide-react';
import TransferModal from './TransferModal';
import TransferWaitScreen from './TransferWaitScreen';
import GridMenu, { ActionType } from '../ui/GridMenu';
import { 
  getCatalogItem, 
  getCatalogEntity,
  getItemReferenceName, 
  getItemReferenceUsesLeft,
  itemReferenceHasUses,
  isValidItemReference 
} from '../../utils/referenceHelpers';

interface ItemViewProps {
  // Either catalog viewing OR instance viewing
  catalogId?: string;                    // For DM catalog mode
  itemReference?: ItemReference;         // For instance viewing
  inventorySlotIndex?: number;          // Required when itemReference provided for inventory items
  equipmentIndex?: number;              // Required when itemReference provided for equipped items
  isEquipped?: boolean;
  onClose?: () => void;
  isRoomCreator?: boolean;
  actorId?: string;
  actorType?: 'character' | 'globalEntity' | 'fieldEntity';
  room?: Room;
  gameState: GameState;
  onGameStateChange: (newState: GameState) => void;
}

export const ItemView: React.FC<ItemViewProps> = ({
  catalogId,
  itemReference: initialItemReference,
  inventorySlotIndex,
  equipmentIndex,
  isEquipped = false,
  onClose,
  isRoomCreator = false,
  actorId,
  actorType,
  room,
  gameState,
  onGameStateChange,
}) => {
  const [showEditor, setShowEditor] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [itemReference, setItemReference] = useState<ItemReference | null>(initialItemReference || null);
  const [customUses, setCustomUses] = useState<number | undefined>(undefined);

  // Transfer-related state
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showTransferWait, setShowTransferWait] = useState(false);
  const [transferRecipientName, setTransferRecipientName] = useState<string>('');

  const itemActions = useItemActions(room, gameState, onGameStateChange, isRoomCreator);
  const equipmentActions = useEquipmentActions(room, gameState, onGameStateChange, isRoomCreator);
  const transferActions = useTransferActions(room, gameState, onGameStateChange, isRoomCreator);

  // Determine which catalog ID to use for lookups
  const effectiveCatalogId = catalogId || itemReference?.catalogId;
  
  // Get catalog item for display data
  const catalogItem = effectiveCatalogId ? getCatalogItem(effectiveCatalogId, gameState) : null;
  
  // Context detection
  const isViewingFromCatalog = !!catalogId && !itemReference;
  const isViewingInstance = !!itemReference;

  // Instance-specific data (only available when viewing an instance)
  const instanceUsesLeft = itemReference ? getItemReferenceUsesLeft(itemReference, gameState) : undefined;
  const hasUses = itemReferenceHasUses(itemReference || { catalogId: effectiveCatalogId || '' }, gameState);

  // Keep itemReference state in sync with game state for instances
  useEffect(() => {
    if (!isViewingInstance || !actorId || !actorType) return;

    let updatedReference: ItemReference | undefined;

    if (inventorySlotIndex !== undefined) {
      // Update from inventory
      let actor: any;
      switch (actorType) {
        case 'character':
          actor = gameState.party.find(c => c.id === actorId);
          break;
        case 'globalEntity':
          actor = gameState.globalCollections.entities.find(e => e.id === actorId);
          break;
        case 'fieldEntity':
          actor = gameState.field.find(e => e.instanceId === actorId);
          break;
      }
      
      const inventorySlot = actor?.inventory?.[inventorySlotIndex];
      if (inventorySlot) {
        updatedReference = inventorySlot[0]; // First element is ItemReference
      }
    } else if (equipmentIndex !== undefined && actorType === 'character') {
      // Update from equipment
      const character = gameState.party.find(c => c.id === actorId);
      updatedReference = character?.equipment?.[equipmentIndex];
    }

    if (updatedReference && isValidItemReference(updatedReference, gameState)) {
      setItemReference(updatedReference);
    }
  }, [gameState, actorId, actorType, inventorySlotIndex, equipmentIndex, isViewingInstance]);

  // Validation - moved after hooks
  if (!effectiveCatalogId || !catalogItem) {
    return (
      <div className="p-4 text-center">
        <p className="text-red-500">Error: Invalid item reference or catalog ID</p>
        <button onClick={onClose} className="mt-2 px-4 py-2 bg-gray-500 text-white rounded">
          Close
        </button>
      </div>
    );
  }

  // Helper function to determine actorType if not provided
  const determineActorType = (actorId: string): 'character' | 'globalEntity' | 'fieldEntity' | null => {
    if (gameState.party.find(c => c.id === actorId)) return 'character';
    if (gameState.globalCollections.entities.find(e => e.id === actorId)) return 'globalEntity';
    if (gameState.field.find(e => e.instanceId === actorId)) return 'fieldEntity';
    return null;
  };

  // Get available actions for GridMenu
  const getAvailableActions = (): ActionType[] => {
    const actions: ActionType[] = [];

    if (isRoomCreator && isViewingFromCatalog) {
      actions.push('edit', 'delete');
    }

    if (isViewingInstance && actorId) {
      if (!hasUses || (instanceUsesLeft !== undefined && instanceUsesLeft > 0)) {
        actions.push('use');
      }

      if (isEquipped && equipmentIndex !== undefined) {
        actions.push('unequip');
      } else if (!isEquipped && inventorySlotIndex !== undefined) {
        if (catalogItem.isEquippable && actorType === 'character') {
          actions.push('equip');
        }
        actions.push('transfer', 'discard');
      }


    }

    return actions;
  };

  // Handle menu actions
  const handleMenuAction = async (action: ActionType) => {
    switch (action) {
      case 'use':
        await handleUse();
        break;
      case 'equip':
        await handleEquip();
        break;
      case 'unequip':
        await handleUnequip();
        break;
      case 'transfer':
        setShowTransferModal(true);
        break;
      case 'discard':
        await handleDiscard();
        break;
      case 'edit':
        setShowEditor(true);
        break;
      case 'delete':
        setConfirmDelete(true);
        break;
    }
  };

  // Action handlers - now using catalogId
  const handleUse = async () => {
    if (!itemActions?.useItem || !actorId) return;
    
    // ✅ FIXED: Allow usage from either inventory or equipment
    const slotIndex = isEquipped ? equipmentIndex : inventorySlotIndex;
    if (slotIndex === undefined) return;
    
    const type = actorType || determineActorType(actorId);
    if (!type) return;

    try {
      await itemActions.useItem(effectiveCatalogId, actorId, type, slotIndex, isEquipped);
    } catch (error) {
      console.error('Failed to use item:', error);
    }
  };

  const handleEquip = async () => {
    if (!itemActions?.equipItem || !actorId || inventorySlotIndex === undefined) return;
    const type = actorType || determineActorType(actorId);
    if (type !== 'character') return;

    try {
      await itemActions.equipItem(effectiveCatalogId, actorId, type, inventorySlotIndex);
    } catch (error) {
      console.error('Failed to equip item:', error);
    }
  };

  const handleUnequip = async () => {
    if (!equipmentActions?.unequipItem || !actorId || equipmentIndex === undefined) return;

    try {
      await equipmentActions.unequipItem(actorId, equipmentIndex, effectiveCatalogId);
    } catch (error) {
      console.error('Failed to unequip item:', error);
    }
  };

  const handleDiscard = async () => {
    if (!itemActions?.discardItem || !actorId || inventorySlotIndex === undefined) return;
    const type = actorType || determineActorType(actorId);
    if (!type) return;

    try {
      await itemActions.discardItem(effectiveCatalogId, actorId, type, inventorySlotIndex);
    } catch (error) {
      console.error('Failed to discard item:', error);
    }
  };

  const handleDelete = async () => {
    if (!isRoomCreator || !itemActions?.deleteItem) return;
    try {
      await itemActions.deleteItem(effectiveCatalogId);
      onClose?.();
    } catch (error) {
      console.error('Failed to delete item:', error);
    }
  };

  const handleUpdate = async (updates: Omit<Item, 'id'>) => {
    if (!itemActions?.updateItem) return;
    try {
      await itemActions.updateItem(effectiveCatalogId, updates);
      setShowEditor(false);
    } catch (error) {
      console.error('Failed to update item:', error);
    }
  };

  const handleRestoreUses = async () => {
    if (!isRoomCreator || !itemActions?.restoreItemUses) return;
    if (!hasUses) return;
    
    // ✅ FIXED: Allow restoration for both inventory and equipped items
    const slotIndex = isEquipped ? equipmentIndex : inventorySlotIndex;
    if (slotIndex === undefined || !actorId) return;
  
    const type = actorType || determineActorType(actorId);
    if (!type) return;
  
    const newUses = customUses !== undefined ? customUses : (catalogItem.uses ?? 0);
    await itemActions.restoreItemUses(effectiveCatalogId, actorId, type, slotIndex, newUses);
    setCustomUses(undefined);
  };
  
  const handleIncreaseUses = async () => {
    if (!isRoomCreator || !itemActions?.restoreItemUses) return;
    if (!hasUses || instanceUsesLeft === undefined) return;
    
    // ✅ FIXED: Allow use increase for both inventory and equipped items
    const slotIndex = isEquipped ? equipmentIndex : inventorySlotIndex;
    if (slotIndex === undefined || !actorId) return;
  
    const type = actorType || determineActorType(actorId);
    if (!type) return;
  
    const newUses = Math.min(catalogItem.uses || 0, instanceUsesLeft + 1);
    await itemActions.restoreItemUses(effectiveCatalogId, actorId, type, slotIndex, newUses);
  };
  
  const handleDecreaseUses = async () => {
    if (!isRoomCreator || !itemActions?.restoreItemUses) return;
    if (instanceUsesLeft === undefined) return;
    
    // ✅ FIXED: Allow use decrease for both inventory and equipped items
    const slotIndex = isEquipped ? equipmentIndex : inventorySlotIndex;
    if (slotIndex === undefined || !actorId) return;
  
    const type = actorType || determineActorType(actorId);
    if (!type) return;
  
    const newUses = Math.max(0, instanceUsesLeft - 1);
    await itemActions.restoreItemUses(effectiveCatalogId, actorId, type, slotIndex, newUses);
  };

  // Transfer handlers
  const handleTransferInitiate = (recipientId: string, recipientType: 'character' | 'fieldEntity') => {
    if (!actorId || !transferActions || inventorySlotIndex === undefined) return;
    
    const recipient = recipientType === 'character'
      ? gameState.party.find(c => c.id === recipientId)
      : gameState.field.find(e => e.instanceId === recipientId);
    
    if (!recipient) return;

    // Get recipient name - handle different types properly
    let recipientName: string;
    if (recipientType === 'character') {
      recipientName = (recipient as Character).name;
    } else {
      // For EntityReference, get name from catalog
      const entityRef = recipient as EntityReference;
      recipientName = getCatalogEntity(entityRef.catalogId, gameState)?.name || 'Unknown Entity';
    }

    setTransferRecipientName(recipientName);
    setShowTransferModal(false);
    
    // Check if recipient requires confirmation (has a playerId)
    const requiresConfirmation = recipientType === 'character' && 'playerId' in recipient && !!recipient.playerId;
    
    if (requiresConfirmation) {
      setShowTransferWait(true);
      transferActions.requestTransfer(effectiveCatalogId, actorId, recipientId, recipientType, inventorySlotIndex);
    } else {
      // Execute transfer immediately for NPCs/field entities
      if (transferActions.executeTransferDirect) {
        const transfer = {
          id: crypto.randomUUID(),
          itemId: effectiveCatalogId,
          fromId: actorId,
          toId: recipientId,
          toType: recipientType,
          inventorySlotIndex,
          requiresConfirmation: false,
          timestamp: Date.now()
        };
        transferActions.executeTransferDirect(transfer);
        onClose?.();
      }
    }
  };

  const handleTransferCancel = () => {
    setShowTransferWait(false);
    setTransferRecipientName('');
  };

  // Display data comes from catalog, instance data from reference
  const displayDescription = catalogItem.description;
  const displayImage = catalogItem.image;
  const displayTags = catalogItem.tags;
  const displayUses = catalogItem.uses;
  const displayUsesLeft = instanceUsesLeft ?? displayUses; // Instance first, then catalog default

  return (
    <div className="flex flex-col h-full w-full gap-2 p-0">
      {/* Uses and Tags Section */}
      <div className="grid grid-cols-2 gap-4 items-center">
        {/* Uses Section */}
        <div className="flex items-center gap-2">
          <div className="font-['Mohave'] text-lg">
            {hasUses ? (
              <span>Uses: {displayUsesLeft ?? '∞'}/{displayUses ?? '∞'}</span>
            ) : (
              <span>Uses: ∞</span>
            )}
            {isRoomCreator && isViewingInstance && <span className="ml-2 text-blue dark:text-cyan">(Instance)</span>}
            {isRoomCreator && isViewingFromCatalog && <span className="ml-2 text-blue dark:text-cyan">(Catalog)</span>}
          </div>
          
          {/* DM Usage Controls */}
          {isRoomCreator && hasUses && isViewingInstance && (
            <div className="flex items-center gap-1 ml-4">
              <button
                onClick={handleDecreaseUses}
                disabled={instanceUsesLeft === undefined || instanceUsesLeft <= 0}
                className="w-8 h-8 rounded-full bg-grey/20 dark:bg-offwhite/20 hover:bg-grey/40 dark:hover:bg-offwhite/40 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              
              <button
                onClick={handleIncreaseUses}
                disabled={instanceUsesLeft === undefined || instanceUsesLeft >= (catalogItem.uses || 0)}
                className="w-8 h-8 rounded-full bg-grey/20 dark:bg-offwhite/20 hover:bg-grey/40 dark:hover:bg-offwhite/40 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
              
              <button
                onClick={handleRestoreUses}
                className="w-8 h-8 rounded-full bg-grey/20 dark:bg-offwhite/20 hover:bg-grey/40 dark:hover:bg-offwhite/40 flex items-center justify-center transition-colors ml-2"
                title="Restore to full uses"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Tags Section */}
        <div className="flex flex-wrap gap-2 justify-end">
          {displayTags?.map(tag => (
            <span 
              key={tag}
              className="px-3 py-1 bg-grey/10 dark:bg-offwhite/10 rounded-full 
                       font-['Mohave'] text-sm"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Image Section */}
      <div className="flex justify-center items-center flex-grow">
        <BasicObjectView 
          name=""
          imageId={displayImage}
          size="size=lg 3xl:size=xl"
        />
      </div>

      {/* Description Section */}
      <div className="border-2 border-grey dark:border-offwhite rounded-lg p-2 min-h-[6rem] max-h-[7rem] overflow-y-auto">
        <p className="font-['Mohave'] text-md 2xl:text-lg text-left leading-relaxed">
          {displayDescription}
        </p>
      </div>

      {/* Grid Menu Section */}
      <div className="h-16 mb-4">
        <GridMenu
          onSelect={handleMenuAction}
          availableActions={getAvailableActions()}
        />
      </div>

      {/* Modals */}
      {showEditor && catalogItem && (
        <Modal
          isOpen={showEditor}
          onClose={() => setShowEditor(false)}
          title="Edit Item"
        >
          <ItemEditor
            item={catalogItem}
            onSubmit={handleUpdate}
            onCancel={() => setShowEditor(false)}
          />
        </Modal>
      )}

      <TransferModal
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        party={gameState.party.filter(c => c.id !== actorId)}
        field={gameState.field}
        gameState={gameState}
        onTransfer={handleTransferInitiate}
      />

      <TransferWaitScreen
        isOpen={showTransferWait}
        onCancel={handleTransferCancel}
        item={catalogItem}
        recipientName={transferRecipientName}
      />

      {confirmDelete && (
        <Modal
          isOpen={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title="Confirm Delete"
        >
          <div className="p-0">
            <p className="font-['Mohave']">
              Are you sure you want to delete this item? This cannot be undone and will remove it from all inventories.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};