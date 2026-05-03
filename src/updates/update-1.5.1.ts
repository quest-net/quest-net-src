import { VersionedMigration } from "./types";

/**
 * Migration 1.5.1: adds optional DM-controlled player movement restriction.
 *
 * Existing campaigns keep the historical permissive movement behavior.
 */
export const migration_1_5_1: VersionedMigration = {
	version: "1.5.1",

	update: (context: any): any => {
		for (const campaign of context.Campaigns ?? []) {
			if (!campaign.Settings.MovementSettings) continue;
			campaign.Settings.MovementSettings.restrictPlayerMovementToRange ??= false;
		}

		return { ...context, version: "1.5.1" };
	},

	reset: (context: any): any => {
		for (const campaign of context.Campaigns ?? []) {
			if (!campaign.Settings.MovementSettings) continue;
			delete (campaign.Settings.MovementSettings as {
				restrictPlayerMovementToRange?: boolean;
			}).restrictPlayerMovementToRange;
		}

		return { ...context, version: "1.5.0" };
	},
};
