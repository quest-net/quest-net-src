import { Context } from "../domains/Context/Context";
import type { Campaign } from "../domains/Campaign/Campaign";
import { VersionedMigration } from "./types";

/**
 * Migration 1.5.1: adds optional DM-controlled player movement restriction.
 *
 * Existing campaigns keep the historical permissive movement behavior.
 */
export const migration_1_5_1: VersionedMigration = {
	version: "1.5.1",

	update: (context: Context): Context => {
		const campaigns = (context.Campaigns ?? []) as unknown as Campaign[];
		for (const campaign of campaigns) {
			if (!campaign.Settings.MovementSettings) continue;
			campaign.Settings.MovementSettings.restrictPlayerMovementToRange ??= false;
		}

		return { ...context, version: "1.5.1" };
	},

	reset: (context: Context): Context => {
		const campaigns = (context.Campaigns ?? []) as unknown as Campaign[];
		for (const campaign of campaigns) {
			if (!campaign.Settings.MovementSettings) continue;
			delete (campaign.Settings.MovementSettings as {
				restrictPlayerMovementToRange?: boolean;
			}).restrictPlayerMovementToRange;
		}

		return { ...context, version: "1.5.0" };
	},
};
