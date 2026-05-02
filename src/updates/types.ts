// src/updates/types.ts
import type { Context } from "../domains/Context/Context";
import type { VersionString } from "../version";

/**
 * Async migration for IndexedDB data.
 * Runs after the sync context migration chain in ContextActions.load().
 * Receives and returns the full in-memory Context so it can reshape
 * context.Campaigns (e.g. Campaign[] → CampaignInfo[]) as part of the move.
 * Version is tracked separately under "quest-net-idb-version" in localStorage.
 */
export interface IndexedDBMigration {
  version: VersionString;
  update: (context: Context) => Promise<Context>;
  reset: (context: Context) => Promise<Context>;
}

export interface VersionedMigration {
  /** Target version after applying `up` */
  version: VersionString;

  /**
   * Migrate from the previous version up to `version`.
   * Must set context.version to `version` before returning.
   */
  update: (context: Context) => Context;

  /**
   * Migrate from `version` back down to the previous version.
   * Must set context.version to the previous version before returning.
   */
  reset: (context: Context) => Context;
}
