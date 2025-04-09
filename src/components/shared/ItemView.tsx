import React, { useState, useEffect } from 'react';
import type { Room } from 'trystero/nostr';
import { Item, GameState, Character } from '../../types/game';
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


interface ItemViewProps {
  item: Item;
  inventorySlotIndex?: number;
  equipmentIndex?: number;
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
    item: initialItem,
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
  const [item, setItem] = useState(initialItem);
  const [customUses, setCustomUses] = useState<number | undefined>(undefined);

  // New transfer-related state
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showTransferWait, setShowTransferWait] = useState(false);
  const [transferRecipientName, setTransferRecipientName] = useState<string>('');

  const itemActions = useItemActions(room, gameState, onGameStateChange, isRoomCreator);
  const equipmentActions = useEquipmentActions(room, gameState, onGameStateChange, isRoomCreator);
  const transferActions = useTransferActions(room, gameState, onGameStateChange, isRoomCreator);


  const isViewingFromCatalog = !actorId && inventorySlotIndex === undefined;
  const canEditItem = isRoomCreator && isViewingFromCatalog;


    // Get available actions for QuarterCircleMenu
    const getAvailableActions = (): ActionType[] => {
      const actions: ActionType[] = [];
    
      if (canEditItem) {
        actions.push('edit', 'delete');
      }
    
      if (actorId) {
        // Add use action if item has uses, regardless of equipped status
        if (item.uses !== undefined && (item.usesLeft === undefined || item.usesLeft > 0)) {
          actions.push('use');
        }
    
        if (isEquipped) {
          actions.push('unequip');
        } else {
          if (item.isEquippable && actorType === 'character') {
            actions.push('equip');
          }
          if (actorType === 'character' && !isRoomCreator) {
            actions.push('transfer');
          }
          actions.push('discard');
        }
      }
    
      return actions;
    };

  // Handle menu actions
  const handleMenuAction = (action: ActionType) => {
    switch (action) {
      case 'edit':
        setShowEditor(true);
        break;
      case 'delete':
        setConfirmDelete(true);
        break;
      case 'use':
        handleUse();
        break;
      case 'equip':
        handleEquip();
        break;
      case 'unequip':
        handleUnequip();
        break;
      case 'transfer':
        setShowTransferModal(true);
        break;
      case 'discard':
        handleDiscard();
        break;
    }
  };

  const determineActorType = (actorId: string): 'character' | 'globalEntity' | 'fieldEntity' | undefined => {
    if (gameState.party.some(c => c.id === actorId)) {
      return 'character';
    }
    if (gameState.globalCollections.entities.some(e => e.id === actorId)) {
      return 'globalEntity';
    }
    if (gameState.field.some(e => e.id === actorId)) {
      return 'fieldEntity';
    }
    return undefined;
  };

  useEffect(() => {
    // Force refresh of the view when gameState changes
    const slot = getCurrentSlot();
    if (slot) {
      setItem(slot[0]);
    }
  }, [gameState]);

  // Get current inventory slot if viewing from inventory
  const getCurrentSlot = () => {
    if (!actorId || (inventorySlotIndex === undefined && !isEquipped) || !actorType) return undefined;
  
    const actor = actorType === 'character'
      ? gameState.party.find(c => c.id === actorId)
      : actorType === 'globalEntity'
      ? gameState.globalCollections.entities.find(e => e.id === actorId)
      : gameState.field.find(e => e.id === actorId);

    if (!actor) return undefined;
    
    if (isEquipped && actorType === 'character') {
      const characterActor = actor as Character;
      return equipmentIndex !== undefined ? [characterActor.equipment[equipmentIndex], 1] as [Item, number] : undefined;
    }
    
    return actor.inventory[inventorySlotIndex!];
  };

  useEffect(() => {
    const slot = getCurrentSlot();
    if (slot) {
      setItem(slot[0]);
    } else if (!actorId) {
      const catalogItem = gameState.globalCollections.items.find(i => i.id === item.id);
      if (catalogItem) {
        setItem(catalogItem);
      }
    }
  }, [gameState, item.id, actorId, actorType, inventorySlotIndex, isEquipped, equipmentIndex]);

  const handleUse = async () => {
    if (!actorId || !itemActions) return;
    
    const type = actorType || determineActorType(actorId);
    if (!type) return;
  
    try {
      // If item is equipped, use the equipment index, otherwise use inventory index
      const slotIndex = isEquipped ? equipmentIndex! : inventorySlotIndex!;
      await itemActions.useItem(item.id, actorId, type, slotIndex, isEquipped);
      
      if (item.uses !== undefined && item.usesLeft !== undefined && item.usesLeft <= 1) {
        onClose?.();
      }
    } catch (error) {
      console.error('Failed to use item:', error);
    }
  };

  const handleEquip = async () => {
    if (!actorId || !itemActions || inventorySlotIndex === undefined || !actorType) return;
    if (actorType !== 'character') return;

    try {
      await itemActions.equipItem(item.id, actorId, actorType, inventorySlotIndex);
      onClose?.();
    } catch (error) {
      console.error('Failed to equip item:', error);
    }
  };

  const handleUnequip = async () => {
    if (!actorId || !equipmentActions) return;
    
    try {
      await equipmentActions.unequipItem(actorId, equipmentIndex!, item.id);
      onClose?.();
    } catch (error) {
      console.error('Failed to unequip item:', error);
    }
  };

  const handleDiscard = async () => {
    if (!actorId || !itemActions || inventorySlotIndex === undefined) return;
    
    const type = actorType || determineActorType(actorId);
    if (!type) return;
  
    try {
      await itemActions.discardItem(item.id, actorId, type, inventorySlotIndex);
      onClose?.();
    } catch (error) {
      console.error('Failed to discard item:', error);
    }
  };

  const handleDelete = async () => {
    if (!isRoomCreator || !itemActions?.deleteItem) return;
    try {
      await itemActions.deleteItem(item.id);
      onClose?.();
    } catch (error) {
      console.error('Failed to delete item:', error);
    }
  };

  const handleUpdate = async (updates: Omit<Item, 'id'>) => {
    if (!itemActions?.updateItem) return;
    try {
      await itemActions.updateItem(item.id, updates);
      setShowEditor(false);
    } catch (error) {
      console.error('Failed to update item:', error);
    }
  };

  const handleRestoreUses = async () => {
    if (!isRoomCreator || !itemActions?.restoreItemUses || inventorySlotIndex === undefined || !actorId) return;
    if (item.uses === undefined) return;
  
    const type = actorType || determineActorType(actorId);
    if (!type) return;
  
    const newUses = customUses !== undefined ? customUses : item.uses;
    await itemActions.restoreItemUses(item.id, actorId, type, inventorySlotIndex, newUses);
    setCustomUses(undefined);
  };
  
  const handleIncreaseUses = async () => {
    if (!isRoomCreator || !itemActions?.restoreItemUses || inventorySlotIndex === undefined || !actorId) return;
    if (item.uses === undefined || item.usesLeft === undefined) return;
  
    const type = actorType || determineActorType(actorId);
    if (!type) return;
  
    const newUses = Math.min(item.uses, item.usesLeft + 1);
    await itemActions.restoreItemUses(item.id, actorId, type, inventorySlotIndex, newUses);
  };
  
  const handleDecreaseUses = async () => {
    if (!isRoomCreator || !itemActions?.restoreItemUses || inventorySlotIndex === undefined || !actorId) return;
    if (item.usesLeft === undefined) return;
  
    const type = actorType || determineActorType(actorId);
    if (!type) return;
  
    const newUses = Math.max(0, item.usesLeft - 1);
    await itemActions.restoreItemUses(item.id, actorId, type, inventorySlotIndex, newUses);
  };

  // New transfer handlers
  const handleTransferInitiate = (recipientId: string, recipientType: 'character' | 'fieldEntity') => {
    if (!actorId || !transferActions || inventorySlotIndex === undefined) return;
    
    const recipient = recipientType === 'character'
      ? gameState.party.find(c => c.id === recipientId)
      : gameState.field.find(e => e.id === recipientId);

    if (!recipient) return;
    
    setTransferRecipientName(recipient.name);
    setShowTransferModal(false);
    setShowTransferWait(true);

    transferActions.requestTransfer(
      item.id,
      actorId,
      recipientId,
      recipientType,
      inventorySlotIndex
    );
  };

  const handleTransferCancel = () => {
    if (!transferActions) return;
    setShowTransferWait(false);
    // Add transfer cancellation logic here when implemented
  };

  // Filter out the current character from transfer recipients
  const availableParty = gameState.party.filter(c => c.id !== actorId);

  return (
    <div className="flex flex-col h-full w-full gap-2 p-0">
      
      {/* Uses and Tags Section */}
      <div className="grid grid-cols-2 gap-4 items-center">
        {/* Uses Section */}
        <div className="flex items-center gap-2">
          <div className="font-['Mohave'] text-lg">
            {item.uses !== undefined ? (
              <span>Uses: {item.usesLeft ?? item.uses} / {item.uses}</span>
            ) : (
              <span>Unlimited Uses</span>
            )}
          </div>
          
          {isRoomCreator && inventorySlotIndex !== undefined && item.uses !== undefined && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleDecreaseUses()}
                className="p-1 rounded-full hover:bg-grey/10 dark:hover:bg-offwhite/10"
                title="Decrease uses"
              >
                <Minus size={16} />
              </button>
              
              <input
                type="number"
                value={customUses ?? ''}
                onChange={e => setCustomUses(e.target.value ? Number(e.target.value) : undefined)}
                placeholder={item.uses.toString()}
                className="w-16 px-2 py-1 rounded border dark:bg-grey font-['Mohave']"
              />
              
              <button
                onClick={() => handleRestoreUses()}
                className="p-1 rounded-full hover:bg-grey/10 dark:hover:bg-offwhite/10"
                title="Set uses"
              >
                <RefreshCw size={16} />
              </button>

              <button
                onClick={() => handleIncreaseUses()}
                className="p-1 rounded-full hover:bg-grey/10 dark:hover:bg-offwhite/10"
                title="Increase uses"
              >
                <Plus size={16} />
              </button>
            </div>
          )}
        </div>

        

        {/* Tags Section */}
        <div className="flex flex-wrap gap-2 justify-end items-center">
          {item.tags?.map(tag => (
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
          imageId={item.image}
          size="size=lg 3xl:size=xl"
        />
      </div>

      {/* Description Section */}
      <div className="border-2 border-grey dark:border-offwhite rounded-lg p-2 min-h-[6rem] max-h-[7rem] overflow-y-auto">
        <p className="font-['Mohave'] text-md 2xl:text-lg text-left leading-relaxed">
          {item.description}
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
      {showEditor && (
        <Modal
          isOpen={showEditor}
          onClose={() => setShowEditor(false)}
          title="Edit Item"
        >
          <ItemEditor
            item={item}
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
        onTransfer={handleTransferInitiate}
      />

      <TransferWaitScreen
        isOpen={showTransferWait}
        onCancel={handleTransferCancel}
        item={item}
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
                className="px-3 py-1 bg-gray-500 text-white rounded-md hover:bg-gray-600 
                         transition-colors font-['Mohave']"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-1 bg-red-500 text-white rounded-md hover:bg-red-600 
                         transition-colors font-['Mohave']"
              >
                Delete
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}