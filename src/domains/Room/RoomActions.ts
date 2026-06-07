// domains/Room/RoomActions.ts

import { joinRoom } from "trystero";
import type { JoinRoomCallbacks } from "trystero";
import type { Room } from "./Room";

const APP_ID = "quest-net";

/**
 * Optional callbacks passed to `joinRoom` (Trystero 0.23+).
 *
 * - `onPeerHandshake` runs once per peer right after the transport connects
 *   and BEFORE the peer becomes visible to `getPeers()`, `onPeerJoin`, or
 *   any action receivers. Use it to exchange identity payloads. Throw/reject
 *   to deny the peer (the other side gets `onJoinError`).
 *
 * - `onJoinError` fires on join failures: bad password, handshake denial,
 *   or handshake timeout. Per-peer.
 *
 * This is a direct re-export of trystero's `JoinRoomCallbacks` type so it
 * can never drift from the library's own definitions.
 */
export type RoomCallbacks = JoinRoomCallbacks;

/**
 * Room lifecycle management
 * Pure functions that operate on Room objects
 *
 * For connection info, use Room methods directly:
 *   - room.getPeers() → object with peer IDs as keys
 *   - Object.keys(room.getPeers()) → array of peer IDs
 *   - room.onPeerJoin = callback
 *   - room.onPeerLeave = callback
 */
export const RoomActions = {
	/**
	 * Join a room by room code
	 * Creates a new Trystero connection
	 *
	 * @param roomCode - The room code to join (e.g., "brave-dragon-42")
	 * @param callbacks - Optional `joinRoom` callbacks (handshake, join error)
	 * @returns Room object with WebRTC connections
	 */
	join(roomCode: string | undefined, callbacks?: RoomCallbacks): Room {
		if (!roomCode) {
			roomCode = "ROOMCODE";
		}

		return joinRoom({ appId: APP_ID }, roomCode, callbacks);
	},

	/**
	 * Leave a room and clean up connections
	 *
	 * @param room - The room to leave
	 */
	leave(room: Room): void {
		try {
			room.leave();
		} catch (error) {
			console.error("[Room] Error leaving room:", error);
		}
	},

	/**
	 * Get list of connected peer IDs
	 *
	 * @param room - The room to query
	 * @returns Array of peer ID strings
	 */
	getConnectedPeerIds(room: Room): string[] {
		const peers = room.getPeers();
		return Object.keys(peers);
	},

	/**
	 * Check if the room has any connected peers
	 *
	 * @param room - The room to query
	 * @returns true if at least one peer is connected
	 */
	hasConnectedPeers(room: Room): boolean {
		return this.getConnectedPeerIds(room).length > 0;
	},
};
