// domains/Room/RoomService.ts

import { joinRoom } from "trystero";
import type {
	JoinRoomCallbacks,
	JoinRoomConfig,
	TurnServerConfig,
} from "trystero";
import type { Room } from "./Room";

const APP_ID = "quest-net";

// Must match the host the dashboard issues credentials for. `standard.` and
// `global.` are different servers and creds are not interchangeable — pointing
// at the wrong one fails TURN auth silently, leaving the app on STUN only.
const METERED_RELAY = "global.relay.metered.ca";
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
// announces. None of it is actionable at runtime and the volume buries real
// errors, so it's silenced in production but kept in dev, where it's the only
// visibility into relay behaviour. (Trystero 0.25.3+.)
const WARN_ON_RELAY_FAILURE = import.meta.env.DEV;

/**
 * Optional callbacks passed to `joinRoom` (Trystero 0.23+).
 *
 * - `onPeerHandshake` runs once per peer right after the transport connects
 *   and BEFORE the peer becomes visible to `getPeers()`, `onPeerJoin`, or
 *   any action receivers. Use it to exchange identity payloads. Throw/reject
 *   to deny the peer (the other side gets `onJoinError`).
 *
 * - `onJoinError` fires per peer for bad passwords, handshake denial/timeout,
 *   and SDP exchanges that do not establish a WebRTC connection.
 *
 * This is a direct re-export of trystero's `JoinRoomCallbacks` type so it
 * can never drift from the library's own definitions.
 */
export type RoomCallbacks = JoinRoomCallbacks;

/** Documented Trystero room options that Quest-Net varies per join. */
export interface RoomJoinOptions {
	callbacks?: RoomCallbacks;
	passive?: JoinRoomConfig["passive"];
}

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
	 * @param options - Documented Trystero callbacks and passive-room mode
	 * @returns Room object with WebRTC connections
	 */
	join(
		roomCode: string | undefined,
		{ callbacks, passive = false }: RoomJoinOptions = {}
	): Room {
		if (!roomCode) {
			roomCode = "ROOMCODE";
		}

		// `turnConfig` is APPENDED to Trystero's default STUN list (it does not
		// replace it), so direct ICE still works and TURN is only a fallback.
		// Omitted entirely rather than passed as undefined when unconfigured.
		return joinRoom(
			{
				appId: APP_ID,
				passive,
				relayConfig: { warnOnRelayFailure: WARN_ON_RELAY_FAILURE },
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
