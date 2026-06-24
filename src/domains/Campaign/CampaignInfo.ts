// domains/Campaign/CampaignInfo.ts

import type { VersionString } from "../../version";

/**
 * Lightweight metadata for a campaign. Lives in the in-memory Context (and
 * therefore in localStorage). The full Campaign payload — including game
 * state, rosters, terrains, scenarios, logs, etc. — is stored separately in
 * IndexedDB and only "unpacked" into Context.ActiveCampaign while we are
 * actively playing or editing it.
 *
 * For the DM, `Id` is the secret Campaign GUID. For players, `Id` is the
 * RoomCode (mirroring the historical sanitization performed by StateSync
 * before broadcasting state to peers).
 */
export interface CampaignInfo {
	/** Secret GUID for DM, or RoomCode for players. */
	Id: string;
	/** Public room code used to connect peers. */
	RoomCode: string;
	/** Display name. */
	Name: string;
	/** Creation timestamp (ms since epoch). */
	CreatedAt: number;
	/** Total characters in roster + active game state (display only). */
	CharacterCount: number;
	/** Schema version of the stored Campaign payload in IndexedDB. */
	Version: VersionString;
	/**
	 * Stable cross-device identity for cloud backup (mirrors Campaign.BackupKey).
	 * Lets on-open backup matching compare against Drive files without loading
	 * full payloads. Undefined until the campaign is first backed up.
	 */
	BackupKey?: string;
}
