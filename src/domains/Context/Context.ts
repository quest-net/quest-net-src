import { Campaign } from "../Campaign/Campaign";
import { CampaignInfo } from "../Campaign/CampaignInfo";
import { User } from "../User/User";

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
	// Wall-clock timestamp (ms) of the most recent LOCAL change to the synced
	// account profile (User.Name + allowlisted AppSettings). Bumped by
	// markProfileUpdated() on those mutations. Local-only; drives the
	// last-write-wins comparison for the Google Drive profile.json file. 0/absent
	// means "never changed locally", so a cloud profile always wins on first sync.
	ProfileUpdated?: number;
}
