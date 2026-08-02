// domains/Room/RoomService.ts

import { joinRoom } from "trystero";
import type { JoinRoomCallbacks, TurnServerConfig } from "trystero";
import type { Room } from "./Room";

const APP_ID = "quest-net";

const METERED_RELAY = "standard.relay.metered.ca";
const TURN_USERNAME = import.meta.env.VITE_TURN_USERNAME as string | undefined;
const TURN_CREDENTIAL = import.meta.env.VITE_TURN_CREDENTIAL as
	| string
	| undefined;

function buildTurnConfig(): TurnServerConfig[] | undefined {
	if (!TURN_USERNAME || !TURN_CREDENTIAL) return undefined;

	const username = TURN_USERNAME;
	const credential = TURN_CREDENTIAL;

	return [
		{ urls: "stun:stun.relay.metered.ca:80" },
		{ urls: `turn:${METERED_RELAY}:80`, username, credential },
		{ urls: `turn:${METERED_RELAY}:80?transport=tcp`, username, credential },
		{ urls: `turn:${METERED_RELAY}:443`, username, credential },
		{ urls: `turns:${METERED_RELAY}:443?transport=tcp`, username, credential },
	];
}

// Built once at module load; the env values are inlined at build time.
const TURN_CONFIG = buildTurnConfig();

// Public Nostr relays routinely emit NOTICE / non-OK responses and failed
// announces that Trystero logs as warnings. None of it is actionable at
// runtime -- our own recovery (useRelayWatchdog, useAutoReconnect) keys off
// socket close events and peer health, not these logs -- and the volume buries
// real errors in the console during a long session.
//
// Kept ON in dev, where they're the only visibility into relay behaviour and
// connection debugging is exactly what we're usually doing. Flip this constant
// to silence dev too. (Trystero 0.25.3+.)
const WARN_ON_RELAY_FAILURE = import.meta.env.DEV;

// How many Nostr relays to signal through. Trystero's default is 5 out of a
// 47-relay pool, and the pick is a deterministic shuffle seeded on `appId` --
// so every quest-net client in every session signals through the SAME 5
// relays. Peer discovery and offer/answer exchange all ride those sockets, so
// if a couple of them are slow, rate-limiting, or unreachable from a given
// ISP, a peer's announcements reach some of the room and not the rest. That
// produces a stable partial mesh (the "split brain" reported upstream in
// trystero#189 / #161), and it gets likelier as the room grows, since more
// peers means more announce traffic converging on that same fixed set.
//
// Widening the set is the cheap experiment: more independent paths for the
// same announcements. Cost is more open WebSockets per client and
// proportionally more announce traffic -- at ~5.3s per announce that's still
// on the order of a KB/s, negligible next to a stuck session.
//
// TUNING: this is here to be experimented with. Raise if partial meshes
// persist, lower if relay connections themselves become the problem.
const RELAY_REDUNDANCY = 15;

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
export const RoomService = {
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

		// `turnConfig` is APPENDED to Trystero's default STUN list (it does not
		// replace it), so direct ICE still works and TURN is only a fallback.
		// Omitted entirely rather than passed as undefined when unconfigured.
		return joinRoom(
			{
				appId: APP_ID,
				relayConfig: {
					warnOnRelayFailure: WARN_ON_RELAY_FAILURE,
					redundancy: RELAY_REDUNDANCY,
				},
				...(TURN_CONFIG ? { turnConfig: TURN_CONFIG } : {}),
			},
			roomCode,
			callbacks
		);
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
