import React, { useState, useEffect } from 'react';
import { InventorySlot, GameState } from '../../types/game';
import { Backpack, Grid, List } from 'lucide-react';
import BasicObjectView from '../ui/BasicObjectView';
import { ItemView } from '../shared/ItemView';
import type { Room } from 'trystero/nostr';
import Modal from '../shared/Modal';


interface InventoryPanelProps {
  inventory: InventorySlot[];
  room?: Room;
  gameState: GameState;
  onGameStateChange: (newState: GameState) => void;
  actorId?: string;
  actorType?: 'character' | 'globalEntity' | 'fieldEntity';
  isModal?: boolean;
  isRoomCreator?: boolean;
  onClose?: () => void;
}

export function InventoryPanel({
  inventory: initialInventory,
  room,
  gameState,
  onGameStateChange,
  actorId,
  actorType,
  isModal = true,
  isRoomCreator = false,
  onClose
}: InventoryPanelProps) {
  const [selectedSlot, setSelectedSlot] = useState<{ item: InventorySlot, index: number } | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const getCurrentInventory = () => {
    if (!actorId || !actorType) return initialInventory;

    switch (actorType) {
      case 'character':
        return gameState.party.find(c => c.id === actorId)?.inventory ?? initialInventory;
      case 'globalEntity':
        return gameState.globalCollections.entities.find(e => e.id === actorId)?.inventory ?? initialInventory;
      case 'fieldEntity':
        return gameState.field.find(e => e.id === actorId)?.inventory ?? initialInventory;
      default:
        return initialInventory;
    }
  };

  const currentInventory = getCurrentInventory();

  useEffect(() => {
    if (selectedSlot) {
      const currentInv = getCurrentInventory();
      const updatedSlot = currentInv[selectedSlot.index];
      if (updatedSlot && updatedSlot[0].id === selectedSlot.item[0].id) {
        setSelectedSlot({
          item: updatedSlot,
          index: selectedSlot.index
        });
      }
    }
  }, [gameState]);

  useEffect(() => {
    if (selectedSlot) {
      const slotStillExists = currentInventory.some(
        (slot, index) => index === selectedSlot.index && 
                        slot[0].id === selectedSlot.item[0].id
      );
      
      if (!slotStillExists) {
        setSelectedSlot(null);
      } else {
        const updatedSlot = currentInventory[selectedSlot.index];
        setSelectedSlot({
          item: updatedSlot,
          index: selectedSlot.index
        });
      }
    }
  }, [currentInventory]);

  const renderInventoryGrid = () => (
    <div className="grid p-[1vw] grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-[1.1vw] auto-rows-max">
      {currentInventory.map((slot, index) => {
        const [item, count] = slot;
        
        return (
          <div key={`${item.id}-${index}`} className="relative">
            <BasicObjectView
              name={item.name}
              imageId={item.image}
              id={item.id}
              size="md"
              onClick={() => setSelectedSlot({ item: slot, index })}
              action={count > 1 || item.uses !== undefined ? {
                content: count > 1 ? count : `${item.usesLeft}/${item.uses}`,
                onClick: () => setSelectedSlot({ item: slot, index })
              } : undefined}
            />
          </div>
        );
      })}
    </div>
  );

  const renderInventoryList = () => (
    <div className="space-y-2 p-[1vw]">
      {currentInventory.map((slot, index) => {
        const [item, count] = slot;
        
        return (
          <div
            key={`${item.id}-${index}`}
            onClick={() => setSelectedSlot({ item: slot, index })}
            className="flex items-center p-4 border-2 border-grey dark:border-offwhite rounded-lg hover:bg-grey/10 dark:hover:bg-offwhite/10 cursor-pointer"
          >
            <BasicObjectView
              name={item.name}
              imageId={item.image}
              id={item.id}
              size="sm"
              action={count > 1 || item.uses !== undefined ? {
                content: count > 1 ? count : `${item.usesLeft}/${item.uses}`,
                onClick: () => setSelectedSlot({ item: slot, index })
              } : undefined}
            />
            <div className="ml-4">
              <h4 className="font-medium">{item.name}</h4>
              {item.uses !== undefined && (
                <p className="text-sm text-grey dark:text-offwhite/80">
                  Uses: {item.usesLeft ?? item.uses} / {item.uses}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  const content = (
    <div className={`flex flex-col ${isModal ? 'h-[50vh]' : 'h-full max-h-full'}`}>
      {/* Header - Fixed height */}
      <div className="flex-shrink-0 flex justify-between items-center mb-4 px-4 pt-2">
        <div className="flex items-center gap-2">
          <Backpack className="w-5 h-5" />
          <h2 className="text-xl font-bold">
            Inventory
            {isRoomCreator && <span className="ml-2 text-blue dark:text-cyan">(DM View)</span>}
          </h2>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            className="p-2 rounded-md hover:bg-grey/10 dark:hover:bg-offwhite/10 transition-colors"
          >
            {viewMode === 'grid' ? <List size={20} /> : <Grid size={20} />}
          </button>
        </div>
      </div>

      {/* Content - Scrollable with fixed height container */}
      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 overflow-y-auto scrollable">
          {currentInventory.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-500">
              Inventory is empty
            </div>
          ) : (
            <div>
              {viewMode === 'grid' ? renderInventoryGrid() : renderInventoryList()}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (!isModal) {
    return (
      <>
        <div className="h-full w-full relative">
          {content}
        </div>
        
        {/* ItemView Modal */}
        {selectedSlot && (
          <Modal
            isOpen={!!selectedSlot}
            onClose={() => setSelectedSlot(null)}
            title={selectedSlot.item[0].name}
          >
            <ItemView
              item={selectedSlot.item[0]}
              inventorySlotIndex={selectedSlot.index}
              onClose={() => setSelectedSlot(null)}
              room={room}
              gameState={gameState}
              onGameStateChange={onGameStateChange}
              actorId={actorId}
              actorType={actorType}
              isRoomCreator={isRoomCreator}
            />
          </Modal>
        )}
      </>
    );
  }

  return (
    <Modal
      isOpen={true}
      onClose={onClose || (() => {})}
      className="max-w-4xl"
    >
      {content}

      {/* ItemView Modal */}
      {selectedSlot && (
        <Modal
          isOpen={!!selectedSlot}
          onClose={() => setSelectedSlot(null)}
          title={selectedSlot.item[0].name}
        >
          <ItemView
            item={selectedSlot.item[0]}
            inventorySlotIndex={selectedSlot.index}
            onClose={() => setSelectedSlot(null)}
            room={room}
            gameState={gameState}
            onGameStateChange={onGameStateChange}
            actorId={actorId}
            actorType={actorType}
            isRoomCreator={isRoomCreator}
          />
        </Modal>
      )}
    </Modal>
  );
}