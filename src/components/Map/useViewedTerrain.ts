// components/Map/useViewedTerrain.ts
//
// The DM's locally-viewed terrains. With multi-terrain worlds there is no single
// "active terrain" in shared state; which terrains the DM has been looking at is
// purely local UI state and is never broadcast.
//
// Stored as a most-recently-viewed list (newest first, capped at MAX_RECENT) per
// campaign id on the global Context, mirroring SecretModes so it needs no
// dedicated provider and is shared across components without prop drilling.
// `viewedTerrainId` (index 0) is the active terrain — the one the map renders and
// that spawns target. The list also drives the toolbar's terrain tabs.
//
// Players never act on these values (they render the terrain of their selected
// character), but calling the hook from shared components is harmless — writes
// just sit in local Context state.

import {
	useQuestContext,
	triggerContextUpdate,
} from "../../domains/Context/ContextProvider";
import { CampaignUtils } from "../../domains/Campaign/CampaignUtils";
import type { Campaign } from "../../domains/Campaign/Campaign";

const MAX_RECENT = 10;

/**
 * The terrain to render before the DM has explicitly viewed anything in this
 * campaign. Prefers the terrain most of the party is standing on (characters,
 * then entities) so reopening a game lands on the action rather than an
 * arbitrary first-in-list terrain -- this is what covers campaigns migrated to
 * multi-terrain lazily on open, where the context migration's seed never ran.
 * Falls back to the first terrain in the list.
 */
function inferDefaultTerrainId(campaign: Campaign): string | null {
	const terrainExists = (id: string | undefined): id is string =>
		!!id && campaign.VoxelTerrains.some((t) => t.Id === id);

	const mostCommonTerrain = (
		actors: ReadonlyArray<{ Position: { terrainId?: string } }>
	): string | null => {
		const counts = new Map<string, number>();
		for (const actor of actors) {
			const id = actor.Position?.terrainId;
			if (terrainExists(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
		}
		let best: string | null = null;
		let bestCount = 0;
		for (const [id, count] of counts) {
			if (count > bestCount) {
				best = id;
				bestCount = count;
			}
		}
		return best;
	};

	return (
		mostCommonTerrain(campaign.GameState.Characters) ??
		mostCommonTerrain(campaign.GameState.Entities) ??
		campaign.VoxelTerrains[0]?.Id ??
		null
	);
}

interface ViewedTerrainState {
	/**
	 * The active viewed terrain (the most-recent entry). Resolves to the first
	 * terrain in the campaign when nothing valid is stored. Null only when the
	 * campaign has no terrains at all.
	 */
	viewedTerrainId: string | null;
	/**
	 * The most-recently-viewed terrains, newest first — validated against the
	 * campaign, deduped, and capped at MAX_RECENT. Drives the toolbar tabs.
	 */
	viewedTerrainIds: string[];
	/**
	 * Make `terrainId` the active viewed terrain, moving it to the front of the
	 * recently-viewed list (local Context state; triggers a re-render).
	 */
	setViewedTerrain: (terrainId: string) => void;
	/** Remove `terrainId` from the recently-viewed list. */
	clearViewedTerrain: (terrainId: string) => void;
}

export function useViewedTerrain(): ViewedTerrainState {
	const context = useQuestContext();
	const campaign = CampaignUtils.getActiveCampaign(context);

	const rawList = context.ViewedTerrains?.[campaign.Id] ?? [];

	// Keep only terrains that still exist, deduped, preserving recency order.
	const seen = new Set<string>();
	const viewedTerrainIds = rawList.filter((id) => {
		if (seen.has(id)) return false;
		if (!campaign.VoxelTerrains.some((t) => t.Id === id)) return false;
		seen.add(id);
		return true;
	});

	const viewedTerrainId =
		viewedTerrainIds[0] ?? inferDefaultTerrainId(campaign);

	const writeList = (next: string[]) => {
		if (!context.ViewedTerrains) context.ViewedTerrains = {};
		context.ViewedTerrains[campaign.Id] = next;
		triggerContextUpdate();
	};

	const setViewedTerrain = (terrainId: string) => {
		if (viewedTerrainIds[0] === terrainId) return; // already active
		const next = [
			terrainId,
			...viewedTerrainIds.filter((id) => id !== terrainId),
		].slice(0, MAX_RECENT);
		writeList(next);
	};

	const clearViewedTerrain = (terrainId: string) => {
		if (!viewedTerrainIds.includes(terrainId)) return;
		writeList(viewedTerrainIds.filter((id) => id !== terrainId));
	};

	return {
		viewedTerrainId,
		viewedTerrainIds,
		setViewedTerrain,
		clearViewedTerrain,
	};
}
