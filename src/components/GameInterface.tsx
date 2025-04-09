import React, { ReactNode, useState, useEffect} from 'react';
import type { ConnectionStatusType } from '../types/connection';
import { SlidingToggle } from './ui/ThemeToggle';
import { SearchBar } from './shared/SearchBar';
import { GameState } from '../types/game';
import { NavigationManager, DMTabType, PlayerTabType, AllTabTypes, ModalControls, CatalogControls } from '../services/NavigationManager';
import AutoSave from './DungeonMaster/AutoSave';
import { Volume2 } from 'lucide-react';

interface GameInterfaceProps {
  roomId: string;
  peers: string[];
  connectionStatus: ConnectionStatusType;
  errorMessage: string;
  isRoomCreator: boolean;
  gameState: GameState;
  onLeaveRoom: () => void;
  onSaveGame: () => void;
  activeTab?: AllTabTypes;
  onTabChange?: (tab: AllTabTypes) => void;
  isInSafeView?: boolean;
  modalControls?: ModalControls;
  catalogControls?: CatalogControls;
  onShowInventory?: (show: boolean) => void;
  onShowEquipment?: (show: boolean) => void;
  onShowSkills?: (show: boolean) => void;
  children: ReactNode;
  onLocalVolumeChange?: (volume: number) => void;
}

// Volume control component
const VolumeControl = ({ value, onChange }: { value: number; onChange: (value: number) => void }) => {
  return (
    <div className="flex items-center gap-2 px-3 py-0.5 border-r-2 border-y-2 border-grey dark:border-offwhite bg-offwhite dark:bg-grey rounded-r-md">
      <Volume2 className="w-4 h-4 text-grey dark:text-offwhite" />
      <input
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 h-1 rounded-full appearance-none bg-grey dark:bg-offwhite
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-3
          [&::-webkit-slider-thumb]:h-3
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-grey
          [&::-webkit-slider-thumb]:dark:bg-offwhite
          [&::-webkit-slider-thumb]:cursor-pointer
          [&::-moz-range-thumb]:w-3
          [&::-moz-range-thumb]:h-3
          [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:bg-grey
          [&::-moz-range-thumb]:dark:bg-offwhite
          [&::-moz-range-thumb]:cursor-pointer
          [&::-moz-range-thumb]:border-none"
      />
      <span className="text-[1.5vmin] text-grey dark:text-offwhite min-w-[2.5em]">
        {value}%
      </span>
    </div>
  );
};

export function GameInterface({ 
  roomId,
  peers,
  connectionStatus,
  errorMessage,
  isRoomCreator,
  gameState, 
  onLeaveRoom,
  onSaveGame,
  activeTab,
  onTabChange,
  isInSafeView,
  modalControls,
  catalogControls,
  onShowInventory,
  onShowEquipment,
  onShowSkills,
  onLocalVolumeChange,
  children
}: GameInterfaceProps) {

  const [localVolume, setLocalVolume] = useState(() => {
    const saved = localStorage.getItem('player-volume');
    return saved ? parseInt(saved, 10) : 100;
  });

  // Save local volume to localStorage and notify parent when it changes
  useEffect(() => {
    localStorage.setItem('player-volume', localVolume.toString());
    onLocalVolumeChange?.(localVolume);
  }, [localVolume, onLocalVolumeChange]);


  const handleSearchSelect = (result: {
    id: string;
    type: 'item' | 'skill' | 'character' | 'entity' | 'image' | 'audio';
    location: {
      type: 'catalog' | 'inventory' | 'equipment' | 'skills' | 'field' | 'visuals' | 'encounters' | 'audio' | 'characters';
      containerId?: string;
      containerName?: string;
    };
  }) => {
    if (isRoomCreator && onTabChange) {
      NavigationManager.handleDMNavigation(
        result,
        activeTab as DMTabType,
        (tab: DMTabType) => onTabChange(tab),
        gameState.combat?.isActive || false,
        modalControls,
        catalogControls
      );
    } else {
      NavigationManager.handlePlayerNavigation(
        result,
        isInSafeView || false,
        {
          setShowInventory: onShowInventory,
          setShowEquipment: onShowEquipment,
          setShowSkills: onShowSkills,
          setActiveTab: (tab: PlayerTabType) => onTabChange?.(tab)
        }
      );
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col h-[92vh] transition-colors duration-1000 w-screen mt-[8vh]">
      {/* Header */}
      <div className="flex-shrink-0 p-0">
        <div className="flex items-center justify-between h-[4vh] ml-5 mr-5">
          <div className="flex flex-row gap-0">
            <button
              onClick={onLeaveRoom}
              className="px-3 py-0.5 text-[1.5vmin] bg-grey text-offwhite dark:border-2 border-offwhite rounded-l-md hover:bg-grey/75 dark:hover:bg-offwhite/25 transition-colors"
            >
              Leave Room
            </button>
            {isRoomCreator ? (
              <AutoSave onSave={onSaveGame} isRoomCreator={isRoomCreator} />
            ) : (
              <VolumeControl 
                value={localVolume}
                onChange={setLocalVolume}
              />
            )}
          </div>
          <SearchBar 
            gameState={gameState}
            isRoomCreator={isRoomCreator}
            onResultSelect={handleSearchSelect}
            placeholder="Search items, skills, characters..."
            modalControls={modalControls}
          />
          <div className="darkmode slider">
            <SlidingToggle />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 h-full">
        {children}
      </div>
    </div>
  );
}
