import { useCallback, useEffect, useState } from 'react';
import type { Room } from '../types/room';
import { ConnectionStatus, type ConnectionStatusType } from '../types/connection';
import { roomManager } from '../services/RoomManager';
import { usePeerSync } from './usePeerSync';
import { selfId } from 'trystero';
import { initialGameState } from '../types/game';

export function useRoom(roomId: string, isRoomCreator: boolean) {
  const [peers, setPeers] = useState<string[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatusType>(ConnectionStatus.DISCONNECTED);
  const [errorMessage, setErrorMessage] = useState('');
  const [room, setRoom] = useState<Room | undefined>();

  const { 
    initializePeerSync, 
    gameState, 
    setGameState,
    handleGameStateChange,
    broadcastGameState 
  } = usePeerSync(isRoomCreator);

  const handlePeersChanged = useCallback((newPeers: string[]) => {
    console.log(`[useRoom] Peers changed:`, newPeers);
    setPeers(newPeers);
  }, []);

  // Function to load game state from local storage if available
  const loadGameStateFromLocalStorage = useCallback(() => {
    const savedStateKey = `gameState_${roomId}`;
    const savedStateJSON = localStorage.getItem(savedStateKey);
    
    if (savedStateJSON) {
      try {
        const savedState = JSON.parse(savedStateJSON);
        console.log(`[useRoom] Loaded game state for room ${roomId}`);
        setGameState(savedState.gameState);
      } catch (error) {
        console.error(`[useRoom] Failed to load saved state for room ${roomId}:`, error);
        setGameState(initialGameState);
      }
    } else {
      console.log(`[useRoom] No saved state found for room ${roomId}, using initial state`);
      setGameState(initialGameState);
    }
  }, [roomId, setGameState]);

  useEffect(() => {
    if (!roomId) {
      setConnectionStatus(ConnectionStatus.DISCONNECTED);
      return;
    }

    try {
      console.log(`[useRoom] Connecting to room: ${roomId}`);
      setConnectionStatus(ConnectionStatus.CONNECTING);
      
      const newRoom = roomManager.joinRoom(roomId);
      setRoom(newRoom);
      
      // Initialize peer sync
      initializePeerSync(newRoom);
      
      // Set initial peers
      const initialPeers = roomManager.getConnectedPeers();
      setPeers(initialPeers);
      
      setConnectionStatus(ConnectionStatus.CONNECTED);
      setErrorMessage('');

      console.log(`[useRoom] Connected to room: ${roomId}`);
      console.log(`[useRoom] Initial peers:`, initialPeers);
      console.log(`[useRoom] Self ID:`, selfId);

      // Listen for peer updates
      roomManager.events.on('peersChanged', handlePeersChanged);

      // Load saved game state if it exists
      loadGameStateFromLocalStorage();

      return () => {
        roomManager.events.off('peersChanged', handlePeersChanged);
      };
    } catch (err) {
      console.error('[useRoom] Error joining room:', err);
      setConnectionStatus(ConnectionStatus.ERROR);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to connect');
    }
  }, [roomId, initializePeerSync, handlePeersChanged, loadGameStateFromLocalStorage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (roomId) {
        console.log(`[useRoom] Cleaning up room: ${roomId}`);
        roomManager.leaveRoom();
      }
    };
  }, [roomId]);

  return {
    peers,
    connectionStatus,
    errorMessage,
    gameState,
    setGameState,
    handleGameStateChange,
    broadcastGameState,
    room
  };
}
