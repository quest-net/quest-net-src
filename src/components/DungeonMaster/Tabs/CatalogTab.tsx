import React, { useState, useRef, useEffect } from 'react';
import { GameState, Item, Skill } from '../../../types/game';
import { useItemActions } from '../../../actions/itemActions';
import { useSkillActions } from '../../../actions/skillActions';
import { CatalogTabs, CatalogTabsList, CatalogTabsTrigger } from '../../ui/CatalogTabs';
import { CoolTabs, CoolTabsList, CoolTabsTrigger, CoolTabsContent } from '../../ui/cooltabs';
import BasicObjectView from '../../ui/BasicObjectView';
import { ItemView } from '../../shared/ItemView';
import { SkillView } from '../../shared/SkillView';
import { ItemEditor } from '../ItemEditor';
import { SkillEditor } from '../SkillEditor';
import Modal from '../../shared/Modal';
import {ReactComponent as Treasure} from '../../ui/item.svg'
import {ReactComponent as Key} from '../../ui/skill.svg'
import { ReactComponent as NPCBackground } from '../../ui/npc.svg';
import { ReactComponent as CharBackground } from '../../ui/char.svg';
import {ReactComponent as FieldBackground} from '../../ui/field.svg';
import type { CatalogControls, CatalogContentType, CatalogRecipientType } from '../../../services/NavigationManager';
import TransferAnimationManager, { TransferAnimationManagerRef } from '../../ui/TransferAnimation';
import { getCatalogEntity } from '../../../utils/referenceHelpers';

type Room = any; // Define proper Room type

interface CatalogTabProps {
  gameState: GameState;
  onGameStateChange: (newState: GameState) => void;
  room?: Room;
  onCatalogControlsReady?: (controls: CatalogControls) => void;
  contentType: CatalogContentType;
  onContentTypeChange: (type: CatalogContentType) => void;
}

const RecipientsBackground = ({ type }: { type: 'character' | 'globalEntity' | 'fieldEntity' }) => {
  return (
    <div className="absolute inset-0 pointer-events-none -z-10 overflow-hidden">
      {type === 'character' && (
        <CharBackground className="absolute bottom-0 scale-[150%] rotate-[20deg] left-0 h-full fill-grey/20 dark:fill-offwhite/20" />
      )}
      {type === 'globalEntity' && (
        <NPCBackground className="absolute bottom-0 left-0 scale-[150%] rotate-[20deg] h-full fill-grey/20 dark:fill-offwhite/20" />
      )}
      {type === 'fieldEntity' && (
        <FieldBackground className="absolute -bottom-[50%] left-[95%] scale-[480%]  h-full fill-grey/20 dark:fill-offwhite/20" />
      )}
    </div>
  );
};

