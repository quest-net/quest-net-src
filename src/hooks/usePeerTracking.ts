import { useState, useEffect, useRef } from 'react';
import { useActionService } from '../services/Actions/ActionServiceProvider';
import { useQuestContext } from '../domains/Context/ContextProvider';
import { RoomActions } from '../domains/Room/RoomActions';
import { User } from '../domains/User/User';

export interface PeerInfo {
  peerId: string;      // WebRTC connection ID
  user: User;          // Full user object (contains Id, Name, SelectedCharacters, etc.)
  ping: number | null;
}

export interface PeerTrackingData {
  peers: PeerInfo[];   // Clean array of peer info
  connectionStatus: 'online' | 'connected';
}

export function usePeerTracking(): PeerTrackingData {
  const { actionService } = useActionService();
  const context = useQuestContext();
  
  const [peerUsers, setPeerUsers] = useState<Record<string, User>>({});
  const [peerPings, setPeerPings] = useState<Record<string, number>>({});
  
  const sendUserRef = useRef<((data: any, peerId?: string) => void) | null>(null);
  const pingIntervalsRef = useRef<Record<string, NodeJS.Timeout>>({});

  useEffect(() => {
    console.log('[usePeerTracking] Effect triggered', {
      hasActionService: !!actionService,
      userRole: context.User.Role,
      userId: context.User.Id,
      userName: context.User.Name
    });

    if (!actionService) {
      console.log('[usePeerTracking] No actionService, returning early (NOT clearing state)');
      return;
    }

    const room = actionService['room'];
    if (!room) {
      console.log('[usePeerTracking] No room found in actionService, returning early (NOT clearing state)');
      return;
    }

    console.log('[usePeerTracking] Valid actionService and room found, proceeding with setup');

    console.log('[usePeerTracking] Setting up peer tracking for room');

    // Get initial peer list
    const initialPeers = RoomActions.getConnectedPeerIds(room);
    console.log('[usePeerTracking] Initial connected peers:', initialPeers);

    // Send full User object
    const [sendUser, getUser] = room.makeAction('userState');
    sendUserRef.current = sendUser;

    console.log('[usePeerTracking] Created userState action channel');

    // Broadcast our User object to all existing peers
    console.log('[usePeerTracking] Broadcasting initial user state to all peers', {
      user: context.User,
      peerCount: initialPeers.length
    });
    sendUser(context.User as any);

    // Listen for other peers' User objects
    getUser((userData, peerId) => {
      console.log('[usePeerTracking] Received user data from peer', {
        peerId,
        userData,
        isValidObject: typeof userData === 'object' && userData !== null
      });

      if (typeof userData === 'object' && userData !== null) {
        setPeerUsers(current => {
          const isNewPeer = !current[peerId];
          const updated = {
            ...current,
            [peerId]: userData as unknown as User
          };
          console.log('[usePeerTracking] Updated peer users', {
            peerId,
            userName: (userData as any).Name,
            totalPeers: Object.keys(updated).length,
            isNewPeer
          });
          
          // If this is the first time we're hearing from this peer,
          // respond by sending our user data back to ensure mutual awareness
          if (isNewPeer && sendUserRef.current) {
            console.log('[usePeerTracking] New peer detected, sending user data back', {
              peerId,
              ourUser: context.User
            });
            sendUserRef.current(context.User as any, peerId);
          }
          
          return updated;
        });
      }
    });

    const startPingingPeer = (peerId: string) => {
      console.log('[usePeerTracking] Starting to ping peer:', peerId);

      if (pingIntervalsRef.current[peerId]) {
        clearInterval(pingIntervalsRef.current[peerId]);
      }

      room.ping(peerId).then(ms => {
        console.log('[usePeerTracking] Initial ping result:', { peerId, ms });
        setPeerPings(current => ({
          ...current,
          [peerId]: ms
        }));
      }).catch(err => {
        console.warn('[usePeerTracking] Failed initial ping:', { peerId, error: err });
      });

      pingIntervalsRef.current[peerId] = setInterval(async () => {
        try {
          const ms = await room.ping(peerId);
          setPeerPings(current => ({
            ...current,
            [peerId]: ms
          }));
        } catch (err) {
          console.warn('[usePeerTracking] Failed to ping peer:', { peerId, error: err });
        }
      }, 3000);
    };

    // Set up peer join handler
    actionService.setOnPeerJoin((peerId) => {
      console.log('[usePeerTracking] Peer joined!', {
        peerId,
        currentPeerCount: Object.keys(peerUsers).length,
        willBroadcastTo: peerId
      });

      // Send our User object to the new peer
      if (sendUserRef.current) {
        console.log('[usePeerTracking] Sending user state to new peer', {
          peerId,
          user: context.User
        });
        sendUserRef.current(context.User as any, peerId);
      } else {
        console.warn('[usePeerTracking] sendUserRef not set, cannot send to peer:', peerId);
      }

      startPingingPeer(peerId);
    });

    // Set up peer leave handler
    actionService.setOnPeerLeave((peerId) => {
      console.log('[usePeerTracking] Peer left:', {
        peerId,
        currentPeerCount: Object.keys(peerUsers).length
      });

      setPeerUsers(current => {
        const updated = { ...current };
        delete updated[peerId];
        console.log('[usePeerTracking] Removed peer from users', {
          peerId,
          remainingPeers: Object.keys(updated).length
        });
        return updated;
      });
      
      setPeerPings(current => {
        const updated = { ...current };
        delete updated[peerId];
        return updated;
      });

      if (pingIntervalsRef.current[peerId]) {
        clearInterval(pingIntervalsRef.current[peerId]);
        delete pingIntervalsRef.current[peerId];
      }
    });

    // Start pinging current peers
    const currentPeers = RoomActions.getConnectedPeerIds(room);
    console.log('[usePeerTracking] Starting ping intervals for existing peers:', currentPeers);
    currentPeers.forEach(peerId => startPingingPeer(peerId));

    return () => {
      console.log('[usePeerTracking] Cleaning up peer tracking - clearing intervals and state');
      Object.values(pingIntervalsRef.current).forEach(interval => {
        clearInterval(interval);
      });
      pingIntervalsRef.current = {};
      
      // Clear state on cleanup - this only happens when actionService changes
      setPeerUsers({});
      setPeerPings({});
    };
  }, [actionService]);

  // Re-broadcast when User object changes (e.g., character selection)
  const userJson = JSON.stringify(context.User);

  useEffect(() => {
    console.log('[usePeerTracking] User changed, re-broadcasting', {
      user: context.User,
      hasSendUserRef: !!sendUserRef.current
    });

    if (sendUserRef.current) {
      console.log('[usePeerTracking] Broadcasting updated user state to all peers');
      sendUserRef.current(context.User as any);
    }
  }, [userJson]);

  // Build clean peer list from internal state
  const peers: PeerInfo[] = Object.keys(peerUsers).map(peerId => ({
    peerId,
    user: peerUsers[peerId],
    ping: peerPings[peerId] ?? null
  }));

  const connectionStatus: 'online' | 'connected' = 
    peers.length === 0 ? 'online' : 'connected';

  return {
    peers,
    connectionStatus
  };
}