// domains/Room/Room.ts

import { joinRoom } from "trystero";

/**
 * Re-export the Room type from Trystero
 * This is the live connection object with WebSocket channels
 *
 * Usage:
 *   const room = RoomService.join('room-code');
 *   const peers = room.getPeers(); // Direct access to Trystero methods
 *   room.onPeerJoin = peerId => ...;
 */
export type Room = ReturnType<typeof joinRoom>;

/**
 * Send function for a Trystero message action (the `.send` returned by
 * `room.makeAction`). Target a specific peer with `{ target }` and attach
 * per-message metadata with `{ metadata }`; omit `target` to broadcast.
 *
 * `metadata` is intentionally loosened to `any`. Trystero's own
 * `SendOptions.metadata` is typed `JsonValue`, which rejects any object
 * carrying optional (`| undefined`) properties — and most of our metadata
 * envelopes (image upload, state-sync compression) have them. The wire
 * payload is plain JSON either way, so we keep metadata open here and let
 * each call site own its shape. `room.makeAction().send` is assignable to
 * this type, so service fields can hold it directly.
 */
export type ActionSend = (
	data: any,
	options?: { target?: string | string[] | null; metadata?: any }
) => Promise<void>;

/**
 * Request function for a Trystero request action (`makeAction(ns, { kind:
 * "request" })`). Sends `data` to a single `target` peer and resolves with
 * that peer's response, or rejects on timeout / disconnect / handler error.
 * Trystero owns request/response correlation, the per-request timeout, and
 * binary chunking of both the request payload and the response.
 *
 * As with ActionSend, `metadata` is loosened to `any`: Trystero's own
 * `RequestOptions.metadata` is `JsonValue`, which rejects objects carrying
 * optional (`| undefined`) properties. `makeAction(...).request` is assignable
 * to this type, so service fields can hold it directly.
 */
export type ActionRequest = (
	data: any,
	options: {
		target: string;
		metadata?: any;
		timeoutMs?: number;
		signal?: AbortSignal;
	}
) => Promise<any>;
