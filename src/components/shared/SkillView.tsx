import React, { useState, useEffect } from 'react';
import { Room } from 'trystero/nostr';
import { Skill, GameState } from '../../types/game';
import { useSkillActions } from '../../actions/skillActions';
import BasicObjectView from '../ui/BasicObjectView';
import Modal from '../shared/Modal';
import { SkillEditor } from '../DungeonMaster/SkillEditor';
import { Plus, Minus, RefreshCw } from 'lucide-react';
import GridMenu, { ActionType } from '../ui/GridMenu';

interface SkillViewProps {
  skill: Skill;
  onClose?: () => void;
  isRoomCreator?: boolean;
  actorId?: string;
  actorType?: 'character' | 'globalEntity' | 'fieldEntity';
  room?: Room;
  gameState: GameState;
  onGameStateChange: (newState: GameState) => void;
}

export const SkillView: React.FC<SkillViewProps> = ({
  skill: initialSkill,
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
  const [skill, setSkill] = useState(initialSkill);
  const [customUses, setCustomUses] = useState<number | undefined>(undefined);

  const skillActions = useSkillActions(room, gameState, onGameStateChange, isRoomCreator);
  const isViewingFromCatalog = !actorId;

  // Keep skill state in sync with game state
  useEffect(() => {
    if (actorId && actorType) {
      const actor = actorType === 'character'
        ? gameState.party.find(c => c.id === actorId)
        : actorType === 'globalEntity'
        ? gameState.globalCollections.entities.find(e => e.id === actorId)
        : gameState.field.find(e => e.id === actorId);

      const updatedSkill = actor?.skills.find(s => s.id === skill.id);
      if (updatedSkill) {
        setSkill(updatedSkill);
      }
    } else {
      const catalogSkill = gameState.globalCollections.skills.find(s => s.id === skill.id);
      if (catalogSkill) {
        setSkill(catalogSkill);
      }
    }
  }, [gameState, skill.id, actorId, actorType]);

  // Get available actions for GridMenu
  const getAvailableActions = (): ActionType[] => {
    const actions: ActionType[] = [];

    if (isRoomCreator && isViewingFromCatalog) {
      actions.push('edit', 'delete');
    }

    if (actorId) {
      if (skill.uses === undefined || skill.usesLeft! > 0) {
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
    if (!actorId || !skillActions || !actorType) return;
    await skillActions.useSkill(skill.id, actorId, actorType);
  };

  const handleForgetSkill = async () => {
    if (!actorId || !skillActions || !actorType) return;
    await skillActions.removeSkill(skill.id, actorId, actorType);
    onClose?.();
  };

  const handleDelete = async () => {
    if (!isRoomCreator || !skillActions?.deleteSkill) return;
    try {
      await skillActions.deleteSkill(skill.id);
      onClose?.();
    } catch (error) {
      console.error('Failed to delete skill:', error);
    }
  };

  const handleRestoreUses = async () => {
    if (!isRoomCreator || !skillActions || !actorId || !actorType) return;
    if (skill.uses === undefined) return;

    const newUses = customUses !== undefined ? customUses : skill.uses;
    await skillActions.restoreSkillUses(skill.id, actorId, actorType, newUses);
    setCustomUses(undefined);
  };

  const handleIncreaseUses = async () => {
    if (!isRoomCreator || !skillActions || !actorId || !actorType) return;
    if (skill.uses === undefined || skill.usesLeft === undefined) return;

    const newUses = Math.min(skill.uses, skill.usesLeft + 1);
    await skillActions.restoreSkillUses(skill.id, actorId, actorType, newUses);
  };

  const handleDecreaseUses = async () => {
    if (!isRoomCreator || !skillActions || !actorId || !actorType) return;
    if (skill.usesLeft === undefined) return;

    const newUses = Math.max(0, skill.usesLeft - 1);
    await skillActions.restoreSkillUses(skill.id, actorId, actorType, newUses);
  };

  return (
    <div className="flex flex-col h-full w-full gap-2 p-0">
      {/* Uses and Tags Section */}
      <div className="grid grid-cols-2 gap-4 items-center">
        {/* Uses Section */}
        <div className="flex items-center gap-2">
          <div className="font-['Mohave'] text-lg">
            {skill.uses !== undefined ? (
              <span>Uses: {skill.usesLeft ?? skill.uses} / {skill.uses}</span>
            ) : (
              <span>Unlimited Uses</span>
            )}
          </div>
          
          {isRoomCreator && skill.uses !== undefined && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleDecreaseUses}
                className="p-1 rounded-full hover:bg-grey/10 dark:hover:bg-offwhite/10"
                title="Decrease uses"
              >
                <Minus size={16} />
              </button>
              
              <input
                type="number"
                value={customUses ?? ''}
                onChange={e => setCustomUses(e.target.value ? Number(e.target.value) : undefined)}
                placeholder={skill.uses.toString()}
                className="w-16 px-2 py-1 rounded border dark:bg-grey font-['Mohave']"
              />
              
              <button
                onClick={handleRestoreUses}
                className="p-1 rounded-full hover:bg-grey/10 dark:hover:bg-offwhite/10"
                title="Set uses"
              >
                <RefreshCw size={16} />
              </button>

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

        {/* Tags Section */}
        <div className="flex flex-wrap gap-2 justify-end items-center">
          {skill.tags?.map(tag => (
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

      {/* Image Section */}
      <div className="flex flex-col justify-center items-center flex-grow gap-0">
        <BasicObjectView 
          name=""
          imageId={skill.image}
          size="size=lg 3xl:size=xl"
        />
        
        {/* Damage and SP Display */}
        <div className="flex flex-row items-center justify-center pt-1 gap-2">
          <div className="text-sm font-['Mohave'] uppercase tracking-wider">Damage</div>
          <div className="font-['BrunoAceSC'] text-3xl bg-clip-text bg-gradient-to-r from-blue to-purple dark:from-cyan dark:to-magenta text-transparent">
            {skill.damage}
          </div>
          <div className="text-sm font-['Mohave'] uppercase tracking-wider">| SP Cost</div>
          <div className="font-['BrunoAceSC'] text-3xl bg-clip-text bg-gradient-to-r from-blue to-purple dark:from-cyan dark:to-magenta text-transparent">
            {skill.spCost}
          </div>
        </div>
      </div>

      {/* Description Section */}
      <div className="border-2 border-grey dark:border-offwhite rounded-lg p-2 min-h-[6rem] max-h-[7rem] overflow-y-auto">
        <p className="font-['Mohave'] text-lg text-left leading-relaxed">
          {skill.description}
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
      {showEditor && (
        <Modal
          isOpen={showEditor}
          onClose={() => setShowEditor(false)}
          title="Edit Skill"
        >
          <SkillEditor
            skill={skill}
            onSubmit={async (updates) => {
              if (!skillActions?.updateSkill) return;
              await skillActions.updateSkill(skill.id, updates);
              setShowEditor(false);
            }}
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