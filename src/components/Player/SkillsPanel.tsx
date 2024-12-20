import React, { useState, useEffect } from 'react';
import type { Room } from 'trystero/nostr';
import { Skill, GameState } from '../../types/game';
import { useSkillActions } from '../../actions/skillActions';
import BasicObjectView from '../ui/BasicObjectView';
import Modal from '../shared/Modal';
import { SkillView } from '../shared/SkillView';
import { Sparkle, Grid, List } from 'lucide-react';

interface SkillsPanelProps {
  skills: Skill[];
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
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
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
        return gameState.field.find(e => e.id === actorId)?.skills ?? initialSkills;
    }
  };

  const currentSkills = getCurrentSkills();

  // Update selected skill when gameState changes
  useEffect(() => {
    if (selectedSkill) {
      const updatedSkill = currentSkills.find(s => s.id === selectedSkill.id);
      if (updatedSkill) {
        setSelectedSkill(updatedSkill);
      } else {
        setSelectedSkill(null);
      }
    }
  }, [gameState]);

  const renderSkillGrid = () => (
    <div className="grid p-[1vw] grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-[1.10vw] auto-rows-max">
      {currentSkills.map((skill) => (
        <div key={skill.id} className="relative">
          <BasicObjectView
            name={skill.name}
            imageId={skill.image}
            id={skill.id}
            size="md"
            onClick={() => setSelectedSkill(skill)}
            action={{
              content: skill.usesLeft ?? skill.uses ?? '∞',
              onClick: () => setSelectedSkill(skill)
            }}
          />
        </div>
      ))}
    </div>
  );

  const renderSkillList = () => (
    <div className="space-y-2 p-[1vw]">
      {currentSkills.map((skill) => (
        <div
          key={skill.id}
          onClick={() => setSelectedSkill(skill)}
          className="flex items-center p-4 border-2 border-grey dark:border-offwhite rounded-lg hover:bg-grey/10 dark:hover:bg-offwhite/10 cursor-pointer"
        >
          <BasicObjectView
            name={skill.name}
            imageId={skill.image}
            id={skill.id}
            size="sm"
            action={{
              content: skill.usesLeft ?? skill.uses ?? '∞',
              onClick: () => setSelectedSkill(skill)
            }}
          />
          <div className="ml-4">
            <h4 className="font-medium">{skill.name}</h4>
            <div className="text-sm text-gray dark:text-offwhite/80">
              SP Cost: {skill.spCost} • Damage: {skill.damage}
            </div>
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
            title={selectedSkill.name}
          >
            <SkillView
              skill={selectedSkill}
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
      className="max-w-4xl"
    >
      {content}

      {selectedSkill && (
        <Modal
          isOpen={!!selectedSkill}
          onClose={() => setSelectedSkill(null)}
          title={selectedSkill.name}
        >
          <SkillView
            skill={selectedSkill}
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