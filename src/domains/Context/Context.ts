import { Campaign } from "../Campaign/Campaign";
import { CampaignInfo } from "../Campaign/CampaignInfo";
import { User } from "../User/User";
import { APP_VERSION } from "../../version";

export interface Context {
	// User data
	User: User;
	// Lightweight metadata for every campaign the user has on this device.
	// Full campaign payloads live in IndexedDB and are only unpacked into
	// ActiveCampaign while we are actively viewing/playing them.
	Campaigns: CampaignInfo[];
	// The campaign that is currently "unpacked" — either because we are on
	// its URL, or because it was the most recently opened campaign and has
	// not yet been displaced by another. Null when no campaign is active.
	ActiveCampaign: Campaign | null;
	// App Preferences
	AppSettings: Record<string, string>;
	// version
	version: string;
	// Runtime flag to indicate if we are in an optimistic update
	IsOptimistic?: boolean;
	// Runtime flag for DM to prevent broadcasting changes per campaign ID
	SecretModes?: Record<string, boolean>;
	// The DM's most-recently-viewed terrains per campaign ID (newest first,
	// capped at 10; index 0 is the active terrain). Local UI state only, never
	// broadcast. Mirrors the SecretModes shape so it needs no extra context
	// provider.
	ViewedTerrains?: Record<string, string[]>;
	// Wall-clock timestamp (ms) of the most recent LOCAL change to each campaign,
	// keyed by campaign ID. Bumped on every action mutation and on every IDB
	// save, so it reflects ALL edits — including ones that write no log entry.
	// Local-only and never broadcast (lives on Context, not on the Campaign), so
	// a peer's clock can never clobber it. Drives cloud-backup freshness and the
	// campaign-list ordering. Mirrors the SecretModes shape.
	LastUpdated?: Record<string, number>;
	// Monotonic LOCAL mutation counter per campaign ID, bumped alongside
	// LastUpdated. This — not any wall clock — decides cloud-backup freshness:
	// comparing Revisions against BackedUpRevisions is a purely local test, so a
	// device with a skewed clock can neither freeze its own backups nor make a
	// stale copy look newer than a peer's. Local-only, never broadcast.
	Revisions?: Record<string, number>;
	// The Revisions value at this device's last successful upload of each
	// campaign. `Revisions[id] !== BackedUpRevisions[id]` means "local work the
	// cloud does not have yet" (upload it); an absent entry means this device has
	// never uploaded that campaign, so no cross-device comparison is meaningful
	// yet and no restore is ever offered for it. Local-only, never broadcast.
	BackedUpRevisions?: Record<string, number>;
	// BackupKeys of campaigns deleted on this device. Without these, the on-open
	// sync sees "a cloud backup with no local counterpart" and silently restores
	// what the user just deleted. Drive files are never deleted, so a tombstone is
	// how a delete sticks; restoring the campaign deliberately clears it again.
	DeletedBackupKeys?: string[];
	// Wall-clock timestamp (ms) of the most recent LOCAL change to the synced
	// account profile (User.Name + allowlisted AppSettings). Bumped by
	// markProfileUpdated() on those mutations. Local-only; drives the
	// last-write-wins comparison for the Google Drive profile.json file. 0/absent
	// means "never changed locally", so a cloud profile always wins on first sync.
	ProfileUpdated?: number;
}

/**
 * The shape of a brand-new Context, and the single source of truth for what
 * every field defaults to. The store proxy's initial value, a freshly created
 * context, and the defaults applied to a loaded one all derive from here — so
 * adding a field is one edit rather than four.
 *
 * Takes the User rather than minting one, so this stays free of domain imports.
 */
export function createDefaultContext(user: User): Context {
	return {
		User: user,
		Campaigns: [],
		ActiveCampaign: null,
		AppSettings: {},
		version: APP_VERSION,
		SecretModes: {},
		ViewedTerrains: {},
		LastUpdated: {},
		Revisions: {},
		BackedUpRevisions: {},
		DeletedBackupKeys: [],
		ProfileUpdated: 0,
	};
}

/**
 * Fills in whatever a stored Context is missing. A field is taken from `stored`
 * only when it is present and of the right general shape — absent, null, or
 * corrupt-typed values fall back to the default, which is how contexts written
 * by older versions (and ones that bypassed migrations) stay usable.
 */
export function withContextDefaults(stored: Context): Context {
	const defaults = createDefaultContext(stored.User);
	const out = { ...defaults };

	for (const key of Object.keys(defaults) as (keyof Context)[]) {
		const value = stored[key];
		if (value === undefined || value === null) continue;
		// A field whose default is an array must be one; anything else is corrupt.
		if (Array.isArray(defaults[key]) && !Array.isArray(value)) continue;
		(out as Record<string, unknown>)[key] = value;
	}

	return out;
}
