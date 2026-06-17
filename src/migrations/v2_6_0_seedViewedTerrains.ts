// src/migrations/v2_6_0_seedViewedTerrains.ts
//
// Context-level companion to the 2.6.0 per-actor-terrain campaign migration.
//
// Multi-terrain worlds replaced the single GameState.VoxelTerrainId pointer with
// per-actor terrain. The DM's locally-rendered terrain is now driven by
// Context.ViewedTerrains[campaignId] (see components/Map/useViewedTerrain.ts),
// which defaults to the first terrain in the list when unset. For a freshly
// upgraded campaign that would drop the DM onto an arbitrary terrain instead of
// the one that was active -- alarming when reopening an existing game.
//
// This seeds ViewedTerrains for the ACTIVE campaign from its old
// GameState.VoxelTerrainId so the DM lands on the terrain they left off on.
// Context migrations run BEFORE the campaign migration that deletes
// VoxelTerrainId (see ContextService.load), so the old pointer is still present
// here. Inactive campaigns (migrated lazily on open) are handled by the smarter
// party-terrain fallback in useViewedTerrain.
//
// NO domain type imports -- access everything via `(data as any).field`.

import type { Migration } from "./types";

export const seedViewedTerrainsV260Migration: Migration = {
	version: "2.6.0",
	migrate: (data: unknown) => {
		const context = data as any;
		if (!context || typeof context !== "object") return context;

		const campaign = context.ActiveCampaign;
		if (!campaign || typeof campaign !== "object") return context;

		const campaignId =
			typeof campaign.Id === "string" ? campaign.Id : null;
		const activeTerrainId: string | undefined =
			campaign.GameState?.VoxelTerrainId;
		if (!campaignId || typeof activeTerrainId !== "string" || !activeTerrainId) {
			return context;
		}

		// Only seed when the old active terrain still exists as a real terrain.
		const terrains = Array.isArray(campaign.VoxelTerrains)
			? campaign.VoxelTerrains
			: [];
		if (!terrains.some((t: any) => t?.Id === activeTerrainId)) {
			return context;
		}

		if (!context.ViewedTerrains || typeof context.ViewedTerrains !== "object") {
			context.ViewedTerrains = {};
		}
		// Don't clobber a list the user may already have (e.g. a partial upgrade).
		const existing = context.ViewedTerrains[campaignId];
		if (!Array.isArray(existing) || existing.length === 0) {
			context.ViewedTerrains[campaignId] = [activeTerrainId];
		}

		return context;
	},
};
