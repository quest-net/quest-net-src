import React, { useState, useEffect } from 'react';
import type { Room } from 'trystero/nostr';
import { SkillReference, GameState } from '../../types/game';
import { useSkillActions } from '../../actions/skillActions';
import BasicObjectView from '../ui/BasicObjectView';
import Modal from '../shared/Modal';
import { SkillView } from '../shared/SkillView';
import { Sparkle, Grid, List } from 'lucide-react';
import { 
  getCatalogSkill, 
  getSkillReferenceName,
  getSkillReferenceUsesLeft,
  skillReferenceHasUses,
  isValidSkillReference 
} from '../../utils/referenceHelpers';

interface SkillsPanelProps {
  skills: SkillReference[];  // Now expects SkillReference[] instead of Skill[]
  onClose?: () => void;
  isRoomCreator?: boolean;
  actorId?: string;
  actorType?: 'character' | 'globalEntity' | 'fieldEntity';
  room?: Room;
  gameState: GameState;
  onGameStateChange: (newState: GameState) => void;
  isModal?: boolean;
}

export function SkillsPanel({
  skills: initialSkills,
  room,
  gameState,
  onGameStateChange,
  actorId,
  isModal = true,
  isRoomCreator = false,
  actorType,
  onClose
}: SkillsPanelProps) {
  const [selectedSkill, setSelectedSkill] = useState<{ skillRef: SkillReference; index: number } | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const skillActions = useSkillActions(room, gameState, onGameStateChange, isRoomCreator);

  // Get current skills state from gameState based on actorId and type
  const getCurrentSkills = () => {
    if (!actorId || !actorType) return initialSkills;

    switch (actorType) {
      case 'character':
        return gameState.party.find(c => c.id === actorId)?.skills ?? initialSkills;
      case 'globalEntity':
        return gameState.globalCollections.entities.find(e => e.id === actorId)?.skills ?? initialSkills;
      case 'fieldEntity':
        return gameState.field.find(e => e.instanceId === actorId)?.skills ?? initialSkills;
      default:
        return initialSkills;
    }
  };

  const currentSkills = getCurrentSkills();

  // Update selected skill when gameState changes
  useEffect(() => {
    if (selectedSkill) {
      const updatedSkillRef = currentSkills[selectedSkill.index];
      if (updatedSkillRef && isValidSkillReference(updatedSkillRef, gameState)) {
        setSelectedSkill({
          skillRef: updatedSkillRef,
          index: selectedSkill.index
        });
      } else {
        setSelectedSkill(null);
      }
    }
  }, [gameState, selectedSkill?.index]);

  const renderSkillGrid = () => (
    <div className="flex flex-wrap justify-evenly content-start gap-6 px-6 py-4">
      {currentSkills.map((skillRef, index) => {
        const catalogSkill = getCatalogSkill(skillRef.catalogId, gameState);
        if (!catalogSkill) return null;

        const skillName = getSkillReferenceName(skillRef, gameState);
        const hasUses = skillReferenceHasUses(skillRef, gameState);
        const usesLeft = getSkillReferenceUsesLeft(skillRef, gameState);

        return (
          <div 
            key={`${skillRef.catalogId}-${index}`} 
            className="flex-grow-0 flex-shrink-0"
          >
            <BasicObjectView
              name={skillName}
              imageId={catalogSkill.image}
              id={skillRef.catalogId}
              size="size=sm 2xl:size=md"
              onClick={() => setSelectedSkill({ skillRef, index })}
              action={{
                content: hasUses ? (usesLeft ?? catalogSkill.uses ?? '∞') : '∞',
                onClick: () => setSelectedSkill({ skillRef, index })
              }}
            />
          </div>
        );
      })}
    </div>
  );

  const renderSkillList = () => (
    <div className="space-y-2 p-6">
      {currentSkills.map((skillRef, index) => {
        const catalogSkill = getCatalogSkill(skillRef.catalogId, gameState);
        if (!catalogSkill) return null;

        const skillName = getSkillReferenceName(skillRef, gameState);
        const hasUses = skillReferenceHasUses(skillRef, gameState);
        const usesLeft = getSkillReferenceUsesLeft(skillRef, gameState);

        return (
          <div
            key={`${skillRef.catalogId}-${index}`}
            onClick={() => setSelectedSkill({ skillRef, index })}
            className="flex items-center justify-between p-4 pb-6 font-['Mohave'] text-lg border-b-2 border-grey dark:border-offwhite hover:bg-grey/10 dark:hover:bg-offwhite/10 cursor-pointer"
          >
            <div className="flex items-center">
              <BasicObjectView
                name=""
                imageId={catalogSkill.image}
                id={skillRef.catalogId}
                size="sm"
              />
              <div className="ml-8 flex flex-col items-start">
                <h4 className="font-medium font-['BrunoAceSC']">{skillName}</h4>
                <div className="text-md flex items-center gap-2">
                  <span className="text-blue dark:text-cyan">SP Cost: {catalogSkill.spCost}</span>
                  <span className="text-grey dark:text-offwhite">|</span>
                  <span className="text-magenta dark:text-red">Damage: {catalogSkill.damage}</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center">
              <div className="w-12 h-12 rotate-45 border-2 border-blue dark:border-cyan bg-offwhite dark:bg-grey rounded flex items-center justify-center">
                <div className="-rotate-45 text-blue dark:text-cyan font-medium">
                  {hasUses ? (usesLeft ?? catalogSkill.uses ?? '∞') : '∞'}
                </div>
              </div>
            </div>
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
          <Sparkle className="w-5 h-5" />
          <h2 className="text-xl font-bold">
            Skills
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

      {/* Content - Scrollable with fixed height container */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollable min-h-0 relative">
        {currentSkills.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-500">
            No skills learned
          </div>
        ) : (
          <div className="absolute inset-0 overflow-y-auto scrollable">
            {viewMode === 'grid' ? renderSkillGrid() : renderSkillList()}
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
        
        {selectedSkill && (
          <Modal
            isOpen={!!selectedSkill}
            onClose={() => setSelectedSkill(null)}
            title={getSkillReferenceName(selectedSkill.skillRef, gameState)}
          >
            <SkillView
              skillReference={selectedSkill.skillRef}
              skillIndex={selectedSkill.index}
              onClose={() => setSelectedSkill(null)}
              gameState={gameState}
              onGameStateChange={onGameStateChange}
              room={room}
              actorType={actorType}
              actorId={actorId}
              isRoomCreator={isRoomCreator}
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
      className="max-w-4xl min-w-[48vw]"
    >
      {content}

      {selectedSkill && (
        <Modal
          isOpen={!!selectedSkill}
          onClose={() => setSelectedSkill(null)}
          title={getSkillReferenceName(selectedSkill.skillRef, gameState)}
          className="max-w-[33vw]"
        >
          <SkillView
            skillReference={selectedSkill.skillRef}
            skillIndex={selectedSkill.index}
            onClose={() => setSelectedSkill(null)}
            gameState={gameState}
            onGameStateChange={onGameStateChange}
            room={room}
            actorType={actorType}
            actorId={actorId}
            isRoomCreator={isRoomCreator}
          />
        </Modal>
      )}
    </Modal>
  );
}