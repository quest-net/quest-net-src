// src/migrations/v3_0_0_seedLastUpdated.ts
//
// 3.0.0 introduces Context.LastUpdated: a local-only Record<campaignId, ms> that
// tracks the most recent LOCAL change to each campaign (bumped on every action
// mutation and every IDB save -- see markCampaignUpdated). It replaces the
// log-derived CampaignInfo.LastActivity, which only advanced when an edit wrote
// a Log entry and so let cloud backup skip real changes (settings, terrain,
// scene edits).
//
// This seeds LastUpdated for every known campaign from its prior LastActivity
// (falling back to CreatedAt) so cloud-backup freshness comparisons and the
// campaign-list ordering keep their existing baseline on the first 3.0 open.
// It also drops the now-defunct LastActivity field from each CampaignInfo.
//
// Runs BEFORE the legacy full-campaign reshape in ContextService.load, so the
// stored CampaignInfo entries still carry their LastActivity here.
//
// NO domain type imports -- access everything via `(data as any).field`.

import type { Migration } from "./types";

export const seedLastUpdatedV300Migration: Migration = {
	version: "3.0.0",
	migrate: (data: unknown) => {
		const context = data as any;
		if (!context || typeof context !== "object") return context;

		if (!context.LastUpdated || typeof context.LastUpdated !== "object") {
			context.LastUpdated = {};
		}

		const campaigns = Array.isArray(context.Campaigns) ? context.Campaigns : [];
		for (const c of campaigns) {
			if (!c || typeof c !== "object" || typeof c.Id !== "string") continue;

			// Don't clobber a value already present (e.g. a partial / re-run upgrade).
			if (typeof context.LastUpdated[c.Id] !== "number") {
				const seed =
					typeof c.LastActivity === "number"
						? c.LastActivity
						: typeof c.CreatedAt === "number"
						? c.CreatedAt
						: Date.now();
				context.LastUpdated[c.Id] = seed;
			}

			// LastActivity no longer exists on CampaignInfo; remove the stale field.
			delete c.LastActivity;
		}

		return context;
	},
};
