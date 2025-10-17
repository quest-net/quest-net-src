// domains/Room/Room.ts

import { joinRoom } from 'trystero/nostr';

/**
 * Re-export the Room type from Trystero
 * This is the live connection object with WebSocket channels
 * 
 * Usage:
 *   const room = RoomActions.join('room-code');
 *   const peers = room.getPeers(); // Direct access to Trystero methods
 *   room.onPeerJoin(peerId => ...);
 */
export type Room = ReturnType<typeof joinRoom>;

/**
 * Callbacks for room events
 * Used by RoomActions.setupHandlers()
 */
export interface RoomEventHandlers {
  /** Called when a peer joins the room */
  onPeerJoin?: (peerId: string) => void;
  
  /** Called when a peer leaves the room */
  onPeerLeave?: (peerId: string) => void;
}