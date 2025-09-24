import React, { useState, useEffect } from 'react';
import type { PlayerViewProps } from '../../types/game';
import { CharacterSheet } from './CharacterSheet';
import PartyList from './PartyList';
import { InventoryPanel } from './InventoryPanel';
import { EquipmentPanel } from './EquipmentPanel';
import { SkillsPanel } from './SkillsPanel';
import { EnvironmentDisplay } from '../shared/ImageDisplay';
import { CoolTabs, CoolTabsList, CoolTabsTrigger, CoolTabsContent } from '../ui/cooltabs';
import { useCharacterActions } from '../../actions/characterActions';
import { CharacterEditor } from '../shared/CharacterEditor';

type PendingUpdate = {
  type: 'hp' | 'mp' | 'sp';
  value: number;
  timestamp: number;
};

interface SafeViewProps extends PlayerViewProps {
  selectedCharacter: any; // We'll keep the existing props
  showInventoryModal?: boolean;
  showEquipmentModal?: boolean;
  showSkillsModal?: boolean;
  onShowInventory?: (show: boolean) => void;
  onShowEquipment?: (show: boolean) => void;
  onShowSkills?: (show: boolean) => void;
  activeTab?: 'equipment' | 'inventory' | 'skills' | 'settings';
  onTabChange?: (tab: 'equipment' | 'inventory' | 'skills' | 'settings') => void;
}

export function SafeView({ 
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
  onShowSkills,
  activeTab = 'equipment',  // Provide default
  onTabChange
}: SafeViewProps) {
  const [pendingUpdates, setPendingUpdates] = useState<PendingUpdate[]>([]);
  
  const otherPartyMembers = gameState.party.filter(c => c.playerId !== playerId);

  // Add actions for character updates
  const actions = useCharacterActions(room, gameState, onGameStateChange, false);

  const handleCharacterUpdate = async (id: string, updates: any) => {
    if (!actions) return;

    try {
      await actions.updateCharacter(id, updates);
    } catch (error) {
      console.error('Failed to update character:', error);
    }
  };

  const handleStatChange = async (statType: 'hp' | 'mp' | 'sp', newValue: number) => {
    if (!selectedCharacter || !room) return;

    // Add to pending queue
    const update = {
      type: statType,
      value: newValue,
      timestamp: Date.now()
    };
    setPendingUpdates(prev => [...prev, update]);

    await actions.updateCharacter(selectedCharacter.id, {
      [statType]: newValue
    });
  };

  // When we receive new gameState, reconcile with pending updates
  useEffect(() => {
    if (!selectedCharacter || pendingUpdates.length === 0) return;

    // Get all pending updates newer than the last gameState update
    const relevantUpdates = pendingUpdates.filter(update => 
      update.timestamp > gameState.lastModified
    );

    if (relevantUpdates.length > 0) {
      // Apply pending updates on top of received state
      const newState = {...gameState};
      const charIndex = newState.party.findIndex(c => c.id === selectedCharacter.id);
      
      relevantUpdates.forEach(update => {
        newState.party[charIndex][update.type] = update.value;
      });

      onGameStateChange(newState);
    }

    // Clean up old updates
    setPendingUpdates(relevantUpdates);
  }, [gameState, selectedCharacter, pendingUpdates, onGameStateChange]);

  return (
    <>
      <div className="grid h-[88vh] w-full" style={{
        gridTemplateColumns: '4fr 6fr',
        gridTemplateRows: '3fr 7fr',
        gap: '0',
        padding: '1vh 1vh 1vh 1vh',
      }}>
        {/* Column 1, Row 1: Character Sheet & Stats */}
        <div className="rounded-lg pl-2 min-h-0">
          <div className="h-full overflow-auto">
          {selectedCharacter && (
            <CharacterSheet 
              character={selectedCharacter} 
              gameState={gameState}
              onGameStateChange={(newState) => {
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
              room={room}
              showActions={false}
            />
          )}
          </div>
        </div>

        {/* Column 2, Row 1: Party Members */}
        <div className=" min-h-0">
          <div className="h-full max-w-[58vw]">
            <PartyList
              characters={otherPartyMembers}
              gameState={gameState}
              onGameStateChange={onGameStateChange}
              layout="horizontal"
              room={room}
            />
          </div>
        </div>

        {/* Column 1, Row 2: Control Panel with Tabs */}
        <div className="rounded-lg p-2 min-h-0">
          <div className="h-full flex flex-col">
          <CoolTabs 
      value={activeTab} 
      onValueChange={(value) => {
        onTabChange?.(value as typeof activeTab);
        // Close any open modals when switching tabs
        onShowInventory?.(false);
        onShowEquipment?.(false);
        onShowSkills?.(false);
      }}
      className="flex-1 flex flex-col"
            >
              <CoolTabsList>
                <CoolTabsTrigger value="equipment" tabType="equipment" />
                <CoolTabsTrigger value="inventory" tabType="inventory" />
                <CoolTabsTrigger value="skills" tabType="skills" />
                <CoolTabsTrigger value="settings" tabType="settings" />
              </CoolTabsList>

              <CoolTabsContent value="settings" className="flex-1 overflow-auto">
                {selectedCharacter && (
                  <div className="h-full flex items-center justify-center p-4">
                    <CharacterEditor
                      character={selectedCharacter}
                      onSave={() => {}} // Not used in edit mode
                      onUpdate={(id, updates) => {
                        handleCharacterUpdate(id, updates);
                      }}
                      onClose={() => {}}
                      isRoomCreator={false}
                      isModal={false}
                    />
                  </div>
                )}
              </CoolTabsContent>

              <CoolTabsContent value="inventory" className="flex-1 overflow-auto">
                {selectedCharacter && (
                  <InventoryPanel
                    inventory={selectedCharacter.inventory}
                    room={room}
                    gameState={gameState}
                    onGameStateChange={onGameStateChange}
                    actorId={selectedCharacter.id}
                    actorType='character'
                    isModal={false}
                  />
                )}
              </CoolTabsContent>

              <CoolTabsContent value="equipment" className="flex-1 overflow-auto">
                {selectedCharacter && (
                  <EquipmentPanel
                    equipment={selectedCharacter.equipment}
                    room={room}
                    gameState={gameState}
                    onGameStateChange={onGameStateChange}
                    actorId={selectedCharacter.id}
                    isModal={false}
                    isRoomCreator={false}
                  />
                )}
              </CoolTabsContent>

              <CoolTabsContent value="skills" className="flex-1 overflow-auto">
                {selectedCharacter && (
                  <SkillsPanel
                    skills={selectedCharacter.skills}
                    room={room}
                    gameState={gameState}
                    onGameStateChange={onGameStateChange}
                    actorId={selectedCharacter.id}
                    actorType="character"
                    isModal={false}
                  />
                )}
              </CoolTabsContent>
            </CoolTabs>
          </div>
        </div>

        {/* Column 2, Row 2: Image Display */}
        <div className="rounded-lg p-2 min-h-0">
          <div className="h-full overflow-auto">
            <EnvironmentDisplay gameState={gameState} />
          </div>
        </div>
      </div>
    </>
  );
}