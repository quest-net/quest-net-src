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
// StateSync compares sanitized snapshots to build deltas, so the same sanitized
// shape is used for both full-state sends and JSON Patch generation.

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
	return sanitizeValueDeep(sanitized) as Campaign;
}

/**
 * Recursively strips `undefined` to mirror what JSON transport does over the
 * wire (object keys with `undefined` values are dropped; array holes become
 * `null`). This keeps full-state JSON and emitted ops valid for
 * fast-json-patch's `validate=true` apply path.
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
