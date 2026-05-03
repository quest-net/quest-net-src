import { VersionedMigration } from "./types";

/**
 * Migration 1.7.0: split campaigns out of localStorage and into IndexedDB.
 *
 * The actual split — writing each Campaign payload to the IndexedDB
 * "campaigns" object store and replacing it with a CampaignInfo metadata
 * record — happens in ContextActions.load(), because IndexedDB is async and
 * our migration system is sync. Here we just bump the version so the
 * migrator stops re-running prior migrations once the load-time reshape has
 * landed.
 *
 * On reset (downgrade), we don't try to re-merge the IndexedDB campaigns
 * back into context.Campaigns — older builds wouldn't be able to find the
 * split-out payloads anyway. We just walk the version back so the
 * downgrading codepath can proceed.
 */
export const migration_1_7_0: VersionedMigration = {
	version: "1.7.0",

	update: (context: any): any => {
		return { ...context, version: "1.7.0" };
	},

	reset: (context: any): any => {
		return { ...context, version: "1.5.1" };
	},
};
