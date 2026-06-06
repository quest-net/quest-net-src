// src/migrations/v2_8_0_terrainLinks.ts
//
// Terrain links: invisible, undirected, tile-to-tile links stored in a
// campaign-level registry. This migration simply initializes
// Campaign.TerrainLinks = [] for existing campaigns so the field is always
// present (the rest of the link system assumes a concrete array). No existing
// data maps onto links — they are authored fresh.
//
// NO domain type imports — access everything via `(data as any).field`.

import type { Migration } from "./types";

export const terrainLinksV280Migration: Migration = {
	version: "2.8.0",
	migrate: (data: unknown) => {
		const campaign = data as any;
		if (!campaign || typeof campaign !== "object") return campaign;

		if (!Array.isArray(campaign.TerrainLinks)) {
			campaign.TerrainLinks = [];
		}

		return campaign;
	},
};
