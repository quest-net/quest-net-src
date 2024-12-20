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
    if (!actorId || !itemActions || inventorySlotIndex === undefined) return;
    
    const type = actorType || determineActorType(actorId);
    if (!type) return;

    try {
      await itemActions.useItem(item.id, actorId, type, inventorySlotIndex);
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
    <div className="pr-4">
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <BasicObjectView 
            name={item.name}
            imageId={item.image}
            size="lg"
            className="mb-4"
          />
          
          <div className="prose dark:prose-invert max-w-none">
            <p>{item.description}</p>
          </div>

          <div className="mt-4 space-y-2">
            {item.uses !== undefined && (
              <div className="flex items-center gap-4">
                <div className="text-sm">
                  Uses: {item.usesLeft ?? item.uses} / {item.uses}
                </div>
                
                {isRoomCreator && inventorySlotIndex !== undefined && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleDecreaseUses}
                      className="p-1 rounded-full hover:bg-grey/10 dark:hover:bg-offwhite/10"
                      title="Decrease uses"
                    >
                      <Minus size={16} />
                    </button>
                    
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={customUses ?? ''}
                        onChange={e => setCustomUses(e.target.value ? Number(e.target.value) : undefined)}
                        placeholder={item.uses.toString()}
                        className="w-16 px-2 py-1 rounded border dark:bg-grey"
                      />
                      <button
                        onClick={handleRestoreUses}
                        className="p-1 rounded-full hover:bg-grey/10 dark:hover:bg-offwhite/10"
                        title="Set uses"
                      >
                        <RefreshCw size={16} />
                      </button>
                    </div>

                    <button
                      onClick={handleIncreaseUses}
                      className="p-1 rounded-full hover:bg-grey/10 dark:hover:bg-offwhite/10"
                      title="Increase uses"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                )}
              </div>
            )}
            {item.isEquippable && actorType === 'character' && (
              <div className="text-sm">Equippable Item</div>
            )}
            {item.tags && item.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {item.tags.map(tag => (
                  <span 
                    key={tag}
                    className="px-2 py-1 bg-grey/10 dark:bg-offwhite/10 rounded-full text-xs"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2 ml-4">
          {canEditItem && (
            <>
              <button
                onClick={() => setShowEditor(true)}
                className="px-3 py-1 bg-blue dark:bg-cyan text-white dark:text-grey rounded-md 
                      hover:bg-blue/90 dark:hover:bg-cyan/90 transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="px-3 py-1 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
            </>
          )}

          {/* Item action buttons */}
          {actorId && (
            <>
              {isEquipped ? (
                // Unequip button for equipped items
                <button
                  onClick={handleUnequip}
                  className="px-3 py-1 bg-purple-500 text-white rounded-md hover:bg-purple-600 transition-colors"
                >
                  Unequip
                </button>
              ) : (
                // Regular inventory item buttons
                <>
                  {item.uses !== undefined && 
                   (item.usesLeft === undefined || item.usesLeft > 0) && (
                    <button
                      onClick={handleUse}
                      className="px-3 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                    >
                      Use
                    </button>
                  )}
                  {item.isEquippable && actorType === 'character' && (
                    <button
                      onClick={handleEquip}
                      className="px-3 py-1 bg-purple-500 text-white rounded-md hover:bg-purple-600 transition-colors"
                    >
                      Equip
                    </button>
                  )}
                  {actorType === 'character' && !isRoomCreator && !isEquipped && (
                    <button
                      onClick={() => setShowTransferModal(true)}
                      className="px-3 py-1 bg-blue dark:bg-cyan text-white dark:text-grey rounded-md 
                                hover:opacity-90 transition-colors"
                    >
                      Transfer
                    </button>
                  )}
                  <button
                    onClick={handleDiscard}
                    className="px-3 py-1 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
                  >
                    Discard
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Editor Modal */}
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

      {/* New transfer-related modals */}
      <TransferModal
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        party={availableParty}
        field={gameState.field}
        onTransfer={handleTransferInitiate}
      />

      <TransferWaitScreen
        isOpen={showTransferWait}
        onCancel={handleTransferCancel}
        item={item}
        recipientName={transferRecipientName}
      />

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <Modal
          isOpen={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title="Confirm Delete"
        >
          <div className="p-4">
            <p>Are you sure you want to delete this item? This cannot be undone and will remove it from all inventories.</p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-1 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
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