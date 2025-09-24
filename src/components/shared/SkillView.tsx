import React, { useState, useEffect } from 'react';
import { Room } from 'trystero/nostr';
import { Skill, GameState, SkillReference } from '../../types/game';
import { useSkillActions } from '../../actions/skillActions';
import BasicObjectView from '../ui/BasicObjectView';
import Modal from '../shared/Modal';
import { SkillEditor } from '../DungeonMaster/SkillEditor';
import { Plus, Minus, RefreshCw } from 'lucide-react';
import GridMenu, { ActionType } from '../ui/GridMenu';
import { 
  getCatalogSkill, 
  getSkillReferenceName,
  getSkillReferenceUsesLeft,
  skillReferenceHasUses,
  isValidSkillReference 
} from '../../utils/referenceHelpers';

interface SkillViewProps {
  // Either catalog viewing OR instance viewing
  catalogId?: string;                    // For DM catalog mode
  skillReference?: SkillReference;       // For instance viewing
  skillIndex?: number;                   // Index in actor's skills array (for instance mode)
  onClose?: () => void;
  isRoomCreator?: boolean;
  actorId?: string;
  actorType?: 'character' | 'globalEntity' | 'fieldEntity';
  room?: Room;
  gameState: GameState;
  onGameStateChange: (newState: GameState) => void;
}