export function CatalogTab({ 
  gameState, 
  onGameStateChange, 
  room,
  onCatalogControlsReady,
  contentType,
  onContentTypeChange
}: CatalogTabProps) {
  // Updated state - using catalog IDs instead of full objects
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<Set<string>>(new Set());
  const [selectedRecipientType, setSelectedRecipientType] = useState<CatalogRecipientType>('character');
  const [showCreateItem, setShowCreateItem] = useState(false);
  const [selectedItem, setSelectedItem] = useState<string | null>(null); // ✅ Changed to catalog ID
  const [showCreateSkill, setShowCreateSkill] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null); // ✅ Changed to catalog ID

  // Add ref for animation manager
  const transferAnimationRef = useRef<TransferAnimationManagerRef>(null);
  // Add ref for storing clicked item element
  const actionSourceRef = useRef<HTMLElement | null>(null);
  
  // Setup catalog controls
  useEffect(() => {
    if (onCatalogControlsReady) {
      const controls: CatalogControls = {
        setRecipientType: (type) => {
          setSelectedRecipientType(type);
        },
        setContentType: (type) => {
          onContentTypeChange(type);
        }
      };
      onCatalogControlsReady(controls);
    }
  }, [onCatalogControlsReady, onContentTypeChange]);

  // Get actions
  const itemActions = useItemActions(room, gameState, onGameStateChange, true);
  const skillActions = useSkillActions(room, gameState, onGameStateChange, true);

  const handleRecipientSelect = (recipientId: string) => {
    setSelectedRecipientIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(recipientId)) {
        newSet.delete(recipientId);
      } else {
        newSet.add(recipientId);
      }
      return newSet;
    });
  };

  // Modify handleGiveItem to include animation
  const handleGiveItem = (item: Item) => {
    if (selectedRecipientIds.size === 0 || !itemActions?.giveItem) return;
    
    // Get source element position - get parent of button for better positioning
    const sourceElement = actionSourceRef.current?.closest('.relative');
    if (!sourceElement) return;
    
    const sourceBounds = sourceElement.getBoundingClientRect();
    
    selectedRecipientIds.forEach(recipientId => {
      const recipientElement = document.getElementById(`recipient-${recipientId}`);
      
      if (recipientElement) {
        const targetBounds = recipientElement.getBoundingClientRect();
        
        // Trigger animation from center of source to center of target
        transferAnimationRef.current?.addAnimation(
          sourceBounds.x + sourceBounds.width/2,
          sourceBounds.y - sourceBounds.height/2,
          targetBounds.x + targetBounds.width/2,
          targetBounds.y - targetBounds.height/2
        );
      }
      
      if (itemActions?.giveItem) {
        itemActions.giveItem(item.id, recipientId, selectedRecipientType);
      }
    });
  };

  // Similar modification for handleGrantSkill
  const handleGrantSkill = (skill: Skill) => {
    if (selectedRecipientIds.size === 0 || !skillActions?.grantSkill) return;
    
    // Get source element position - get parent of button for better positioning
    const sourceElement = actionSourceRef.current?.closest('.relative');
    if (!sourceElement) return;
    
    const sourceBounds = sourceElement.getBoundingClientRect();
    
    selectedRecipientIds.forEach(recipientId => {
      const recipientElement = document.getElementById(`recipient-${recipientId}`);
      
      let recipient;
      
      // ✅ FIXED: Updated field entity lookup to use instanceId for EntityReference
      switch (selectedRecipientType) {
        case 'character':
          recipient = gameState.party.find(c => c.id === recipientId);
          break;
        case 'globalEntity':
          recipient = gameState.globalCollections.entities.find(e => e.id === recipientId);
          break;
        case 'fieldEntity':
          recipient = gameState.field.find(e => e.instanceId === recipientId); // ✅ Fixed: using instanceId
          break;
      }

      if (recipient) {
        // ✅ FIXED: All recipients now have SkillReference[], so use catalogId for all
        const hasSkill = recipient.skills?.some(skillRef => skillRef.catalogId === skill.id) || false;
        
        if (!hasSkill && skillActions?.grantSkill) {
          skillActions.grantSkill(skill.id, recipientId, selectedRecipientType);
        }
      }
      
      if (recipient && recipientElement) {
        // ✅ FIXED: Consistent skill checking using catalogId
        const hasSkill = recipient.skills?.some(skillRef => skillRef.catalogId === skill.id) || false;
        
        const targetBounds = recipientElement.getBoundingClientRect();
        if (!hasSkill) {
          transferAnimationRef.current?.addAnimation(
            sourceBounds.x + sourceBounds.width/2,
            sourceBounds.y - sourceBounds.height/2,
            targetBounds.x + targetBounds.width/2,
            targetBounds.y - targetBounds.height/2
          );
        }
      }
    });
  };

  const handleCreateItem = async (itemData: Omit<Item, 'id'>) => {
    if (!itemActions?.createItem) return;
    
    try {
      await itemActions.createItem(itemData);
      setShowCreateItem(false);
    } catch (error) {
      console.error('Failed to create item:', error);
    }
  };

  const handleCreateSkill = async (skillData: Omit<Skill, 'id'>) => {
    if (!skillActions?.createSkill) return;
    
    try {
      await skillActions.createSkill(skillData);
      setShowCreateSkill(false);
    } catch (error) {
      console.error('Failed to create skill:', error);
    }
  };

  const renderRecipientList = () => {
    let recipients: { id: string; name: string; image?: string }[] = [];
    
    // ✅ FIXED: Updated field entity handling for EntityReference
    switch (selectedRecipientType) {
      case 'character':
        recipients = gameState.party;
        break;
      case 'globalEntity':
        recipients = gameState.globalCollections.entities;
        break;
      case 'fieldEntity':
        // ✅ Fixed: Map EntityReference to display format with catalog name resolution
        recipients = gameState.field.map(entityRef => {
          const catalogEntity = getCatalogEntity(entityRef.catalogId, gameState);
          return {
            id: entityRef.instanceId, // ✅ Use instanceId for targeting
            name: catalogEntity?.name || 'Unknown Entity',
            image: catalogEntity?.image
          };
        });
        break;
    }

    return (
      <div className="h-full w-full flex flex-col">
        <div className="flex-1 min-h-0 relative">
          <div className="absolute inset-0 border-[length:3px] rounded-xl border-grey dark:border-offwhite">
            <div className="relative h-full w-full overflow-y-auto scrollable p-2 py-4">
              <RecipientsBackground type={selectedRecipientType} />
              
              <div className="grid grid-cols-2 gap-4">
                {recipients.map(recipient => (
                  <div key={recipient.id}>
                    <div className="flex-none">
                      <BasicObjectView
                        name={recipient.name}
                        imageId={recipient.image}
                        id={`recipient-${recipient.id}`}
                        size="size=md xl:size=md 2xl:size=lg 3xl:size=xl"
                        onClick={() => handleRecipientSelect(recipient.id)}
                        border={{
                          width: selectedRecipientIds.has(recipient.id) ? 4 : 2,
                          color: selectedRecipientIds.has(recipient.id) ? 'var(--color-blue)' : undefined
                        }}
                      />
                    </div>
                  </div>
                ))}
                {recipients.length === 0 && (
                  <div className="col-span-2 flex items-center justify-center h-full">
                    <span className="font-bold text-xl text-grey font-['Mohave']">
                      No {selectedRecipientType === 'character' ? 'characters' : 'entities'} available
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <TransferAnimationManager ref={transferAnimationRef} />
      <div className="grid h-full w-full" style={{
        gridTemplateColumns: '26fr 74fr',
        gridTemplateRows: '1fr',
        gap: '0',
        padding: '1vh'
      }}>
        {/* Recipients Section - Top 30% */}
        <div className="w-full flex flex-col p-2 pt-6">
          <CatalogTabs 
            value={selectedRecipientType} 
            onValueChange={(value) => {
              setSelectedRecipientType(value as CatalogRecipientType);
              setSelectedRecipientIds(new Set());
            }}
            className="flex-1 flex flex-col"
          >
            <CatalogTabsList className="flex-shrink-0">
              <CatalogTabsTrigger value="character">
                Characters
              </CatalogTabsTrigger>
              <CatalogTabsTrigger value="globalEntity">
                Global Entities
              </CatalogTabsTrigger>
              <CatalogTabsTrigger value="fieldEntity">
                Field Entities
              </CatalogTabsTrigger>
            </CatalogTabsList>

            <div className="flex-1 min-h-0 px-2">
              {renderRecipientList()}
            </div>
          </CatalogTabs>
        </div>

        {/* Items/Skills Section */}
        <div className="w-full min-h-0 p-2">
          <CoolTabs 
            value={contentType} 
            onValueChange={(value) => onContentTypeChange(value as CatalogContentType)} 
            className="h-full flex flex-col"
          >
            <CoolTabsList className="flex-shrink-0">
              <CoolTabsTrigger value="items" tabType="inventory">Items</CoolTabsTrigger>
              <CoolTabsTrigger value="skills" tabType="skills">Skills</CoolTabsTrigger>
            </CoolTabsList>

            <div className="flex-1 min-h-0">
              <CoolTabsContent value="items" className="h-full">
                <div className="relative h-full overflow-y-auto scrollable">
                  <div className="absolute bottom-[0] right-0 pointer-events-none -z-10">
                    <Treasure className="fill-grey/40 dark:fill-offwhite/40" />
                  </div>
                  <div className="flex flex-wrap justify-center gap-12 p-4 items-start content-start min-w-0">
                    <BasicObjectView
                      name="Create New Item"
                      size="md"
                      id="create-new-item"
                      action={{
                        onClick: () => setShowCreateItem(true),
                        icon: 'arrow'
                      }}
                    />
                    {gameState.globalCollections.items.map(item => (
                      <BasicObjectView
                        key={item.id}
                        id={item.id}
                        name={item.name}
                        imageId={item.image}
                        size="md"
                        onClick={() => setSelectedItem(item.id)} // ✅ Changed to use catalog ID
                        action={{
                          onClick: (e: React.MouseEvent<HTMLElement>) => {
                            // Store the button element
                            actionSourceRef.current = e.currentTarget;
                            handleGiveItem(item);
                          },
                          icon: 'plus',
                          disabled: selectedRecipientIds.size === 0
                        }}
                      />
                    ))}
                  </div>
                </div>
              </CoolTabsContent>

              <CoolTabsContent value="skills" className="h-full">
                <div className="relative h-full overflow-y-auto scrollable">
                  <div className="absolute bottom-[0] right-0 pointer-events-none -z-10">
                    <Key className="fill-grey/40 dark:fill-offwhite/40" />
                  </div>
                  <div className="flex flex-wrap justify-center gap-12 p-4 items-start content-start min-w-0">
                    <BasicObjectView
                      name="Create New Skill"
                      id="create-new-skill"
                      size="md"
                      action={{
                        onClick: () => setShowCreateSkill(true),
                        icon: 'arrow'
                      }}
                    />
                    {gameState.globalCollections.skills.map(skill => (
                      <BasicObjectView
                        key={skill.id}
                        id={skill.id}
                        name={skill.name}
                        imageId={skill.image}
                        size="md"
                        onClick={() => setSelectedSkill(skill.id)} // ✅ Changed to use catalog ID
                        action={{
                          onClick: (e: React.MouseEvent<HTMLElement>) => {
                            // Store the button element
                            actionSourceRef.current = e.currentTarget;
                            handleGrantSkill(skill);
                          },
                          icon: 'plus',
                          disabled: selectedRecipientIds.size === 0
                        }}
                      />
                    ))}
                  </div>
                </div>
              </CoolTabsContent>
            </div>
          </CoolTabs>
        </div>
      </div>

      {/* ✅ UPDATED: Modal interfaces now use catalogId and include isOpen prop */}
      {selectedItem && (
        <Modal isOpen={true} onClose={() => setSelectedItem(null)}>
          <ItemView
            catalogId={selectedItem} // ✅ Using catalogId instead of full object
            gameState={gameState}
            onClose={() => setSelectedItem(null)}
            isRoomCreator={true}
            room={room}
            onGameStateChange={onGameStateChange}
          />
        </Modal>
      )}

      {selectedSkill && (
        <Modal isOpen={true} onClose={() => setSelectedSkill(null)}>
          <SkillView
            catalogId={selectedSkill} // ✅ Using catalogId instead of full object
            gameState={gameState}
            onClose={() => setSelectedSkill(null)}
            isRoomCreator={true}
            room={room}
            onGameStateChange={onGameStateChange}
          />
        </Modal>
      )}

      {showCreateItem && (
        <Modal isOpen={true} onClose={() => setShowCreateItem(false)}>
          <ItemEditor
            onSubmit={handleCreateItem}
            onCancel={() => setShowCreateItem(false)}
          />
        </Modal>
      )}

      {showCreateSkill && (
        <Modal isOpen={true} onClose={() => setShowCreateSkill(false)}>
          <SkillEditor
            onSubmit={handleCreateSkill}
            onCancel={() => setShowCreateSkill(false)}
          />
        </Modal>
      )}
    </>
  );
}