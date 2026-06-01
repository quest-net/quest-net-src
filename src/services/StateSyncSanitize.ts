// services/StateSyncSanitize.ts
//
// Shared sanitization rules for state broadcast to players. The DM holds the
// canonical campaign with two secrets that players must never see:
//
//   1. Campaign.Id          -- the DM's private GUID; replaced with RoomCode.
//   2. VoxelTerrain.VoxelStorageKey -- formatted `${Campaign.Id}:${terrain.Id}`;
//                              the Id prefix is rewritten to RoomCode.
//
// Both the full-state path (sanitizeCampaignForPlayers) and the per-action
// delta path (sanitizeImmerPatchesForPlayers) apply the SAME rules so the two
// can't drift -- a missed field would leak the DM's GUID/terrain keys.

import type { Patch } from "immer";
import type { Operation } from "fast-json-patch";
import type { Campaign } from "../domains/Campaign/Campaign";

/**
 * Full-object sanitize: deep-clones the campaign and rewrites the secret
 * fields. Used by full-state broadcasts (peer join, periodic fallback,
 * force-with-no-changes).
 */
export function sanitizeCampaignForPlayers(campaign: Campaign): Campaign {
	const sanitized = structuredClone(campaign);
	// Replace secret Campaign ID with room code so players can identify it.
	sanitized.Id = campaign.RoomCode;
	for (const terrain of sanitized.VoxelTerrains ?? []) {
		if (terrain.VoxelStorageKey) {
			terrain.VoxelStorageKey = `${sanitized.Id}:${terrain.Id}`;
		}
	}
	return sanitized;
}

/**
 * Sanitizes a stream of Immer patches (produced against the DM's PRIVATE
 * campaign) into fast-json-patch operations safe to send to players.
 *
 * Three concerns, all handled here:
 *   - Secret rewrite: any patch that sets the root Id, or that carries a
 *     VoxelStorageKey anywhere in its value, is rewritten to use RoomCode.
 *   - Deep values: a single patch can replace an entire VoxelTerrain (or the
 *     whole VoxelTerrains array), carrying a nested VoxelStorageKey -- so patch
 *     values are walked recursively.
 *   - Format: Immer paths are arrays with no leading slash; fast-json-patch
 *     applyPatch (the player apply path) expects JSON-Pointer strings.
 */
export function sanitizeImmerPatchesForPlayers(
	patches: readonly Patch[],
	secretId: string,
	roomCode: string
): Operation[] {
	return patches.map((patch) => sanitizePatch(patch, secretId, roomCode));
}

function sanitizePatch(
	patch: Patch,
	secretId: string,
	roomCode: string
): Operation {
	const path = toJsonPointer(patch.path);

	// `remove` carries no value.
	if (patch.op === "remove") {
		return { op: "remove", path };
	}

	const value = sanitizeValue(patch.path, patch.value, secretId, roomCode);

	// A non-remove op whose value resolved to `undefined` can't be represented
	// as a JSON Patch add/replace: JSON transport drops the `value` key, and
	// both fast-json-patch's validator and the player's applyPatch reject an
	// add/replace with no value. The faithful translation of "this field is now
	// absent" is a remove. (Immer emits this for `entry.Field = undefined`.)
	if (value === undefined) {
		return { op: "remove", path };
	}

	return { op: patch.op, path, value } as Operation;
}

/**
 * Sanitizes a patch value given the path it lands on. The path tells us when a
 * scalar value is itself a secret (root Id, or a VoxelStorageKey leaf);
 * otherwise we deep-walk the value to catch nested VoxelStorageKey fields.
 */
function sanitizeValue(
	path: (string | number)[],
	value: unknown,
	secretId: string,
	roomCode: string
): unknown {
	const leaf = path[path.length - 1];

	// Root campaign Id -> RoomCode.
	if (path.length === 1 && leaf === "Id") {
		return roomCode;
	}

	// A patch that targets a VoxelStorageKey leaf directly.
	if (leaf === "VoxelStorageKey" && typeof value === "string") {
		return rewriteStorageKey(value, secretId, roomCode);
	}

	// Otherwise the value may be a subtree (e.g. a replaced VoxelTerrain or the
	// whole VoxelTerrains array) carrying nested secret fields.
	return sanitizeValueDeep(value, secretId, roomCode);
}

/**
 * Recursively rewrites any `VoxelStorageKey` string field found inside an
 * arbitrary patch value, and strips `undefined` to mirror what JSON transport
 * does over the wire (object keys with `undefined` values are dropped; array
 * holes become `null`). This keeps the emitted ops valid for fast-json-patch's
 * `validate=true` apply path -- Immer freely carries `undefined`-valued keys
 * (e.g. a LogEntry's optional ActorId/TargetId), which the validator rejects.
 * Returns the input unchanged for primitives.
 */
function sanitizeValueDeep(
	value: unknown,
	secretId: string,
	roomCode: string
): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) =>
			entry === undefined ? null : sanitizeValueDeep(entry, secretId, roomCode)
		);
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			// Drop undefined-valued keys -- JSON would, and the validator forbids them.
			if (entry === undefined) continue;
			if (key === "VoxelStorageKey" && typeof entry === "string") {
				out[key] = rewriteStorageKey(entry, secretId, roomCode);
			} else {
				out[key] = sanitizeValueDeep(entry, secretId, roomCode);
			}
		}
		return out;
	}
	return value;
}

/**
 * Rewrites a `${secretId}:${terrainId}` storage key to `${roomCode}:${terrainId}`.
 * Defensive: only swaps when the secret-Id prefix is actually present.
 */
function rewriteStorageKey(
	key: string,
	secretId: string,
	roomCode: string
): string {
	const prefix = `${secretId}:`;
	if (key.startsWith(prefix)) {
		return `${roomCode}:${key.slice(prefix.length)}`;
	}
	return key;
}

/**
 * Converts an Immer patch path (array of keys/indices) to a JSON-Pointer
 * string, escaping `~` and `/` per RFC 6901.
 */
function toJsonPointer(path: (string | number)[]): string {
	if (path.length === 0) return "";
	return (
		"/" +
		path
			.map((segment) =>
				String(segment).replace(/~/g, "~0").replace(/\//g, "~1")
			)
			.join("/")
	);
}
