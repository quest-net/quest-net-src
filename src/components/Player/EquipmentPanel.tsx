import React, { useState, useEffect } from 'react';
import type { Room } from 'trystero/nostr';
import { GameState, Item } from '../../types/game';
import { Grid, List, Swords } from 'lucide-react';
import BasicObjectView from '../ui/BasicObjectView';
import { ItemView } from '../shared/ItemView';
import Modal from '../shared/Modal';
import { useEquipmentActions } from '../../actions/equipmentActions';

interface EquipmentPanelProps {
  equipment: Item[];
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
  const [selectedItem, setSelectedItem] = useState<{ item: Item; index: number } | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [currentEquipment, setCurrentEquipment] = useState(initialEquipment);
  const equipmentActions = useEquipmentActions(room, gameState, onGameStateChange, isRoomCreator);

  useEffect(() => {
    if (actorId) {
      const character = gameState.party.find(c => c.id === actorId);
      if (character) {
        setCurrentEquipment(character.equipment);
        
        if (selectedItem) {
          const updatedItem = character.equipment[selectedItem.index];
          if (updatedItem) {
            setSelectedItem({
              item: updatedItem,
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
    <div className="grid p-[1vw] grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-[1.1vw] auto-rows-max">
      {currentEquipment.map((item, index) => (
        <div key={`${item.id}-${index}`} className="relative">
          <BasicObjectView
            name={item.name}
            imageId={item.image}
            id={item.id}
            size="md"
            onClick={() => setSelectedItem({ item, index })}
          />
        </div>
      ))}
    </div>
  );

  const renderEquipmentList = () => (
    <div className="space-y-2 p-[1vw]">
      {currentEquipment.map((item, index) => (
        <div
          key={`${item.id}-${index}`}
          onClick={() => setSelectedItem({ item, index })}
          className="flex items-center p-4 border-2 border-grey dark:border-offwhite rounded-lg hover:bg-grey/10 dark:hover:bg-offwhite/10 cursor-pointer"
        >
          <BasicObjectView
            name={item.name}
            imageId={item.image}
            id={item.id}
            size="sm"
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
      ))}
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
            className="p-2 rounded-md hover:bg-grey/10 dark:hover:bg-offwhite/10 transition-colors"
          >
            {viewMode === 'grid' ? <List size={20} /> : <Grid size={20} />}
          </button>
        </div>
      </div>

      {/* Content - Scrollable with fixed height container */}
      <div className="flex-1 overflow-y-auto scrollable min-h-0 relative">
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
            title={selectedItem.item.name}
          >
            <ItemView
              item={selectedItem.item}
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
      className="max-w-4xl"
    >
      {content}

      {selectedItem && (
        <Modal
          isOpen={!!selectedItem}
          onClose={() => setSelectedItem(null)}
          title={selectedItem.item.name}
        >
          <ItemView
            item={selectedItem.item}
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