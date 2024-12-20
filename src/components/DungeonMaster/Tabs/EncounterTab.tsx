import React, { useState } from 'react';
import { Entity, GameState } from '../../../types/game';
import { EntityEditor } from '../EntityEditor';
import Modal from '../../shared/Modal';
import BasicObjectView from '../../ui/BasicObjectView';
import EntityView from '../../shared/EntityView';
import {ReactComponent as NPC} from '../../ui/npc.svg'
import {ReactComponent as Field} from '../../ui/field.svg'

interface EncounterTabProps {
  gameState: GameState;
  onGameStateChange: (newState: GameState) => void;
  room?: Room;
}

export function EncounterTab({ gameState, onGameStateChange, room }: EncounterTabProps) {
  const [showCreateEntity, setShowCreateEntity] = useState(false);
  const [entityToView, setEntityToView] = useState<Entity | null>(null);

  const handleSpawnEntity = (catalogEntityId: string) => {
    const entityToSpawn = gameState.globalCollections.entities.find(e => e.id === catalogEntityId);
    if (!entityToSpawn) return;
  
    // Find existing entities with the same base name
    const sameNameEntities = gameState.field.filter(e => 
      e.name === entityToSpawn.name || 
      e.name.match(new RegExp(`^${entityToSpawn.name} #\\d+$`))
    );
  
    let newName = entityToSpawn.name;
    if (sameNameEntities.length > 0) {
      // Find the highest existing number
      let maxNum = 1;
      sameNameEntities.forEach(entity => {
        const match = entity.name.match(/#(\d+)$/);
        if (match) {
          const num = parseInt(match[1]);
          if (num >= maxNum) maxNum = num + 1;
        } else {
          maxNum = 2; // If we found an unnumbered one, start at #2
        }
      });
      newName = `${entityToSpawn.name} #${maxNum}`;
    }
  
    const newId = crypto.randomUUID();
    const spawnedEntity: Entity = {
      ...entityToSpawn,
      id: newId,
      name: newName
    };
  
    onGameStateChange({
      ...gameState,
      field: [...gameState.field, spawnedEntity]
    });
  
    // Wait for the new entity to be rendered
    setTimeout(() => {
      const container = document.querySelector('.field-entities-container');
      const newEntity = document.getElementById(newId);
      
      if (container && newEntity) {
        container.scrollTo({
          top: newEntity.offsetTop,
          behavior: 'smooth'
        });
      }
    }, 100);
  };

  const handleDespawnEntity = (fieldEntityId: string) => {
    onGameStateChange({
      ...gameState,
      field: gameState.field.filter(e => e.id !== fieldEntityId)
    });
  };

  return (
    <div 
      className="grid h-full w-full" 
      style={{
        gridTemplateColumns: '75fr 25fr',
        gridTemplateRows: '1fr',
        gap: '0',
        padding: '1vh'
      }}
    >
      {/* Entity Catalog Section - Left Side */}
      <div className="relative overflow-y-auto scrollable p-8 border-2 border-grey dark:border-offwhite rounded-xl mr-8 mt-8 mb-8">
        {/* Background NPC SVG with gradient fade */}
        <div className="absolute inset-0 pointer-events-none -z-10">
          <NPC className="absolute -bottom-[0] -left-0  w-full h-full fill-grey/60 dark:fill-offwhite/60" />
          <div 
            className="absolute inset-0" 
            style={{
              background: `linear-gradient(to top right, 
                transparent 0%, 
                var(--color-background, #F2EEE4) 50%)`
            }}
          />
        </div>
        <h2 className="text-xl font-bold font-['BrunoAceSC'] mb-8">Entities</h2>
        <div className="flex flex-wrap gap-8 justify-center">
          <BasicObjectView
            name="Create New Entity"
            size="md"
            id="create-new-entity"
            action={{
              onClick: () => setShowCreateEntity(true),
              icon: 'arrow'
            }}
          />
          {gameState.globalCollections.entities.map(entity => (
            <BasicObjectView
              key={entity.id}
              name={entity.name}
              imageId={entity.image}
              id={entity.id}
              size="md"
              onClick={() => setEntityToView(entity)}
              action={{
                onClick: () => handleSpawnEntity(entity.id),
                icon: 'plus'
              }}
            />
          ))}
        </div>
      </div>
  
      {/* Field Section - Right Side */}
      <div className="relative overflow-y-auto scrollable field-entities-container p-8 border-2 border-grey dark:border-offwhite rounded-xl mt-8 mb-8">
        <div className="absolute inset-0 pointer-events-none -z-10 overflow-hidden">
          <Field className="absolute scale-[200%] -bottom-1/2 -left-0 w-full h-full fill-grey/20 dark:fill-offwhite/20" />
        </div>
        <h2 className="text-xl font-bold font-['BrunoAceSC'] mb-12">Field</h2>
        <div className="flex flex-wrap gap-[4vh] justify-center">
          {gameState.field.map(entity => (
            <BasicObjectView
              key={entity.id}
              name={entity.name}
              id={entity.id}
              imageId={entity.image}
              size="lg"
              onClick={() => setEntityToView(entity)}
              action={{
                onClick: () => handleDespawnEntity(entity.id),
                icon: 'minus'
              }}
            />
          ))}
          {gameState.field.length === 0 && (
            <div className="text-center w-full text-gray-500">
              No entities on the field
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showCreateEntity && (
        <Modal
          isOpen={showCreateEntity}
          onClose={() => setShowCreateEntity(false)}
          title="Create New Entity"
        >
          <EntityEditor
            onSave={async (entity) => {
              onGameStateChange({
                ...gameState,
                globalCollections: {
                  ...gameState.globalCollections,
                  entities: [...gameState.globalCollections.entities, { ...entity, id: crypto.randomUUID() }]
                }
              });
              setShowCreateEntity(false);
            }}
            onUpdate={async (id, updates) => {
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
            }}
            onClose={() => setShowCreateEntity(false)}
          />
        </Modal>
      )}

      {entityToView && (
        <Modal
          isOpen={!!entityToView}
          onClose={() => setEntityToView(null)}
          title={entityToView.name}
        >
          <EntityView
            entity={entityToView}
            onClose={() => setEntityToView(null)}
            gameState={gameState}
            onGameStateChange={onGameStateChange}
            room={room}
          />
        </Modal>
      )}
    </div>
  );
}