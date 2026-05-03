// src/updates/update-1.0.3.ts

import type { VersionString } from "../version";
import type { VersionedMigration } from "./types";

const TARGET_VERSION: VersionString = "1.0.3";
const PREVIOUS_VERSION: VersionString = "1.0.2";

const DEFAULT_IMAGE_PROMPT =
	"Produce a square image that will serve as an icon for a {ObjectType} with name : {ObjectName} and description : {ObjectDescription}. White background, no text, fantasy illustration style.";

export const migration_1_0_3: VersionedMigration = {
	version: TARGET_VERSION,

	/**
	 * Upgrade 1.0.2 -> 1.0.3
	 * - Add Campaign.CreatedAt if missing (set to "now")
	 * - Ensure AppSettings contains defaults for new image-generation options
	 */
	update(context: any): any {
		const now = Date.now();

		// Campaign.CreatedAt
		for (const campaign of context.Campaigns) {
			if (typeof (campaign as any).CreatedAt !== "number") {
				(campaign as any).CreatedAt = now;
			}
		}

		// AppSettings: make sure we have an object to work with
		const settings = (context.AppSettings ||= {} as any);

		// Seed the image prompt template if it's missing/empty or not a string
		if (
			typeof settings.imagePromptTemplate !== "string" ||
			!settings.imagePromptTemplate.trim()
		) {
			settings.imagePromptTemplate = DEFAULT_IMAGE_PROMPT;
		}

		// NOTE: We deliberately do NOT touch imageApiKey here.
		// The user must opt-in and provide their own key.

		context.version = TARGET_VERSION;
		return context;
	},

	/**
	 * Downgrade 1.0.3 -> 1.0.2
	 * - Remove Campaign.CreatedAt
	 * - Remove 1.0.3-only AppSettings fields so the shape matches old code
	 */
	reset(context: any): any {
		for (const campaign of context.Campaigns) {
			if ("CreatedAt" in campaign) {
				delete (campaign as any).CreatedAt;
			}
		}

		// Strip out 1.0.3 AppSettings additions
		if (context.AppSettings) {
			const settings = context.AppSettings as any;
			if ("imagePromptTemplate" in settings) {
				delete settings.imagePromptTemplate;
			}
			if ("imageApiKey" in settings) {
				delete settings.imageApiKey;
			}
		}

		context.version = PREVIOUS_VERSION;
		return context;
	},
};