export const SkillView: React.FC<SkillViewProps> = ({
  catalogId,
  skillReference: initialSkillReference,
  skillIndex,
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
  const [skillReference, setSkillReference] = useState<SkillReference | null>(initialSkillReference || null);
  const [customUses, setCustomUses] = useState<number | undefined>(undefined);

  const skillActions = useSkillActions(room, gameState, onGameStateChange, isRoomCreator);

  // Determine which catalog ID to use for lookups
  const effectiveCatalogId = catalogId || skillReference?.catalogId;
  
  // Get catalog skill for display data
  const catalogSkill = effectiveCatalogId ? getCatalogSkill(effectiveCatalogId, gameState) : null;
  
  // Context detection
  const isViewingFromCatalog = !!catalogId && !skillReference;
  const isViewingInstance = !!skillReference;

  // Instance-specific data (only available when viewing an instance)
  const instanceUsesLeft = skillReference ? getSkillReferenceUsesLeft(skillReference, gameState) : undefined;
  const hasUses = skillReferenceHasUses(skillReference || { catalogId: effectiveCatalogId || '' }, gameState);

  // Keep skillReference state in sync with game state for instances
  useEffect(() => {
    if (!isViewingInstance || !actorId || !actorType || skillIndex === undefined) return;

    let updatedReference: SkillReference | undefined;

    switch (actorType) {
      case 'character':
        const character = gameState.party.find(c => c.id === actorId);
        updatedReference = character?.skills?.[skillIndex];
        break;
      case 'globalEntity':
        const globalEntity = gameState.globalCollections.entities.find(e => e.id === actorId);
        updatedReference = globalEntity?.skills?.[skillIndex];
        break;
      case 'fieldEntity':
        const fieldEntity = gameState.field.find(e => e.instanceId === actorId);
        updatedReference = fieldEntity?.skills?.[skillIndex];
        break;
    }

    if (updatedReference && isValidSkillReference(updatedReference, gameState)) {
      setSkillReference(updatedReference);
    }
  }, [gameState, actorId, actorType, skillIndex, isViewingInstance]);

  // Validation - moved after hooks
  if (!effectiveCatalogId || !catalogSkill) {
    return (
      <div className="p-4 text-center">
        <p className="text-red-500">Error: Invalid skill reference or catalog ID</p>
        <button onClick={onClose} className="mt-2 px-4 py-2 bg-gray-500 text-white rounded">
          Close
        </button>
      </div>
    );
  }

  // Helper function to determine actorType if not provided
  const determineActorType = (actorId: string): 'character' | 'globalEntity' | 'fieldEntity' | null => {
    if (gameState.party.find(c => c.id === actorId)) return 'character';
    if (gameState.globalCollections.entities.find(e => e.id === actorId)) return 'globalEntity';
    if (gameState.field.find(e => e.instanceId === actorId)) return 'fieldEntity';
    return null;
  };

  // Get available actions for GridMenu
  const getAvailableActions = (): ActionType[] => {
    const actions: ActionType[] = [];

    if (isRoomCreator && isViewingFromCatalog) {
      actions.push('edit', 'delete');
    }

    if (isViewingInstance && actorId) {
      if (!hasUses || (instanceUsesLeft !== undefined && instanceUsesLeft > 0)) {
        actions.push('use');
      }
      actions.push('forget');
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
        handleUseSkill();
        break;
      case 'forget':
        handleForgetSkill();
        break;
    }
  };

  const handleUseSkill = async () => {
    if (!actorId || !skillActions) return;
    const type = actorType || determineActorType(actorId);
    if (!type) return;

    try {
      await skillActions.useSkill(effectiveCatalogId, actorId, type);
    } catch (error) {
      console.error('Failed to use skill:', error);
    }
  };

  const handleForgetSkill = async () => {
    if (!actorId || !skillActions) return;
    const type = actorType || determineActorType(actorId);
    if (!type) return;

    try {
      await skillActions.removeSkill(effectiveCatalogId, actorId, type);
      onClose?.();
    } catch (error) {
      console.error('Failed to forget skill:', error);
    }
  };

  const handleDelete = async () => {
    if (!isRoomCreator || !skillActions?.deleteSkill) return;
    try {
      await skillActions.deleteSkill(effectiveCatalogId);
      onClose?.();
    } catch (error) {
      console.error('Failed to delete skill:', error);
    }
  };

  const handleUpdate = async (updates: Omit<Skill, 'id'>) => {
    if (!skillActions?.updateSkill) return;
    try {
      await skillActions.updateSkill(effectiveCatalogId, updates);
      setShowEditor(false);
    } catch (error) {
      console.error('Failed to update skill:', error);
    }
  };

  const handleRestoreUses = async () => {
    if (!isRoomCreator || !skillActions || !actorId) return;
    if (!hasUses) return;

    const type = actorType || determineActorType(actorId);
    if (!type) return;

    const newUses = customUses !== undefined ? customUses : (catalogSkill.uses ?? 0);
    await skillActions.restoreSkillUses(effectiveCatalogId, actorId, type, newUses);
    setCustomUses(undefined);
  };

  const handleIncreaseUses = async () => {
    if (!isRoomCreator || !skillActions || !actorId) return;
    if (!hasUses || instanceUsesLeft === undefined) return;

    const type = actorType || determineActorType(actorId);
    if (!type) return;

    const newUses = Math.min(catalogSkill.uses || 0, instanceUsesLeft + 1);
    await skillActions.restoreSkillUses(effectiveCatalogId, actorId, type, newUses);
  };

  const handleDecreaseUses = async () => {
    if (!isRoomCreator || !skillActions || !actorId) return;
    if (instanceUsesLeft === undefined) return;

    const type = actorType || determineActorType(actorId);
    if (!type) return;

    const newUses = Math.max(0, instanceUsesLeft - 1);
    await skillActions.restoreSkillUses(effectiveCatalogId, actorId, type, newUses);
  };

  // Display data comes from catalog, instance data from reference
  const displayName = catalogSkill.name;
  const displayDescription = catalogSkill.description;
  const displayImage = catalogSkill.image;
  const displayTags = catalogSkill.tags;
  const displayUses = catalogSkill.uses;
  const displayUsesLeft = instanceUsesLeft ?? displayUses; // Instance first, then catalog default
  const displayDamage = catalogSkill.damage;
  const displaySpCost = catalogSkill.spCost;

  return (
    <div className="flex flex-col h-full w-full gap-2 p-0">
      {/* Uses and Tags Section */}
      <div className="grid grid-cols-2 gap-4 items-center">
        {/* Uses Section */}
        <div className="flex items-center gap-2">
          <div className="font-['Mohave'] text-lg">
            {hasUses ? (
              <span>Uses: {displayUsesLeft ?? '∞'}/{displayUses ?? '∞'}</span>
            ) : (
              <span>Uses: ∞</span>
            )}
            {isRoomCreator && isViewingInstance && <span className="ml-2 text-blue dark:text-cyan">(Instance)</span>}
            {isRoomCreator && isViewingFromCatalog && <span className="ml-2 text-blue dark:text-cyan">(Catalog)</span>}
          </div>
          
          {/* DM Usage Controls */}
          {isRoomCreator && hasUses && isViewingInstance && (
            <div className="flex items-center gap-1 ml-4">
              <button
                onClick={handleDecreaseUses}
                disabled={instanceUsesLeft === undefined || instanceUsesLeft <= 0}
                className="w-8 h-8 rounded-full bg-grey/20 dark:bg-offwhite/20 hover:bg-grey/40 dark:hover:bg-offwhite/40 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              
              <button
                onClick={handleIncreaseUses}
                disabled={instanceUsesLeft === undefined || instanceUsesLeft >= (catalogSkill.uses || 0)}
                className="w-8 h-8 rounded-full bg-grey/20 dark:bg-offwhite/20 hover:bg-grey/40 dark:hover:bg-offwhite/40 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
              
              <button
                onClick={handleRestoreUses}
                className="w-8 h-8 rounded-full bg-grey/20 dark:bg-offwhite/20 hover:bg-grey/40 dark:hover:bg-offwhite/40 flex items-center justify-center transition-colors ml-2"
                title="Restore to full uses"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Tags Section */}
        <div className="flex flex-wrap gap-2 justify-end">
          {displayTags?.map(tag => (
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

      {/* Header Section */}
      <div className="flex-shrink-0">
        <h3 className="text-2xl 2xl:text-3xl 3xl:text-4xl font-bold font-['BrunoAceSC'] text-grey dark:text-offwhite mb-2">
          {displayName}
        </h3>
      </div>

      {/* Image Section */}
      <div className="flex flex-col justify-center items-center flex-grow gap-0">
        <BasicObjectView 
          name=""
          imageId={displayImage}
          size="size=lg 3xl:size=xl"
        />
        
        {/* Damage and SP Display */}
        <div className="flex flex-row items-center justify-center pt-1 gap-2">
          <div className="text-sm font-['Mohave'] uppercase tracking-wider">Damage</div>
          <div className="font-['BrunoAceSC'] text-3xl bg-clip-text bg-gradient-to-r from-blue to-purple dark:from-cyan dark:to-magenta text-transparent">
            {displayDamage}
          </div>
          <div className="text-sm font-['Mohave'] uppercase tracking-wider">| SP Cost</div>
          <div className="font-['BrunoAceSC'] text-3xl bg-clip-text bg-gradient-to-r from-blue to-purple dark:from-cyan dark:to-magenta text-transparent">
            {displaySpCost}
          </div>
        </div>
      </div>

      {/* Description Section */}
      <div className="border-2 border-grey dark:border-offwhite rounded-lg p-2 min-h-[6rem] max-h-[7rem] overflow-y-auto">
        <p className="font-['Mohave'] text-lg text-left leading-relaxed">
          {displayDescription}
        </p>
      </div>

      {/* Grid Menu Section */}
      <div className="h-12">
        <GridMenu
          onSelect={handleMenuAction}
          availableActions={getAvailableActions()}
        />
      </div>

      {/* Modals */}
      {showEditor && catalogSkill && (
        <Modal
          isOpen={showEditor}
          onClose={() => setShowEditor(false)}
          title="Edit Skill"
        >
          <SkillEditor
            skill={catalogSkill}
            onSubmit={handleUpdate}
            onCancel={() => setShowEditor(false)}
          />
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          isOpen={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title="Confirm Delete"
        >
          <div className="p-0">
            <p className="font-['Mohave']">
              Are you sure you want to delete this skill? This cannot be undone and will remove it from all who had learned it.
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
};