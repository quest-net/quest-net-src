// domains/Room/Room.ts

import { joinRoom } from "trystero";

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
