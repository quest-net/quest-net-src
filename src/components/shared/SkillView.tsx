import React, { useState, useEffect } from 'react';
import { Room } from 'trystero/nostr';
import { Skill, GameState } from '../../types/game';
import { useSkillActions } from '../../actions/skillActions';
import BasicObjectView from '../ui/BasicObjectView';
import Modal from '../shared/Modal';
import { SkillEditor } from '../DungeonMaster/SkillEditor';
import { Plus, Minus, RefreshCw } from 'lucide-react';
import { imageManager } from '../../services/ImageManager';

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
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const skillActions = useSkillActions(room, gameState, onGameStateChange, isRoomCreator);
  const isViewingFromCatalog = !actorId;

  // Load image preview if skill has an image
  useEffect(() => {
    if (initialSkill.image) {
      const thumbnail = imageManager.getThumbnail(initialSkill.image);
      if (thumbnail) {
        setImagePreview(thumbnail);
      }
    }
  }, [initialSkill.image]);

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

  const handleUseSkill = async () => {
    if (!actorId || !skillActions || !actorType) return;
    await skillActions.useSkill(skill.id, actorId, actorType);
  };

  const handleRemoveSkill = async () => {
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
      console.error('Failed to delete item:', error);
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
    <div className="pr-4">
      <div className="flex justify-between items-start gap-4 mb-6">
        <div className="flex gap-6">
          {/* Skill Image */}
          <div className="flex-shrink-0">
            <BasicObjectView
              name=""
              imageId={skill.image}
              size="xl"
            />
          </div>
          
          <div className="flex flex-col">
            <h2 className="text-4xl font-['BrunoAceSC'] font-bold mb-2">{skill.name}</h2>
            <p className="text-gray font-['Mohave'] dark:text-offwhite break-words max-w-xl">
              {skill.description}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 ml-4">
        {isViewingFromCatalog && isRoomCreator && (
          <>
          <button
            onClick={() => setShowEditor(true)}
            className="flex-shrink-0 px-3 py-1 bg-blue dark:bg-cyan text-white dark:text-grey rounded-md hover:opacity-90"
          >
            Edit
          </button>
          <button
          onClick={() => setConfirmDelete(true)}
          className="px-3 py-1 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
        >
          Delete
        </button>
        </>
        )}
        </div>
      </div>

      {/* Skill Stats */}
      <div className="space-y-4 mt-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 border border-grey dark:border-offwhite rounded-lg">
            <h3 className="text-lg font-medium mb-2">Damage</h3>
            <p className="text-2xl font-['Mohave']">{skill.damage}</p>
          </div>
          <div className="p-4 border border-grey dark:border-offwhite rounded-lg">
            <h3 className="text-lg font-medium mb-2">SP Cost</h3>
            <p className="text-2xl font-['Mohave']">{skill.spCost}</p>
          </div>
        </div>

        {skill.uses !== undefined && (
          <div className="flex items-center gap-4">
            <div className="text-sm">
              Uses: {skill.usesLeft ?? skill.uses} / {skill.uses}
            </div>
            
            {/* DM-only uses controls */}
            {isRoomCreator && actorId && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDecreaseUses}
                  className="p-1 rounded-full hover:bg-grey/10 dark:hover:bg-offwhite/10"
                  title="Decrease uses"
                >
                  <Minus size={16} />
                </button>
                
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={customUses ?? ''}
                    onChange={e => setCustomUses(e.target.value ? Number(e.target.value) : undefined)}
                    placeholder={skill.uses.toString()}
                    className="w-16 px-2 py-1 rounded border dark:bg-grey"
                  />
                  <button
                    onClick={handleRestoreUses}
                    className="p-1 rounded-full hover:bg-grey/10 dark:hover:bg-offwhite/10"
                    title="Set uses"
                  >
                    <RefreshCw size={16} />
                  </button>
                </div>

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
        )}

        {skill.tags && skill.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {skill.tags.map(tag => (
              <span 
                key={tag}
                className="px-2 py-1 bg-grey/10 dark:bg-offwhite/10 rounded-full text-xs"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      {actorId && (
        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={handleRemoveSkill}
            className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
          >
            Forget Skill
          </button>
          {(skill.usesLeft === undefined || skill.usesLeft > 0) && (
            <button
              onClick={handleUseSkill}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Use Skill
            </button>
          )}
        </div>
      )}

      {/* Editor Modal */}
      {showEditor && isRoomCreator && (
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
      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <Modal
          isOpen={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title="Confirm Delete"
        >
          <div className="p-4">
            <p>Are you sure you want to delete this skill? This cannot be undone and will remove it from all who had learned it.</p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-1 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
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