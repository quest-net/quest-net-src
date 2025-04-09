import React, { useState } from 'react';
import { Character } from '../../types/game';
import BasicObjectView from '../ui/BasicObjectView';
import StatGauges from './StatGauges';
import {ReactComponent as Sword} from '../ui/sword.svg'
import {ReactComponent as Bag} from '../ui/bag.svg'
import {ReactComponent as Star} from '../ui/star.svg'
import {ReactComponent as Gear} from '../ui/gear.svg'
import TabButton from '../ui/TabButton';
import { InventoryPanel } from './InventoryPanel';
import { EquipmentPanel } from './EquipmentPanel';
import { SkillsPanel } from './SkillsPanel';
import { CharacterEditor } from '../shared/CharacterEditor';
import Modal from '../shared/Modal';

interface CharacterSheetProps {
  character: Character;
  gameState: any;
  onGameStateChange: (newState: any) => void;
  room?: any;
  showActions?: boolean;
}

export function CharacterSheet({ 
  character, 
  gameState, 
  onGameStateChange, 
  room,
  showActions = false 
}: CharacterSheetProps) {
  const [showInventory, setShowInventory] = useState(false);
  const [showEquipment, setShowEquipment] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="h-full flex items-center">
      <div className="w-full flex gap-0 2xl:gap-2">
        {/* Left side - Large character image */}
        <div className="flex-none">
        <BasicObjectView
            name=""
            imageId={character.image}
            size="size=lg 3xl:size=xl"
          />
          
        </div>

        {/* Right side - Name, buttons, and stats */}
        <div className="flex-1 flex flex-col justify-center">
          {/* Name and action buttons */}
          <div className="flex items-center justify-between mb-4 ml-4">
            <h2 className="xl:text-lg 2xl:text-xl 3xl:text-2xl font-bold bg-grey dark:bg-offwhite text-offwhite dark:text-grey px-4 2xl:px-6 3xl:px-8 py-2 rounded-md mr-2 font-['BrunoAceSC']">
              {character.name}
            </h2>
            {showActions && (
              <div className="flex -space-x-4">
                <TabButton
                  icon={<Sword />}
                  title="Equipment"
                  upsideDown={true}
                  onClick={() => setShowEquipment(true)}
                />
                <TabButton
                  icon={<Bag />}
                  title="Inventory"
                  onClick={() => setShowInventory(true)}
                />
                <TabButton
                  icon={<Star />}
                  title="Skills"
                  upsideDown={true}
                  onClick={() => setShowSkills(true)}
                />
                <TabButton
                  icon={<Gear />}
                  title="Settings"
                  onClick={() => setShowSettings(true)}
                />
              </div>
            )}
          </div>
          <div className="flex-none hidden xl:block 3xl:hidden">
          {/* Stats */}
            <StatGauges
              character={character}
              gameState={gameState}
              onGameStateChange={onGameStateChange}
              editable={true}
              size="small"
              showSideLabels={true}
            />
          </div>
          <div className="flex-none hidden xl:hidden 3xl:block">
          {/* Stats */}
            <StatGauges
              character={character}
              gameState={gameState}
              onGameStateChange={onGameStateChange}
              editable={true}
              size="medium"
              showSideLabels={true}
            />
          </div>
        </div>
      </div>

      {/* Modals */}
      {showInventory && (
        <InventoryPanel
          inventory={character.inventory}
          onClose={() => setShowInventory(false)}
          room={room}
          gameState={gameState}
          onGameStateChange={onGameStateChange}
          actorId={character.id}
          actorType="character"
        />
      )}

      {showEquipment && (
        <EquipmentPanel
          equipment={character.equipment}
          onClose={() => setShowEquipment(false)}
          room={room}
          gameState={gameState}
          onGameStateChange={onGameStateChange}
          actorId={character.id}
        />
      )}

      {showSkills && (
        <SkillsPanel
          skills={character.skills}
          onClose={() => setShowSkills(false)}
          room={room}
          gameState={gameState}
          onGameStateChange={onGameStateChange}
          actorId={character.id}
          actorType="character"
        />
      )}

      {showSettings && (
        <Modal
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          title="Character Settings"
        >
          <CharacterEditor
            character={character}
            onSave={() => {}} // Not used in edit mode
            onUpdate={(id, updates) => {
              onGameStateChange({
                ...gameState,
                party: gameState.party.map((char: { id: string; }) =>
                  char.id === id ? { ...char, ...updates } : char
                )
              });
              setShowSettings(false);
            }}
            onClose={() => setShowSettings(false)}
            isRoomCreator={false}
          />
        </Modal>
      )}
    </div>
  );
}