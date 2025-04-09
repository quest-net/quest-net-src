import React, { useState } from 'react';
import type { Entity, GameState } from '../../types/game';
import { Room } from 'trystero/nostr';
import { EntityEditor } from '../DungeonMaster/EntityEditor';
import { InventoryPanel } from '../Player/InventoryPanel';
import { SkillsPanel } from '../Player/SkillsPanel';
import { CoolTabs, CoolTabsList, CoolTabsTrigger, CoolTabsContent } from '../ui/cooltabs';
import Modal from './Modal';
import BasicObjectView from '../ui/BasicObjectView';

interface EntityViewProps {
  entity: Entity;
  onClose: () => void;
  gameState: GameState;
  onGameStateChange: (newState: GameState) => void;
  room?: Room;
}

export default function EntityView({ 
  entity: initialEntity, 
  onClose,
  gameState,
  onGameStateChange,
  room
}: EntityViewProps) {
  // Only maintain UI state
  const [showEditor, setShowEditor] = useState(false);

  // Get current entity data directly from gameState
  const getCurrentEntity = (): Entity => {
    // Check if this entity is from catalog
    const catalogEntity = gameState.globalCollections.entities.find(e => e.id === initialEntity.id);
    if (catalogEntity) {
      return catalogEntity;
    }

    // Check if it's a field entity
    const fieldEntity = gameState.field.find(e => e.id === initialEntity.id);
    if (fieldEntity) {
      return fieldEntity;
    }

    return initialEntity;
  };

  const entity = getCurrentEntity();
  const isInCatalog = gameState.globalCollections.entities.some(e => e.id === entity.id);

  const handleUpdateEntity = async (id: string, updates: Partial<Entity>) => {
    if (isInCatalog) {
      onGameStateChange({
        ...gameState,
        globalCollections: {
          ...gameState.globalCollections,
          entities: gameState.globalCollections.entities.map(e =>
            e.id === id ? { ...e, ...updates } : e
          ),
        },
        field: gameState.field.map(e => {
          const catalogEntity = gameState.globalCollections.entities.find(ce => ce.id === id);
          if (catalogEntity && e.name === catalogEntity.name) {
            return { ...e, ...updates };
          }
          return e;
        })
      });
    } else {
      onGameStateChange({
        ...gameState,
        field: gameState.field.map(e =>
          e.id === id ? { ...e, ...updates } : e
        )
      });
    }
    setShowEditor(false);
  };

  const handleDeleteEntity = async (id: string) => {
    if (isInCatalog) {
      onGameStateChange({
        ...gameState,
        globalCollections: {
          ...gameState.globalCollections,
          entities: gameState.globalCollections.entities.filter(e => e.id !== id)
        },
        field: gameState.field.filter(e => {
          const catalogEntity = gameState.globalCollections.entities.find(ce => ce.id === id);
          return !catalogEntity || e.name !== catalogEntity.name;
        })
      });
    } else {
      onGameStateChange({
        ...gameState,
        field: gameState.field.filter(e => e.id !== id)
      });
    }
    onClose();
  };

  return (
    <div className="w-full min-h-[60vh] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-start gap-4 mb-6 px-2">
        <div className="flex gap-6">
          {/* Entity Image */}
          <div className="flex-shrink-0">
            <BasicObjectView
              name=""
              imageId={entity.image}
              size="xl"
            />
          </div>
          
          <div className="flex flex-col">
            <h2 className="text-4xl font-['BrunoAceSC'] font-bold mb-2">{entity.name}</h2>
            <p className="text-gray font-['Mohave'] dark:text-offwhite break-words max-w-xl">
              {entity.description}
            </p>
            {isInCatalog && (
              <p className="mt-2 text-sm text-blue-600 dark:text-cyan-400">
                Global Collection Entity - Changes will affect all spawned instances
              </p>
            )}
          </div>
        </div>
        
        <button
          onClick={() => setShowEditor(true)}
          className="flex-shrink-0 px-4 py-2 bg-blue dark:bg-cyan text-white dark:text-grey rounded-md hover:opacity-90"
        >
          Edit Entity
        </button>
      </div>

      {/* Inventory and Skills Tabs */}
      <div className="flex-1 flex flex-col">
        <CoolTabs defaultValue="inventory" className=" flex flex-col">
          <CoolTabsList>
            <CoolTabsTrigger value="inventory" tabType="inventory"/>
            <CoolTabsTrigger value="skills" tabType="skills"/>
          </CoolTabsList>
            <CoolTabsContent value="inventory" className="flex-1 overflow-auto">
              <div className="h-[35vh]">
                <InventoryPanel
                  inventory={entity.inventory}
                  room={room}
                  isRoomCreator={true}
                  gameState={gameState}
                  onGameStateChange={onGameStateChange}
                  actorType={isInCatalog ? 'globalEntity' : 'fieldEntity'}
                  actorId={entity.id}
                  isModal={false}
                />
              </div>
            </CoolTabsContent>

            <CoolTabsContent value="skills" className="h-full w-full">
              <div className="h-[35vh]">
                <SkillsPanel
                  skills={entity.skills}
                  room={room}
                  gameState={gameState}
                  onGameStateChange={onGameStateChange}
                  actorId={entity.id}
                  actorType={isInCatalog ? 'globalEntity' : 'fieldEntity'}
                  isModal={false}
                  isRoomCreator={true}
                />
              </div>
            </CoolTabsContent>
        </CoolTabs>
      </div>

      {/* Editor Modal */}
      {showEditor && (
        <Modal
          isOpen={showEditor} 
          onClose={() => setShowEditor(false)}
          title={`Edit ${isInCatalog ? 'Global' : 'Field'} Entity`}
        >
          <EntityEditor
            entity={entity}
            onSave={async (newEntity) => {
              onGameStateChange({
                ...gameState,
                globalCollections: {
                  ...gameState.globalCollections,
                  entities: [...gameState.globalCollections.entities, { ...newEntity, id: crypto.randomUUID() }]
                }
              });
            }}
            onUpdate={(id, updates) => handleUpdateEntity(id, updates)}
            onDelete={() => handleDeleteEntity(entity.id)}
            onClose={() => setShowEditor(false)}
          />
        </Modal>
      )}
    </div>
  );
}