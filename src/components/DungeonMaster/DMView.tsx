import React, { useEffect, useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { DMViewProps } from '../../types/game';
import { CharacterTab } from './Tabs/CharacterTab';
import { VisualsTab } from './Tabs/VisualsTab';
import { CatalogTab } from './Tabs/CatalogTab';
import { EncounterTab } from './Tabs/EncounterTab';
import { BattleTab } from './Tabs/BattleTab';
import { SettingsTab } from './Tabs/SettingsTab';
import { AudioTab } from './Tabs/AudioTab';
import { AudioPlayer } from '../shared/AudioPlayer';
import { setupItemHandlers } from './handlers/setupItemHandlers';
import { setupCharacterHandlers } from './handlers/setupCharacterHandlers';
import { setupEquipmentHandlers } from './handlers/setupEquipmentHandlers';
import { setupSkillHandlers } from './handlers/setupSkillHandlers';
import { setupTransferHandlers } from './handlers/setupTransferHandlers';
import type { ModalControls, CatalogControls, CatalogContentType } from '../../services/NavigationManager';

type TabType = 'characters' | 'visuals' | 'audio' | 'catalog' | 'encounter' | 'battle' | 'settings';

interface ExtendedDMViewProps extends DMViewProps {
  onModalControlsReady?: (controls: ModalControls) => void;
  onCatalogControlsReady?: (controls: CatalogControls) => void;
}

export function DMView({ 
  gameState, 
  onGameStateChange, 
  room, 
  isRoomCreator = true,
  activeTab = 'characters',
  onTabChange,
  onModalControlsReady,
  onCatalogControlsReady
}: ExtendedDMViewProps) {
  // Modal states
  const [selectedCharacterForInventory, setSelectedCharacterForInventory] = useState<string | null>(null);
  const [selectedCharacterForEquipment, setSelectedCharacterForEquipment] = useState<string | null>(null);
  const [selectedCharacterForSkills, setSelectedCharacterForSkills] = useState<string | null>(null);

  // Catalog states
  const [catalogContentType, setCatalogContentType] = useState<CatalogContentType>('items');

  const tabs: { id: TabType; label: string }[] = [
    { id: 'characters', label: 'Characters' },
    { id: 'visuals', label: 'Visuals' },
    { id: 'audio', label: 'Audio' },
    { id: 'catalog', label: 'Catalog' },
    { id: 'encounter', label: 'Encounter' },
    { id: 'battle', label: 'Battle' },
    { id: 'settings', label: 'Settings' }
  ];

  // Modal show handlers
  const showInventoryModal = (characterId: string) => {
    if (onTabChange) {
      onTabChange('characters');
    }
    setSelectedCharacterForInventory(characterId);
  };

  const showEquipmentModal = (characterId: string) => {
    if (onTabChange) {
      onTabChange('characters');
    }
    setSelectedCharacterForEquipment(characterId);
  };

  const showSkillsModal = (characterId: string) => {
    if (onTabChange) {
      onTabChange('characters');
    }
    setSelectedCharacterForSkills(characterId);
  };

  // Create and expose modal controls
  useEffect(() => {
    if (!onModalControlsReady) return;
    
    const modalControls: ModalControls = {
      showInventoryModal,
      showEquipmentModal,
      showSkillsModal
    };

    onModalControlsReady(modalControls);
  }, [onModalControlsReady]);

  // Create and expose catalog controls
  useEffect(() => {
    if (!onCatalogControlsReady) return;
    
    const catalogControls: CatalogControls = {
      setRecipientType: (type) => {
        // This will be handled by CatalogTab internal state
      },
      setContentType: (type) => {
        setCatalogContentType(type);
      }
    };

    onCatalogControlsReady(catalogControls);
  }, [onCatalogControlsReady]);

  // Set up action handlers
  useEffect(() => {
    if (!room || !isRoomCreator) return;


    setupItemHandlers(room, gameState, onGameStateChange);
    setupCharacterHandlers(room, gameState, onGameStateChange);
    setupEquipmentHandlers(room, gameState, onGameStateChange);
    setupSkillHandlers(room, gameState, onGameStateChange);
    setupTransferHandlers(room, gameState, onGameStateChange);

    return () => {
    };
  }, [room, isRoomCreator, gameState, onGameStateChange]);

  return (
    <>
      <AudioPlayer gameState={gameState} isDM={true} />

      <Tabs 
        value={activeTab} 
        onValueChange={(value) => onTabChange?.(value as TabType)}
        className="w-full h-full"
      >
        <TabsList className="w-full flex justify-start border-b border-gray-200 bg-transparent">
          {tabs.map(({ id, label }) => (
            <TabsTrigger
              key={id}
              value={id}
              className="px-4 py-2 text-sm font-medium data-[state=active]:border-b-2 data-[state=active]:border-blue-500 data-[state=active]:text-blue-600"
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="catalog">
          <CatalogTab 
            gameState={gameState}
            onGameStateChange={onGameStateChange}
            room={room}
            onCatalogControlsReady={onCatalogControlsReady}
            contentType={catalogContentType}
            onContentTypeChange={setCatalogContentType}
          />
        </TabsContent>

        <TabsContent value="characters">
          <CharacterTab 
            gameState={gameState} 
            onGameStateChange={onGameStateChange} 
            room={room}
            isRoomCreator={isRoomCreator}
            selectedCharacterForInventory={selectedCharacterForInventory}
            selectedCharacterForEquipment={selectedCharacterForEquipment}
            selectedCharacterForSkills={selectedCharacterForSkills}
            onCloseInventoryModal={() => setSelectedCharacterForInventory(null)}
            onCloseEquipmentModal={() => setSelectedCharacterForEquipment(null)}
            onCloseSkillsModal={() => setSelectedCharacterForSkills(null)}
            showInventoryModal={showInventoryModal}
            showEquipmentModal={showEquipmentModal}
            showSkillsModal={showSkillsModal}
          />
        </TabsContent>

        {/* Other tab contents */}
        <TabsContent value="visuals">
          <VisualsTab 
            gameState={gameState}
            onGameStateChange={onGameStateChange}
            room={room}
            isRoomCreator={true}
          />
        </TabsContent>

        <TabsContent value="audio">
          <AudioTab 
            gameState={gameState}
            onGameStateChange={onGameStateChange}
            room={room}
            isRoomCreator={true}
          />
        </TabsContent>

        <TabsContent value="encounter">
          <EncounterTab 
            gameState={gameState}
            onGameStateChange={onGameStateChange}
            room={room}
          />
        </TabsContent>

        <TabsContent value="battle">
          <BattleTab 
            gameState={gameState}
            onGameStateChange={onGameStateChange}
            room={room}
            isRoomCreator={isRoomCreator}
          />
        </TabsContent>

        <TabsContent value="settings">
          <SettingsTab
            gameState={gameState}
            onGameStateChange={onGameStateChange}
            isRoomCreator={isRoomCreator}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}