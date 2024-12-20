// src/hooks/useConnectionHealth.ts
import { useCallback, useRef, useEffect } from 'react';
import type { Room } from '../types/room';

const RECONNECT_INTERVAL = 5000;
const MAX_RETRIES = 3;
const PING_INTERVAL = 3000;
const PING_TIMEOUT = 2000;

interface UseConnectionHealthProps {
  room: Room | undefined;
  peers: string[];
  onError: (error: Error) => void;
}

export function useConnectionHealth({ room, peers, onError }: UseConnectionHealthProps) {
  const reconnectIntervalRef = useRef<NodeJS.Timeout>();
  const pingIntervalRef = useRef<NodeJS.Timeout>();
  const lastPingResponseRef = useRef<number>(Date.now());
  const retryCountRef = useRef(0);

  const checkConnectionHealth = useCallback(async () => {
    if (!room || peers.length === 0) {
      lastPingResponseRef.current = Date.now(); // Reset timer when no peers
      return;
    }

    try {
      // Create a promise that rejects after timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Ping timeout')), PING_TIMEOUT);
      });

      // Try to ping each peer
      const pingPromises = peers.map(async peerId => {
        try {
          const pingTime = await room.ping(peerId);
          console.log(`Ping to ${peerId}: ${pingTime}ms`);
          return true;
        } catch (e) {
          console.warn(`Failed to ping peer ${peerId}:`, e);
          return false;
        }
      });

      // Race between timeout and successful ping to any peer
      await Promise.race([
        Promise.any(pingPromises),
        timeoutPromise
      ]);

      lastPingResponseRef.current = Date.now();
      retryCountRef.current = 0; // Reset retry count on successful ping
    } catch (error) {
      console.warn('Health check failed:', error);
      const timeSinceLastPing = Date.now() - lastPingResponseRef.current;
      
      if (timeSinceLastPing > RECONNECT_INTERVAL) {
        onError(new Error('Connection timeout - no response from peers'));
      }
    }
  }, [room, peers, onError]);

  const startHealthCheck = useCallback(() => {
    stopHealthCheck(); // Clear any existing intervals
    pingIntervalRef.current = setInterval(checkConnectionHealth, PING_INTERVAL);
    lastPingResponseRef.current = Date.now(); // Reset timer
  }, [checkConnectionHealth]);

  const stopHealthCheck = useCallback(() => {
    if (reconnectIntervalRef.current) {
      clearInterval(reconnectIntervalRef.current);
      reconnectIntervalRef.current = undefined;
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = undefined;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopHealthCheck();
    };
  }, [stopHealthCheck]);

  const handleConnectionError = useCallback((error: any) => {
    console.error('Connection error occurred:', error);
    
    if (retryCountRef.current < MAX_RETRIES) {
      retryCountRef.current++;
      console.log(`Retry attempt ${retryCountRef.current}/${MAX_RETRIES}`);
      onError(error);
    } else {
      if (!reconnectIntervalRef.current) {
        reconnectIntervalRef.current = setInterval(() => onError(error), RECONNECT_INTERVAL);
      }
    }
  }, [onError]);

  return {
    startHealthCheck,
    stopHealthCheck,
    handleConnectionError
  };
}