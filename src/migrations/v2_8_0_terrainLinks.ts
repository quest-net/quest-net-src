// src/migrations/v2_8_0_doors.ts
//
// Doors: invisible, undirected, tile-to-tile links stored in a campaign-level
// registry. This migration simply initializes Campaign.Doors = [] for existing
// campaigns so the field is always present (the rest of the door system assumes a
// concrete array). No existing data maps onto doors — they are authored fresh.
// See docs/multi-terrain-world.md §4.3 / §8.4.
//
// NO domain type imports — access everything via `(data as any).field`.

import type { Migration } from "./types";

export const doorsV280Migration: Migration = {
	version: "2.8.0",
	migrate: (data: unknown) => {
		const campaign = data as any;
		if (!campaign || typeof campaign !== "object") return campaign;

		if (!Array.isArray(campaign.Doors)) {
			campaign.Doors = [];
		}

		return campaign;
	},
};
