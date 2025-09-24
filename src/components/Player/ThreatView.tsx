import React, { useState } from 'react';
import type { PlayerViewProps } from '../../types/game';
import { CharacterSheet } from './CharacterSheet';
import PartyList from './PartyList';
import { InventoryPanel } from './InventoryPanel';
import { EquipmentPanel } from './EquipmentPanel';
import { SkillsPanel } from './SkillsPanel';
import { EnvironmentDisplay } from '../shared/ImageDisplay';
import { Field } from './Field';
import { useCharacterActions } from '../../actions/characterActions';
import { useItemActions } from '../../actions/itemActions';
import { useSkillActions } from '../../actions/skillActions';
import BattleMap from '../shared/BattleMap';

interface ThreatViewProps extends PlayerViewProps {
  selectedCharacter: any;
  showInventoryModal?: boolean;
  showEquipmentModal?: boolean;
  showSkillsModal?: boolean;
  onShowInventory?: (show: boolean) => void;
  onShowEquipment?: (show: boolean) => void;
  onShowSkills?: (show: boolean) => void;
}

export function ThreatView({ 
  gameState, 
  onGameStateChange, 
  playerId, 
  onCharacterSelect, 
  room,
  selectedCharacter,
  showInventoryModal,
  showEquipmentModal,
  showSkillsModal,
  onShowInventory,
  onShowEquipment,
  onShowSkills
}: ThreatViewProps) {
  
// Initialize all the necessary actions
const characterActions = useCharacterActions(room, gameState, onGameStateChange, false);
const itemActions = useItemActions(room, gameState, onGameStateChange, false);
const skillActions = useSkillActions(room, gameState, onGameStateChange, false);

// Get selected character
const otherPartyMembers = gameState.party.filter(c => c.playerId !== playerId);

// Handle stat changes for character similarly to SafeView
const handleStatChange = async (statType: 'hp' | 'mp' | 'sp', newValue: number) => {
  if (!selectedCharacter || !room) return;
  await characterActions.updateCharacter(selectedCharacter.id, {
    [statType]: newValue
  });
};
  return (
    <div className="grid h-[88vh] w-full" style={{
        gridTemplateColumns: '28fr 12fr 40fr 20fr',
        gridTemplateRows: '35fr 65fr',
        gap: '0',
        padding: '1vh',
      }}>
      {/* Column 1-2, Row 1: Character Sheet & Stats */}
      <div style={{ gridColumn: '1 / 3', gridRow: '1' }} className="rounded-lg  p-2 overflow-auto">
      {selectedCharacter && (
          <CharacterSheet 
            character={selectedCharacter} 
            gameState={gameState}
            onGameStateChange={newState => {
              onGameStateChange(newState);
              // Handle stat changes like in SafeView
              const updatedCharacter = newState.party.find((c: { id: string; }) => c.id === selectedCharacter.id);
              const currentCharacter = gameState.party.find(c => c.id === selectedCharacter.id);
              if (updatedCharacter && currentCharacter) {
                if (updatedCharacter.hp !== currentCharacter.hp) {
                  handleStatChange('hp', updatedCharacter.hp);
                }
                if (updatedCharacter.mp !== currentCharacter.mp) {
                  handleStatChange('mp', updatedCharacter.mp);
                }
                if (updatedCharacter.sp !== currentCharacter.sp) {
                  handleStatChange('sp', updatedCharacter.sp);
                }
              }
            }}
            showActions={true}
            room={room}
          />
        )}
      </div>

      {/* Column 3-4, Row 1: Battle Map */}
      <div style={{ gridColumn: '3 / 4', gridRow: '1' }} className="rounded-lg p-2 py-4">
        <BattleMap
          gameState={gameState}
          onGameStateChange={onGameStateChange}
          room={room}
          isRoomCreator={false}
        />
      </div>

      {/* Column 1, Row 2: Party Members */}
      <div style={{ gridColumn: '1', gridRow: '2' }} className="rounded-lg  p-2 overflow-auto">
      <PartyList
        characters={otherPartyMembers}
        gameState={gameState}
        onGameStateChange={onGameStateChange}
        layout="vertical"
        room={room}
      />
      </div>

      {/* Column 2-3, Row 2: Image Display */}
      <div style={{ gridColumn: '2 / 4', gridRow: '2' }} className="rounded-lg  p-2 overflow-auto">
        <EnvironmentDisplay gameState={gameState} />
      </div>

      {/* Column 4, Row 1-2: Field Entities */}
      <div style={{ gridColumn: '4', gridRow: '1 / 3' }} className="rounded-lg  p-2 overflow-auto">
        <Field field={gameState.field} gameState={gameState}/>
      </div>

      {/* Modal Panels */}
      {showInventoryModal && selectedCharacter && (
        <InventoryPanel
          inventory={selectedCharacter.inventory}
          onClose={() => onShowInventory?.(false)}
          room={room}
          gameState={gameState}
          onGameStateChange={onGameStateChange}
          actorType='character'
          actorId={selectedCharacter.id}
          isModal={true}
        />
      )}

      {showEquipmentModal && selectedCharacter && (
        <EquipmentPanel
          equipment={selectedCharacter.equipment}
          onClose={() => onShowEquipment?.(false)}
          room={room}
          gameState={gameState}
          onGameStateChange={onGameStateChange}
          actorId={selectedCharacter.id}
          isModal={true}
          isRoomCreator={false}
        />
      )}

      {showSkillsModal && selectedCharacter && (
        <SkillsPanel
          skills={selectedCharacter.skills}
          onClose={() => onShowSkills?.(false)}
          room={room}
          gameState={gameState}
          onGameStateChange={onGameStateChange}
          actorId={selectedCharacter.id}
          actorType="character"
          isModal={true}
        />
      )}
    </div>
  );
}