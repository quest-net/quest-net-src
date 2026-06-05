// services/StateSyncSanitize.ts
//
// Shared sanitization rules for state broadcast to players. The DM holds the
// canonical campaign with ONE secret that players must never see:
//
//   Campaign.Id -- the DM's private GUID; replaced with the public RoomCode.
//
// (Terrain voxel payloads and their storage keys are no longer fields on the
// synced campaign object -- they live per-client in TerrainPayloadStore /
// IndexedDB and are fetched over a dedicated channel -- so there is nothing
// terrain-shaped left to sanitize here.)
//
// Both the full-state path (sanitizeCampaignForPlayers) and the per-action
// delta path (sanitizeImmerPatchesForPlayers) apply the SAME rule so the two
// can't drift.

import type { Patch } from "immer";
import type { Operation } from "fast-json-patch";
import type { Campaign } from "../domains/Campaign/Campaign";

/**
 * Full-object sanitize: deep-clones the campaign and rewrites the secret Id.
 * Used by full-state broadcasts (peer join, periodic fallback, force-with-no-
 * changes).
 */
export function sanitizeCampaignForPlayers(campaign: Campaign): Campaign {
	const sanitized = structuredClone(campaign);
	// Replace secret Campaign ID with room code so players can identify it.
	sanitized.Id = campaign.RoomCode;
	return sanitized;
}

/**
 * Sanitizes a stream of Immer patches (produced against the DM's PRIVATE
 * campaign) into fast-json-patch operations safe to send to players.
 *
 * Two concerns, both handled here:
 *   - Secret rewrite: a patch that sets the root Id is rewritten to RoomCode.
 *   - Format: Immer paths are arrays with no leading slash; fast-json-patch
 *     applyPatch (the player apply path) expects JSON-Pointer strings.
 *
 * `secretId` is retained in the signature for call-site symmetry with the
 * full-state path; the storage-key rewrite that used it is gone.
 */
export function sanitizeImmerPatchesForPlayers(
	patches: readonly Patch[],
	secretId: string,
	roomCode: string
): Operation[] {
	void secretId;
	return patches.map((patch) => sanitizePatch(patch, roomCode));
}

function sanitizePatch(patch: Patch, roomCode: string): Operation {
	const path = toJsonPointer(patch.path);

	// `remove` carries no value.
	if (patch.op === "remove") {
		return { op: "remove", path };
	}

	const value = sanitizeValue(patch.path, patch.value, roomCode);

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
 * Sanitizes a patch value given the path it lands on. The only secret is the
 * root campaign Id; otherwise we deep-walk the value to strip `undefined`
 * (which JSON transport would drop and the validator forbids).
 */
function sanitizeValue(
	path: (string | number)[],
	value: unknown,
	roomCode: string
): unknown {
	const leaf = path[path.length - 1];

	// Root campaign Id -> RoomCode.
	if (path.length === 1 && leaf === "Id") {
		return roomCode;
	}

	return sanitizeValueDeep(value);
}

/**
 * Recursively strips `undefined` to mirror what JSON transport does over the
 * wire (object keys with `undefined` values are dropped; array holes become
 * `null`). This keeps the emitted ops valid for fast-json-patch's
 * `validate=true` apply path -- Immer freely carries `undefined`-valued keys
 * (e.g. a LogEntry's optional ActorId/TargetId), which the validator rejects.
 * Returns the input unchanged for primitives.
 */
function sanitizeValueDeep(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) =>
			entry === undefined ? null : sanitizeValueDeep(entry)
		);
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			// Drop undefined-valued keys -- JSON would, and the validator forbids them.
			if (entry === undefined) continue;
			out[key] = sanitizeValueDeep(entry);
		}
		return out;
	}
	return value;
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
