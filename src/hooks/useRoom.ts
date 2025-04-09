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

  // Modified to return a promise so we can await it
  const loadGameStateFromLocalStorage = useCallback(async () => {
    if (!isRoomCreator) {
      console.log(`[useRoom] Not DM, waiting for state from host`);
      setGameState(initialGameState);
      return initialGameState;
    }

    const savedStateKey = `gameState_${roomId}`;
    const savedStateJSON = localStorage.getItem(savedStateKey);
    
    if (savedStateJSON) {
      try {
        const savedState = JSON.parse(savedStateJSON);
        console.log(`[useRoom] DM loaded game state for room ${roomId}:`, savedState.gameState);
        setGameState(savedState.gameState);
        return savedState.gameState;
      } catch (error) {
        console.error(`[useRoom] Failed to load saved state for room ${roomId}:`, error);
        setGameState(initialGameState);
        return initialGameState;
      }
    } else {
      console.log(`[useRoom] No saved state found for room ${roomId}, using initial state`);
      setGameState(initialGameState);
      return initialGameState;
    }
  }, [roomId, setGameState, isRoomCreator]);

  useEffect(() => {
    if (!roomId) {
      setConnectionStatus(ConnectionStatus.DISCONNECTED);
      return;
    }

    const initializeRoom = async () => {
      try {
        console.log(`[useRoom] Connecting to room: ${roomId}`);
        setConnectionStatus(ConnectionStatus.CONNECTING);
        
        // Create the room first
        const newRoom = roomManager.joinRoom(roomId);
        setRoom(newRoom);
        
        // IMPORTANT: Load the state before initializing peer sync
        console.log(`[useRoom] Loading saved state before peer initialization`);
        const loadedState = await loadGameStateFromLocalStorage();
        console.log(`[useRoom] State loaded successfully:`, loadedState);
        
        // Now initialize peer sync with the loaded state
        console.log(`[useRoom] Initializing peer sync`);
        initializePeerSync(newRoom);
        
        // Set up initial peers
        const initialPeers = roomManager.getConnectedPeers();
        setPeers(initialPeers);
        
        setConnectionStatus(ConnectionStatus.CONNECTED);
        setErrorMessage('');

        console.log(`[useRoom] Connected to room: ${roomId}`);
        console.log(`[useRoom] Initial peers:`, initialPeers);
        console.log(`[useRoom] Self ID:`, selfId);

        // Listen for peer updates
        roomManager.events.on('peersChanged', handlePeersChanged);

      } catch (err) {
        console.error('[useRoom] Error joining room:', err);
        setConnectionStatus(ConnectionStatus.ERROR);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to connect');
      }
    };

    initializeRoom();

    // Cleanup on unmount
    return () => {
      if (roomId) {
        console.log(`[useRoom] Cleaning up room: ${roomId}`);
        roomManager.events.off('peersChanged', handlePeersChanged);
        roomManager.leaveRoom();
      }
    };
  }, [roomId, initializePeerSync, handlePeersChanged, loadGameStateFromLocalStorage]);

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