// services/StateSyncSanitize.ts
//
// The single declarative spec of how the DM's private campaign projects to
// players. The DM holds the canonical campaign with ONE secret that players
// must never see:
//
//   Campaign.Id -- the DM's private GUID; replaced with the public RoomCode.
//
// (Terrain voxel payloads and their storage keys are no longer fields on the
// synced campaign object -- they live per-client in TerrainPayloadStore /
// IndexedDB and are fetched over a dedicated channel -- so there is nothing
// terrain-shaped left to sanitize here.)
//
// The secret-field SET (SECRET_CAMPAIGN_FIELDS) is shared by both transport
// paths so they agree on what is secret:
//   - Op deltas  -> isSecretDeltaPath() drops any patch touching a secret field
//                   (operation-based sync, see StateSyncOps).
//   - Full sends -> sanitizeCampaignForPlayers() additionally performs the
//                   Id-specific SWAP to RoomCode (a drop alone isn't enough on a
//                   full send -- players need *a* value to identify the campaign).
// Id never changes mid-session, so dropping its deltas is correct; full sends
// always carry the RoomCode-swapped value.

import type { Campaign } from "../domains/Campaign/Campaign";

/**
 * Top-level campaign fields that must never reach players verbatim. Currently
 * just the secret GUID. Listed once here so the full sanitizer and the delta
 * projector agree on what is secret.
 */
export const SECRET_CAMPAIGN_FIELDS = ["Id"] as const;

/**
 * True when a campaign-relative JSON-Patch path targets a secret field (or a
 * descendant of one). Used by the delta projector to drop such ops.
 */
export function isSecretDeltaPath(path: readonly string[]): boolean {
	return (
		path.length >= 1 &&
		(SECRET_CAMPAIGN_FIELDS as readonly string[]).includes(path[0])
	);
}

/**
 * Full-object sanitize: deep-rebuilds the campaign (stripping `undefined`) and
 * rewrites the secret Id. Used by full-state broadcasts (peer join, periodic
 * fallback, force-with-no-changes).
 *
 * `sanitizeValueDeep` already returns a fresh, fully-owned tree, so it doubles
 * as the deep copy — no separate `structuredClone` is needed. The root it
 * returns is a brand-new object, so the `Id` swap below is safe to apply
 * directly to it.
 */
export function sanitizeCampaignForPlayers(campaign: Campaign): Campaign {
	const sanitized = sanitizeValueDeep(campaign) as Campaign;
	// Replace secret Campaign ID with room code so players can identify it.
	sanitized.Id = campaign.RoomCode;
	return sanitized;
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
