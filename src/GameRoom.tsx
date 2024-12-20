import React, { useEffect, useCallback, useState } from 'react';
import { selfId } from 'trystero';
import { PlayerView } from './components/Player/PlayerView';
import { DMView } from './components/DungeonMaster/DMView';
import { GameInterface } from './components/GameInterface';
import LobbySystem from './components/LobbySystem';
import { useRoom } from './hooks/useRoom';
import { useGamePersistence } from './hooks/useGamePersistence';
import { roomManager } from './services/RoomManager';
import type { ConnectionStatusType } from './types/connection';
import { DMTabType, PlayerTabType, AllTabTypes, ModalControls, CatalogControls } from './services/NavigationManager';

interface GameRoomProps {
  onConnectionUpdate: (
    status: ConnectionStatusType,
    peers: string[],
    error: string,
    roomId: string
  ) => void;
}

function GameRoom({ onConnectionUpdate }: GameRoomProps) {
  const [hasJoinedRoom, setHasJoinedRoom] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [isRoomCreator, setIsRoomCreator] = useState(false);
  const [dmActiveTab, setDmActiveTab] = useState<DMTabType>('characters');
  const [playerActiveTab, setPlayerActiveTab] = useState<PlayerTabType>('equipment');
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [showEquipmentModal, setShowEquipmentModal] = useState(false);
  const [showSkillsModal, setShowSkillsModal] = useState(false);
  const [modalControls, setModalControls] = useState<ModalControls | undefined>();
  const [catalogControls, setCatalogControls] = useState<CatalogControls | undefined>();

  const {
    peers,
    connectionStatus,
    errorMessage,
    gameState,
    handleGameStateChange,
    room
  } = useRoom(hasJoinedRoom ? roomId : '', isRoomCreator);

  const {
    saveGameState
  } = useGamePersistence(roomId, isRoomCreator);

  const handleJoinRoom = (id: string, isHost: boolean) => {
    setRoomId(id);
    setIsRoomCreator(isHost);
    setHasJoinedRoom(true);
  };

  useEffect(() => {
    const status = hasJoinedRoom ? connectionStatus : 'disconnected';
    const currentPeers = hasJoinedRoom ? peers : [];
    const error = hasJoinedRoom ? errorMessage : '';
    const currentRoomId = hasJoinedRoom ? roomId : '';
    
    onConnectionUpdate(status, currentPeers, error, currentRoomId);
  }, [connectionStatus, peers, errorMessage, roomId, hasJoinedRoom, onConnectionUpdate]);

  const handleCharacterSelect = (characterId: string) => {
    if (!room) return;
    
    const [sendCharacterSelect] = room.makeAction<{
      playerId: string;
      characterId: string;
    }>('charSelect');

    sendCharacterSelect({
      playerId: selfId,
      characterId
    });
  };

  const handleModalControlsReady = useCallback((controls: ModalControls) => {
    setModalControls(controls);
  }, []);

  const handleCatalogControlsReady = useCallback((controls: CatalogControls) => {
    setCatalogControls(controls);
  }, []);

  const handleLeaveRoom = () => {
    if (isRoomCreator) {
      saveGameState(gameState);
    }
    roomManager.leaveRoom();
    setHasJoinedRoom(false);
    setIsRoomCreator(false);
    setRoomId('');
    setModalControls(undefined);
    setCatalogControls(undefined);
  };

  useEffect(() => {
    return () => {
      roomManager.leaveRoom();
    };
  }, []);

  if (!hasJoinedRoom) {
    return <LobbySystem onJoinRoom={handleJoinRoom} />;
  }

  return (
    <GameInterface
      roomId={roomId}
      peers={peers}
      connectionStatus={connectionStatus}
      errorMessage={errorMessage}
      isRoomCreator={isRoomCreator}
      gameState={gameState}
      onLeaveRoom={handleLeaveRoom}
      onSaveGame={() => saveGameState(gameState)}
      activeTab={isRoomCreator ? dmActiveTab : playerActiveTab}
      onTabChange={(tab: AllTabTypes) => {
        if (isRoomCreator) {
          setDmActiveTab(tab as DMTabType);
        } else {
          setPlayerActiveTab(tab as PlayerTabType);
        }
      }}
      modalControls={modalControls}
      catalogControls={catalogControls}
      onShowInventory={setShowInventoryModal}
      onShowEquipment={setShowEquipmentModal}
      onShowSkills={setShowSkillsModal}
      isInSafeView={!gameState.field.length}
    >
      {isRoomCreator ? (
        <DMView 
          gameState={gameState}
          onGameStateChange={handleGameStateChange}
          room={room}
          isRoomCreator={isRoomCreator}
          activeTab={dmActiveTab}
          onTabChange={setDmActiveTab}
          onModalControlsReady={handleModalControlsReady}
          onCatalogControlsReady={handleCatalogControlsReady}
        />
      ) : (
        <PlayerView
          gameState={gameState}
          playerId={selfId}
          onCharacterSelect={handleCharacterSelect}
          room={room}
          onGameStateChange={handleGameStateChange}
          showInventoryModal={showInventoryModal}
          showEquipmentModal={showEquipmentModal}
          showSkillsModal={showSkillsModal}
          onShowInventory={setShowInventoryModal}
          onShowEquipment={setShowEquipmentModal}
          onShowSkills={setShowSkillsModal}
          activeTab={playerActiveTab}
          onTabChange={setPlayerActiveTab}
          connectionStatus={connectionStatus}
        />
      )}
    </GameInterface>
  );
}

export default GameRoom;