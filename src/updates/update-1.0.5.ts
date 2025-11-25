// src/updates/update-1.0.5.ts

import type { Context } from "../domains/Context/Context";
import type { VersionString } from "../version";
import type { VersionedMigration } from "./types";

const TARGET_VERSION: VersionString = "1.0.5";
const PREVIOUS_VERSION: VersionString = "1.0.4";

const MAX_LOG_SIZE = 1000;

export const migration_1_0_5: VersionedMigration = {
	version: TARGET_VERSION,

	/**
	 * Upgrade 1.0.4 -> 1.0.5
	 * - Add Campaign.LogHead for ring buffer log management
	 *   This reduces state sync patches from ~1000 to 1-2 per log entry
	 */
	update(context: Context): Context {
		for (const campaign of context.Campaigns) {
			if (typeof (campaign as any).LogHead !== "number") {
				// Set LogHead to current length mod MAX_LOG_SIZE
				// This ensures new entries continue from where the log left off
				// If log is already at/over MAX_LOG_SIZE, head points to oldest entry
				(campaign as any).LogHead = campaign.Log.length % MAX_LOG_SIZE;
			}
		}

		context.version = TARGET_VERSION;
		return context;
	},

	/**
	 * Downgrade 1.0.5 -> 1.0.4
	 * - Remove Campaign.LogHead
	 * - Reorder Log array to be chronological (since ring buffer may have wrapped)
	 */
	reset(context: Context): Context {
		for (const campaign of context.Campaigns) {
			const logHead = (campaign as any).LogHead;
			
			// If LogHead exists and log is full, reconstruct chronological order
			if (typeof logHead === "number" && campaign.Log.length >= MAX_LOG_SIZE) {
				const reordered = [];
				for (let i = 0; i < campaign.Log.length; i++) {
					const index = (logHead + i) % campaign.Log.length;
					if (campaign.Log[index]) {
						reordered.push(campaign.Log[index]);
					}
				}
				campaign.Log = reordered;
			}
			
			// Remove LogHead field
			if ("LogHead" in campaign) {
				delete (campaign as any).LogHead;
			}
		}

		context.version = PREVIOUS_VERSION;
		return context;
	},
};