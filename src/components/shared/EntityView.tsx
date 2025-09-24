import React, { useState, useEffect } from 'react';
import type { Entity, GameState, EntityReference } from '../../types/game';
import { Room } from 'trystero/nostr';
import { EntityEditor } from '../DungeonMaster/EntityEditor';
import { InventoryPanel } from '../Player/InventoryPanel';
import { SkillsPanel } from '../Player/SkillsPanel';
import { CoolTabs, CoolTabsList, CoolTabsTrigger, CoolTabsContent } from '../ui/cooltabs';
import Modal from './Modal';
import BasicObjectView from '../ui/BasicObjectView';
import { 
  getCatalogEntity, 
  getEntityReferenceName,
  isValidEntityReference 
} from '../../utils/referenceHelpers';

interface EntityViewProps {
  // Either catalog viewing OR instance viewing
  catalogId?: string;                    // For DM catalog mode
  entityReference?: EntityReference;     // For instance viewing (field entities)
  onClose: () => void;
  gameState: GameState;
  onGameStateChange: (newState: GameState) => void;
  room?: Room;
}

export default function EntityView({ 
  catalogId,
  entityReference: initialEntityReference,
  onClose,
  gameState,
  onGameStateChange,
  room
}: EntityViewProps) {
  const [showEditor, setShowEditor] = useState(false);
  const [entityReference, setEntityReference] = useState<EntityReference | null>(initialEntityReference || null);

  // Determine which catalog ID to use for lookups
  const effectiveCatalogId = catalogId || entityReference?.catalogId;
  
  // Get catalog entity for display data
  const catalogEntity = effectiveCatalogId ? getCatalogEntity(effectiveCatalogId, gameState) : null;
  
  // Context detection
  const isViewingFromCatalog = !!catalogId && !entityReference;
  const isViewingInstance = !!entityReference;

  // Keep entityReference state in sync with game state for instances
  useEffect(() => {
    if (!isViewingInstance || !entityReference) return;

    const updatedEntityRef = gameState.field.find(e => e.instanceId === entityReference.instanceId);
    if (updatedEntityRef && isValidEntityReference(updatedEntityRef, gameState)) {
      setEntityReference(updatedEntityRef);
    }
  }, [gameState, entityReference?.instanceId, isViewingInstance]);

  // Validation - moved after hooks
  if (!effectiveCatalogId || !catalogEntity) {
    return (
      <div className="p-4 text-center">
        <p className="text-red-500">Error: Invalid entity reference or catalog ID</p>
        <button onClick={onClose} className="mt-2 px-4 py-2 bg-gray-500 text-white rounded">
          Close
        </button>
      </div>
    );
  }

  const handleUpdateEntity = async (id: string, updates: Partial<Entity>) => {
    if (isViewingFromCatalog) {
      // Update catalog entity
      onGameStateChange({
        ...gameState,
        globalCollections: {
          ...gameState.globalCollections,
          entities: gameState.globalCollections.entities.map(e =>
            e.id === id ? { ...e, ...updates } : e
          ),
        }
      });
    } else if (isViewingInstance && entityReference) {
      // Update field entity instance
      onGameStateChange({
        ...gameState,
        field: gameState.field.map(e =>
          e.instanceId === entityReference.instanceId ? { ...e, ...updates } : e
        )
      });
    }
    setShowEditor(false);
  };

  const handleDeleteEntity = async (id: string) => {
    if (isViewingFromCatalog) {
      // Delete from catalog
      onGameStateChange({
        ...gameState,
        globalCollections: {
          ...gameState.globalCollections,
          entities: gameState.globalCollections.entities.filter(e => e.id !== id)
        }
      });
    } else if (isViewingInstance && entityReference) {
      // Remove from field
      onGameStateChange({
        ...gameState,
        field: gameState.field.filter(e => e.instanceId !== entityReference.instanceId)
      });
    }
    onClose();
  };

  // Display data comes from catalog, instance data from reference
  const displayName = isViewingInstance && entityReference 
    ? getEntityReferenceName(entityReference, gameState) 
    : catalogEntity.name;
  const displayDescription = catalogEntity.description;
  const displayImage = catalogEntity.image;
  
  // Instance-specific data (only available when viewing an instance)
  const instanceInventory = entityReference?.inventory || [];
  const instanceSkills = entityReference?.skills || [];
  const instanceId = entityReference?.instanceId || effectiveCatalogId;
  const instanceHp = entityReference?.hp ?? catalogEntity.hp;
  const instanceSp = entityReference?.sp ?? catalogEntity.sp;

  return (
    <div className="w-full min-h-[60vh] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-start gap-4 mb-6 px-2">
        <div className="flex gap-6">
          {/* Entity Image */}
          <div className="flex-shrink-0">
            <BasicObjectView
              name=""
              imageId={displayImage}
              size="xl"
            />
          </div>
          
          <div className="flex flex-col">
            <h2 className="text-4xl font-['BrunoAceSC'] font-bold mb-2">
              {displayName}
              {isViewingInstance && <span className="ml-2 text-sm text-blue dark:text-cyan">(Instance)</span>}
              {isViewingFromCatalog && <span className="ml-2 text-sm text-blue dark:text-cyan">(Template)</span>}
            </h2>
            <p className="text-gray font-['Mohave'] dark:text-offwhite break-words max-w-xl">
              {displayDescription}
            </p>
            {isViewingFromCatalog && (
              <p className="mt-2 text-sm text-blue-600 dark:text-cyan-400">
                Global Collection Entity - Changes will affect all spawned instances
              </p>
            )}
            {isViewingInstance && (
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                <p>HP: {instanceHp}/{catalogEntity.maxHp} | SP: {instanceSp}/{catalogEntity.maxSp}</p>
              </div>
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
                  inventory={isViewingInstance ? instanceInventory : []}
                  room={room}
                  isRoomCreator={true}
                  gameState={gameState}
                  onGameStateChange={onGameStateChange}
                  actorType={isViewingFromCatalog ? 'globalEntity' : 'fieldEntity'}
                  actorId={isViewingFromCatalog ? effectiveCatalogId : instanceId}
                  isModal={false}
                />
              </div>
            </CoolTabsContent>

            <CoolTabsContent value="skills" className="h-full w-full">
              <div className="h-[35vh]">
                <SkillsPanel
                  skills={isViewingInstance ? instanceSkills : []}
                  room={room}
                  gameState={gameState}
                  onGameStateChange={onGameStateChange}
                  actorId={isViewingFromCatalog ? effectiveCatalogId : instanceId}
                  actorType={isViewingFromCatalog ? 'globalEntity' : 'fieldEntity'}
                  isModal={false}
                  isRoomCreator={true}
                />
              </div>
            </CoolTabsContent>
        </CoolTabs>
      </div>

      {/* Editor Modal */}
      {showEditor && catalogEntity && (
        <Modal
          isOpen={showEditor} 
          onClose={() => setShowEditor(false)}
          title={`Edit ${isViewingFromCatalog ? 'Global' : 'Field'} Entity`}
        >
          <EntityEditor
            entity={catalogEntity}
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
            onDelete={() => handleDeleteEntity(effectiveCatalogId)}
            onClose={() => setShowEditor(false)}
          />
        </Modal>
      )}
    </div>
  );
}