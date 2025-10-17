// hooks/usePeerTracking.ts

import { useState, useEffect, useRef } from 'react';
import { useActionService } from '../services/Actions/ActionServiceProvider';
import { useQuestContext } from '../domains/Context/ContextProvider';
import { RoomActions } from '../domains/Room/RoomActions';

export interface PeerInfo {
  id: string;
  name: string;
  ping: number | null;
}

export interface PeerTrackingData {
  peerIds: string[];
  peerNames: Record<string, string>;
  peerPings: Record<string, number>;
  peerInfoList: PeerInfo[];
  connectionStatus: 'online' | 'connected';
}

export function usePeerTracking(): PeerTrackingData {
  const { actionService } = useActionService();
  const context = useQuestContext();
  const [peerIds, setPeerIds] = useState<string[]>([]);
  const [peerNames, setPeerNames] = useState<Record<string, string>>({});
  const [peerPings, setPeerPings] = useState<Record<string, number>>({});
  
  // Refs to store action functions and intervals
  const sendUserNameRef = useRef<((name: string, peerId?: string) => void) | null>(null);
  const pingIntervalsRef = useRef<Record<string, NodeJS.Timeout>>({});

  useEffect(() => {
    if (!actionService) {
      setPeerIds([]);
      setPeerNames({});
      setPeerPings({});
      return;
    }

    const room = actionService['room'];
    if (!room) {
      setPeerIds([]);
      setPeerNames({});
      setPeerPings({});
      return;
    }

    // Get initial peer list
    setPeerIds(RoomActions.getConnectedPeerIds(room));

    // Set up user name sharing action
    const [sendUserName, getUserName] = room.makeAction('userName');
    sendUserNameRef.current = sendUserName;

    // Broadcast our name to all existing peers
    sendUserName(context.User.Name);

    // Listen for other peers' names
    getUserName((data, peerId) => {
      // Type guard to ensure we received a string
      if (typeof data === 'string') {
        setPeerNames(current => ({
          ...current,
          [peerId]: data
        }));
      }
    });

    // Function to start pinging a peer
    const startPingingPeer = (peerId: string) => {
      // Clear any existing interval for this peer
      if (pingIntervalsRef.current[peerId]) {
        clearInterval(pingIntervalsRef.current[peerId]);
      }

      // Ping immediately
      room.ping(peerId).then(ms => {
        setPeerPings(current => ({
          ...current,
          [peerId]: ms
        }));
      }).catch(err => {
        console.warn(`Failed to ping peer ${peerId}:`, err);
      });

      // Then ping every 3 seconds
      pingIntervalsRef.current[peerId] = setInterval(async () => {
        try {
          const ms = await room.ping(peerId);
          setPeerPings(current => ({
            ...current,
            [peerId]: ms
          }));
        } catch (err) {
          console.warn(`Failed to ping peer ${peerId}:`, err);
        }
      }, 3000);
    };

    // Register callbacks with ActionService
    actionService.setOnPeerJoin((peerId) => {
      setPeerIds(current => {
        if (current.includes(peerId)) return current;
        return [...current, peerId];
      });

      // Send our name to the new peer
      if (sendUserNameRef.current) {
        sendUserNameRef.current(context.User.Name, peerId);
      }

      // Start pinging this peer
      startPingingPeer(peerId);
    });

    actionService.setOnPeerLeave((peerId) => {
      setPeerIds(current => current.filter(id => id !== peerId));
      
      // Clean up peer data
      setPeerNames(current => {
        const updated = { ...current };
        delete updated[peerId];
        return updated;
      });
      
      setPeerPings(current => {
        const updated = { ...current };
        delete updated[peerId];
        return updated;
      });

      // Clear ping interval
      if (pingIntervalsRef.current[peerId]) {
        clearInterval(pingIntervalsRef.current[peerId]);
        delete pingIntervalsRef.current[peerId];
      }
    });

    // Start pinging all current peers
    const currentPeers = RoomActions.getConnectedPeerIds(room);
    currentPeers.forEach(peerId => startPingingPeer(peerId));

    // Cleanup function
    return () => {
      // Clear all ping intervals
      Object.values(pingIntervalsRef.current).forEach(interval => {
        clearInterval(interval);
      });
      pingIntervalsRef.current = {};
    };
  }, [actionService, context.User.Name]);

  // Calculate connection status
  const connectionStatus: 'online' | 'connected' = 
    peerIds.length === 0 ? 'online' : 'connected';

  // Build peer info list
  const peerInfoList: PeerInfo[] = peerIds.map(id => ({
    id,
    name: peerNames[id] || 'Unknown',
    ping: peerPings[id] ?? null
  }));

  return {
    peerIds,
    peerNames,
    peerPings,
    peerInfoList,
    connectionStatus
  };
}