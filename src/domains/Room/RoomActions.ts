// domains/Room/RoomActions.ts

import { joinRoom } from "trystero/nostr";
import type { Room } from "./Room";

const APP_ID = "quest-net";

/**
 * Room lifecycle management
 * Pure functions that operate on Room objects
 *
 * For connection info, use Room methods directly:
 *   - room.getPeers() → object with peer IDs as keys
 *   - Object.keys(room.getPeers()) → array of peer IDs
 *   - room.onPeerJoin(callback)
 *   - room.onPeerLeave(callback)
 */
export const RoomActions = {
	/**
	 * Join a room by room code
	 * Creates a new Trystero connection
	 *
	 * @param roomCode - The room code to join (e.g., "brave-dragon-42")
	 * @returns Room object with WebRTC connections
	 */
	join(roomCode: string | undefined): Room {
		if (!roomCode) {
			roomCode = "ROOMCODE";
		}
		console.log(`[Room] Joining room: ${roomCode}`);

		const config = {
			appId: APP_ID,
		};

		const room = joinRoom(config, roomCode);

		return room;
	},

	/**
	 * Leave a room and clean up connections
	 *
	 * @param room - The room to leave
	 */
	leave(room: Room): void {
		console.log("[Room] Leaving room");

		try {
			room.leave();
			console.log("[Room] Successfully left room");
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
