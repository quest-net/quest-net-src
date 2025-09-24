import React, { useState } from 'react';
import { Entity, GameState, EntityReference } from '../../../types/game';
import { EntityEditor } from '../EntityEditor';
import Modal from '../../shared/Modal';
import BasicObjectView from '../../ui/BasicObjectView';
import EntityView from '../../shared/EntityView';
import {ReactComponent as NPC} from '../../ui/npc.svg'
import {ReactComponent as Field} from '../../ui/field.svg'
import { createEntityReference, getCatalogEntity } from '../../../utils/referenceHelpers';

type Room = any; // Define proper Room type

interface EncounterTabProps {
  gameState: GameState;
  onGameStateChange: (newState: GameState) => void;
  room?: Room;
}

export function EncounterTab({ gameState, onGameStateChange, room }: EncounterTabProps) {
  const [showCreateEntity, setShowCreateEntity] = useState(false);
  const [entityToView, setEntityToView] = useState<string | null>(null);
  // ✅ NEW: Added state for viewing field entity instances
  const [entityReferenceToView, setEntityReferenceToView] = useState<EntityReference | null>(null);

  // ✅ COMPLETELY REWRITTEN: Proper reference system spawning
  const handleSpawnEntity = (catalogEntityId: string) => {
    const catalogEntity = gameState.globalCollections.entities.find(e => e.id === catalogEntityId);
    if (!catalogEntity) return;

    // ✅ FIXED: Simply create a new EntityReference - no new catalog entities needed!
    const entityReference = createEntityReference(catalogEntityId, gameState);
    
    if (!entityReference) {
      console.error('Failed to create entity reference');
      return;
    }
    
    // ✅ FIXED: Just add the new reference to the field - that's it!
    onGameStateChange({
      ...gameState,
      field: [...gameState.field, entityReference]
    });

    // Scroll to the new entity
    setTimeout(() => {
      const container = document.querySelector('.field-entities-container');
      const newEntity = document.getElementById(entityReference.instanceId);
      
      if (container && newEntity) {
        container.scrollTo({
          top: newEntity.offsetTop,
          behavior: 'smooth'
        });
      }
    }, 100);
  };

  const handleDespawnEntity = (instanceId: string) => {
    onGameStateChange({
      ...gameState,
      field: gameState.field.filter(e => e.instanceId !== instanceId)
    });
  };

  // ✅ NEW: Helper function to get display name for field entities
  const getFieldEntityDisplayName = (entityRef: EntityReference): string => {
    const catalogEntity = getCatalogEntity(entityRef.catalogId, gameState);
    if (!catalogEntity) return 'Unknown Entity';

    // Count how many instances of this catalog entity already exist
    const sameTypeInstances = gameState.field.filter(e => e.catalogId === entityRef.catalogId);
    const currentIndex = sameTypeInstances.findIndex(e => e.instanceId === entityRef.instanceId);
    
    // If this is the first instance, use the original name
    if (sameTypeInstances.length === 1) {
      return catalogEntity.name;
    }
    
    // Otherwise, add a number (starting from #2 for the second instance)
    return `${catalogEntity.name} #${currentIndex + 1}`;
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
        <h2 className="text-xl font-bold font-['BrunoAceSC'] mb-8 rounded-lg mx-6 bg-grey text-offwhite dark:bg-offwhite dark:text-grey">Entities</h2>
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
              onClick={() => setEntityToView(entity.id)} // This opens catalog template view
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
        <div className="absolute inset-0 pointer-events-none -z-10 overflow-hidden rounded-xl">
            <Field className="absolute w-[200%] h-[250%] -translate-x-1/4 -translate-y-1/4 fill-grey/20 dark:fill-offwhite/20" />
        </div>
        <h2 className="text-xl font-bold font-['BrunoAceSC'] mb-12">Field</h2>
        <div className="flex flex-wrap gap-[4vh] justify-center">
          {/* ✅ FIXED: Field entities now open instance view, not template view */}
          {gameState.field.map(entityRef => {
            const catalogEntity = getCatalogEntity(entityRef.catalogId, gameState);
            if (!catalogEntity) return null;
            
            return (
              <BasicObjectView
                key={entityRef.instanceId} // Use instanceId as key
                name={getFieldEntityDisplayName(entityRef)} // ✅ FIXED: Dynamic naming
                id={entityRef.instanceId} // Use instanceId for element ID
                imageId={catalogEntity.image}
                size="lg"
                onClick={() => setEntityReferenceToView(entityRef)} // ✅ FIXED: Open instance view!
                action={{
                  onClick: () => handleDespawnEntity(entityRef.instanceId),
                  icon: 'minus'
                }}
              />
            );
          })}
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
                  )
                }
              });
            }}
            onClose={() => setShowCreateEntity(false)}
          />
        </Modal>
      )}

      {/* ✅ CATALOG ENTITY VIEW: For viewing/editing templates */}
      {entityToView && (
        <Modal
          isOpen={!!entityToView}
          onClose={() => setEntityToView(null)}
          className="min-w-[42vw] max-w-[42vw]"
        >
          <EntityView
            catalogId={entityToView} // Viewing catalog template
            onClose={() => setEntityToView(null)}
            gameState={gameState}
            onGameStateChange={onGameStateChange}
            room={room}
          />
        </Modal>
      )}

      {/* ✅ NEW: FIELD ENTITY INSTANCE VIEW: For viewing/editing specific instances */}
      {entityReferenceToView && (
        <Modal
          isOpen={!!entityReferenceToView}
          onClose={() => setEntityReferenceToView(null)}
          className="min-w-[42vw] max-w-[42vw]"
        >
          <EntityView
            entityReference={entityReferenceToView} // Viewing specific instance
            onClose={() => setEntityReferenceToView(null)}
            gameState={gameState}
            onGameStateChange={onGameStateChange}
            room={room}
          />
        </Modal>
      )}
    </div>
  );
}