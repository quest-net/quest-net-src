import React, { useState, useEffect } from 'react';
import type { Room } from 'trystero/nostr';
import { GameState, Equipment, ItemReference } from '../../types/game';
import { Grid, List, Swords } from 'lucide-react';
import BasicObjectView from '../ui/BasicObjectView';
import { ItemView } from '../shared/ItemView';
import Modal from '../shared/Modal';
import { useEquipmentActions } from '../../actions/equipmentActions';
import { 
  getCatalogItem, 
  getItemReferenceName,
  getItemReferenceUsesLeft,
  itemReferenceHasUses,
  isValidItemReference 
} from '../../utils/referenceHelpers';

interface EquipmentPanelProps {
  equipment: Equipment;  // Now expects ItemReference[] instead of Item[]
  onClose?: () => void;
  room?: Room;
  gameState: GameState;
  onGameStateChange: (newState: GameState) => void;
  actorId?: string;
  isModal?: boolean;
  isRoomCreator?: boolean;
}

export function EquipmentPanel({
  equipment: initialEquipment,
  onClose,
  room,
  gameState,
  onGameStateChange,
  actorId,
  isModal = true,
  isRoomCreator = false
}: EquipmentPanelProps) {
  const [selectedItem, setSelectedItem] = useState<{ itemRef: ItemReference; index: number } | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [currentEquipment, setCurrentEquipment] = useState<Equipment>(initialEquipment);
  const equipmentActions = useEquipmentActions(room, gameState, onGameStateChange, isRoomCreator);

  useEffect(() => {
    if (actorId) {
      const character = gameState.party.find(c => c.id === actorId);
      if (character) {
        setCurrentEquipment(character.equipment);
        
        if (selectedItem) {
          const updatedItemRef = character.equipment[selectedItem.index];
          if (updatedItemRef && isValidItemReference(updatedItemRef, gameState)) {
            setSelectedItem({
              itemRef: updatedItemRef,
              index: selectedItem.index
            });
          } else {
            setSelectedItem(null);
          }
        }
      }
    }
  }, [gameState, actorId]);

  const renderEquipmentGrid = () => (
    <div className="flex flex-wrap justify-evenly content-start gap-6 px-6 py-4">
      {currentEquipment.map((itemRef, index) => {
        const catalogItem = getCatalogItem(itemRef.catalogId, gameState);
        if (!catalogItem) return null;

        const itemName = getItemReferenceName(itemRef, gameState);
        const hasUses = itemReferenceHasUses(itemRef, gameState);
        const usesLeft = getItemReferenceUsesLeft(itemRef, gameState);

        return (
          <div 
            key={`${itemRef.catalogId}-${index}`} 
            className="flex-grow-0 flex-shrink-0"
          >
            <BasicObjectView
              name={itemName}
              imageId={catalogItem.image}
              id={itemRef.catalogId}
              size="size=sm 2xl:size=md"
              onClick={() => setSelectedItem({ itemRef, index })}
              action={hasUses && usesLeft !== undefined ? {
                content: `${usesLeft}/${catalogItem.uses}`,
                onClick: () => setSelectedItem({ itemRef, index })
              } : undefined}
            />
          </div>
        );
      })}
    </div>
  );

  const renderEquipmentList = () => (
    <div className="space-y-2 p-[1vw]">
      {currentEquipment.map((itemRef, index) => {
        const catalogItem = getCatalogItem(itemRef.catalogId, gameState);
        if (!catalogItem) return null;

        const itemName = getItemReferenceName(itemRef, gameState);
        const hasUses = itemReferenceHasUses(itemRef, gameState);
        const usesLeft = getItemReferenceUsesLeft(itemRef, gameState);

        return (
          <div
            key={`${itemRef.catalogId}-${index}`}
            onClick={() => setSelectedItem({ itemRef, index })}
            className="flex items-center justify-between p-4 pb-6 font-['Mohave'] text-lg border-b-2 border-grey dark:border-offwhite hover:bg-grey/10 dark:hover:bg-offwhite/10 cursor-pointer"
          >
            <div className="flex items-center">
              <BasicObjectView
                name=""
                imageId={catalogItem.image}
                id={itemRef.catalogId}
                size="sm"
              />
              <div className="ml-8 flex flex-col items-start">
                <h4 className="font-medium font-['BrunoAceSC']">{itemName}</h4>
                {hasUses && (
                  <div className="text-md flex items-center gap-2">
                    <span className="text-blue dark:text-cyan">Uses: {usesLeft ?? catalogItem.uses}</span>
                    <span className="text-grey dark:text-offwhite">/</span>
                    <span className="text-blue dark:text-cyan">{catalogItem.uses}</span>
                  </div>
                )}
              </div>
            </div>
            
            {hasUses && (
              <div className="flex items-center">
                <div className="w-12 h-12 rotate-45 border-2 border-blue dark:border-cyan bg-offwhite dark:bg-grey rounded flex items-center justify-center">
                  <div className="-rotate-45 text-blue dark:text-cyan font-medium">
                    {usesLeft ?? catalogItem.uses}/{catalogItem.uses}
                  </div>
                </div>
              </div>
            )}
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
          <Swords className="w-5 h-5" />
          <h2 className="text-xl font-bold">
            Equipment
            {isRoomCreator && <span className="ml-2 text-blue dark:text-cyan">(DM View)</span>}
          </h2>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            className="p-2 hover:bg-grey/10 dark:hover:bg-offwhite/10 rounded-md transition-colors"
            title={`Switch to ${viewMode === 'grid' ? 'list' : 'grid'} view`}
          >
            {viewMode === 'grid' ? <List className="w-5 h-5" /> : <Grid className="w-5 h-5" />}
          </button>
          
          {isModal && onClose && (
            <button
              onClick={onClose}
              className="text-lg font-bold hover:bg-grey/10 dark:hover:bg-offwhite/10 px-2 py-1 rounded-md transition-colors"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Content - Scrollable */}
      <div className="flex-1 relative min-h-0">
        {currentEquipment.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-500">
            No items equipped
          </div>
        ) : (
          <div className="absolute inset-0 overflow-y-auto scrollable">
            {viewMode === 'grid' ? renderEquipmentGrid() : renderEquipmentList()}
          </div>
        )}
      </div>
    </div>
  );

  if (!isModal) {
    return (
      <>
        <div className="h-full w-full relative">
          {content}
        </div>
  
        {selectedItem && (
          <Modal
            isOpen={!!selectedItem}
            onClose={() => setSelectedItem(null)}
            title={getItemReferenceName(selectedItem.itemRef, gameState)}
          >
            <ItemView
              itemReference={selectedItem.itemRef}
              onClose={() => setSelectedItem(null)}
              gameState={gameState}
              onGameStateChange={onGameStateChange}
              room={room}
              isRoomCreator={isRoomCreator}
              actorId={actorId}
              actorType="character"
              isEquipped={true}
              equipmentIndex={selectedItem.index}
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
      className="max-w-4xl min-w-[42vw]"
    >
      {content}

      {selectedItem && (
        <Modal
          isOpen={!!selectedItem}
          onClose={() => setSelectedItem(null)}
          title={getItemReferenceName(selectedItem.itemRef, gameState)}
          className="max-w-[33vw]"
        >
          <ItemView
            itemReference={selectedItem.itemRef}
            onClose={() => setSelectedItem(null)}
            gameState={gameState}
            onGameStateChange={onGameStateChange}
            room={room}
            isRoomCreator={isRoomCreator}
            actorId={actorId}
            actorType="character"
            isEquipped={true}
            equipmentIndex={selectedItem.index}
          />
        </Modal>
      )}
    </Modal>
  );
}