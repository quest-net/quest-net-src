import React, { useState } from 'react';
import { Character, DMViewProps } from '../../../types/game';
import { CharacterEditor } from '../../../components/shared/CharacterEditor';
import { CharacterList } from '../CharacterList';
import Modal from '../../shared/Modal';
import {ReactComponent as Char} from '../../ui/char.svg';
import {ReactComponent as Accent} from '../../ui/accent_lines.svg';
import PartyManagementControls from '../PartyManagementControls';

interface CharacterTabProps extends DMViewProps {
  selectedCharacterForInventory: string | null;
  selectedCharacterForEquipment: string | null;
  selectedCharacterForSkills: string | null;
  onCloseInventoryModal: () => void;
  onCloseEquipmentModal: () => void;
  onCloseSkillsModal: () => void;
  showInventoryModal: (characterId: string) => void;
  showEquipmentModal: (characterId: string) => void;
  showSkillsModal: (characterId: string) => void;
}

export function CharacterTab({ 
  gameState, 
  onGameStateChange, 
  room, 
  isRoomCreator,
  selectedCharacterForInventory,
  selectedCharacterForEquipment,
  selectedCharacterForSkills,
  onCloseInventoryModal,
  onCloseEquipmentModal,
  onCloseSkillsModal,
  showInventoryModal,
  showEquipmentModal,
  showSkillsModal
}: CharacterTabProps) {
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const selectedCharacter = selectedCharacterId 
    ? gameState.party.find(c => c.id === selectedCharacterId)
    : undefined;

  const handleAddCharacter = (character: Omit<Character, 'id'>) => {
    const newId = crypto.randomUUID();
    const newCharacter: Character = {
      ...character,
      id: newId,
    };

    onGameStateChange({
      ...gameState,
      party: [...gameState.party, newCharacter]
    });
    setShowEditor(false);
  };

  const handleUpdateCharacter = (id: string, updates: Partial<Character>) => {
    onGameStateChange({
      ...gameState,
      party: gameState.party.map(char =>
        char.id === id ? { ...char, ...updates } : char
      )
    });
    setShowEditor(false);
  };

  const handleDeleteCharacter = (id: string) => {
    onGameStateChange({
      ...gameState,
      party: gameState.party.filter(char => char.id !== id)
    });
    setShowEditor(false);
  };
  // Add handlers in CharacterTab component
const handlePartyHealHP = (amount: number) => {
  const updatedParty = gameState.party.map(char => ({
    ...char,
    hp: Math.min(char.maxHp, char.hp + amount)
  }));

  onGameStateChange({
    ...gameState,
    party: updatedParty
  });
};

const handlePartyHealMP = (amount: number) => {
  const updatedParty = gameState.party.map(char => ({
    ...char,
    mp: Math.min(char.maxMp, char.mp + amount)
  }));

  onGameStateChange({
    ...gameState,
    party: updatedParty
  });
};
const handleRefillItemUses = () => {
  const updatedParty = gameState.party.map(char => ({
    ...char,
    inventory: char.inventory.map(([item, count]) => [
      {
        ...item,
        usesLeft: item.uses // Reset to maximum uses if item has uses defined
      },
      count
    ] as [typeof item, number]) // Assert the tuple type
  }));

  onGameStateChange({
    ...gameState,
    party: updatedParty
  });
};

const handleRefillSkillUses = () => {
  const updatedParty = gameState.party.map(char => ({
    ...char,
    skills: char.skills.map(skill => ({
      ...skill,
      usesLeft: skill.uses // Reset to maximum uses if skill has uses defined
    }))
  }));

  onGameStateChange({
    ...gameState,
    party: updatedParty
  });
};

  return (
    <div className="flex flex-col h-full">
      <div className="absolute inset-0 pointer-events-none -z-10">
        <Char className="absolute -bottom-1/4 -right-1/4 -rotate-[60deg] w-[75%] h-[75%] fill-grey/60 dark:fill-offwhite/60" />
        <Accent className="absolute top-[30%] -left-[10%] scale-[150%] w-[75%] h-[75%] stroke-grey/60 dark:stroke-offwhite/60" />
      </div>
      
      {/* Fixed Header with Add Character Button */}
      <div className="flex justify-center items-center pt-4 px-4">
        <button
          onClick={() => {
            setSelectedCharacterId(null);
            setShowEditor(true);
          }}
          className="px-8 py-2 bg-blue dark:bg-cyan text-white font-['BrunoAceSC'] text-xl dark:text-grey rounded-md transition-colors"
        >
          Add Character
        </button>
        <PartyManagementControls 
          onHealHP={handlePartyHealHP}
          onHealMP={handlePartyHealMP}
          onRefillItemUses={handleRefillItemUses}
          onRefillSkillUses={handleRefillSkillUses}
        />
      </div>

      {/* Scrollable Character List */}
      <div className="flex-1 overflow-y-auto scrollable p-4 px-10">
        <CharacterList
          party={gameState.party}
          onSelectCharacter={(id) => {
            setSelectedCharacterId(id);
            setShowEditor(true);
          }}
          gameState={gameState}
          onGameStateChange={onGameStateChange}
          room={room}
          selectedCharacterForInventory={selectedCharacterForInventory}
          selectedCharacterForEquipment={selectedCharacterForEquipment}
          selectedCharacterForSkills={selectedCharacterForSkills}
          onCloseInventoryModal={onCloseInventoryModal}
          onCloseEquipmentModal={onCloseEquipmentModal}
          onCloseSkillsModal={onCloseSkillsModal}
          showInventoryModal={showInventoryModal}
          showEquipmentModal={showEquipmentModal}
          showSkillsModal={showSkillsModal}
        />

        {/* Empty State */}
        {gameState.party.length === 0 && !showEditor && (
          <div className="text-center py-8 font-['Mohave'] text-xl text-grey">
            <p>Click "Add Character" to create one!</p>
          </div>
        )}
      </div>

      {/* Character Editor Modal */}
      {showEditor && (
        <Modal
          isOpen={showEditor}
          onClose={() => {
            setShowEditor(false);
            setSelectedCharacterId(null);
          }}
          title={selectedCharacter ? 'Edit Character' : 'Create Character'}
        >
          <CharacterEditor
            character={selectedCharacter}
            onSave={handleAddCharacter}
            onUpdate={handleUpdateCharacter}
            onDelete={handleDeleteCharacter}
            onClose={() => {
              setShowEditor(false);
              setSelectedCharacterId(null);
            }}
            isRoomCreator={true}
          />
        </Modal>
      )}
    </div>
  );
}