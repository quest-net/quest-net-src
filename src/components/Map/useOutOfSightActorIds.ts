// components/Map/useOutOfSightActorIds.ts
//
// Per-client line-of-sight result for the "players see out-of-sight entities"
// campaign setting: the ids of actors the local player's character cannot
// currently see. Display-only -- nothing here is synced; every client holds the
// full campaign. Feed the result to isActorVisibleToUser(..., outOfSight).

import { useMemo } from "react";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { CampaignUtils } from "../../domains/Campaign/CampaignUtils";
import type { Actor } from "../../domains/Actor/Actor";
import { TerrainStorageService } from "../../services/TerrainStorageService";
import { getVoxelTerrainIndex } from "../../utils/terrain/data/VoxelTerrainIndex";
import { computeOutOfSightIds } from "./actorLineOfSight";

const NONE: ReadonlySet<string> = new Set();

/**
 * Ids of spawned actors hidden from this user by line of sight. Always empty
 * for the DM and when the setting allows out-of-sight entities. The viewer is
 * the player's own selected character only; with no character on the field,
 * every sight-gated actor is out of sight.
 */
export function useOutOfSightActorIds(): ReadonlySet<string> {
	const context = useQuestContext();
	const campaign = CampaignUtils.getActiveCampaign(context);
	const { Characters, Entities } = campaign.GameState;
	const visibility = campaign.Settings.VisibilitySettings;

	const gated =
		context.User.Role !== "dm" && visibility.playersSeeOutOfSightEntities === false;
	const gatePartyMembers = visibility.playersSeeOutOfSightPartyMembers === false;

	const viewerId = context.User.SelectedCharacters?.[campaign.RoomCode];
	const viewer = gated ? Characters.find((c) => c.Id === viewerId) : undefined;
	const terrain = viewer
		? campaign.VoxelTerrains.find((t) => t.Id === viewer.Position.terrainId)
		: undefined;
	// Voxel payloads live outside the proxy, so the index revision (not the
	// terrain object) is what tells the memo the geometry changed. Null until the
	// viewer's terrain is loaded.
	const terrainRevision =
		terrain && TerrainStorageService.isHydrated(terrain)
			? getVoxelTerrainIndex(terrain).revision
			: null;

	return useMemo(() => {
		if (!gated) return NONE;

		// Owned entities count as party members; the viewer's own actors are never
		// sight-gated (isActorVisibleToUser shows them regardless).
		const candidates: Actor[] = [
			...Entities.filter((e) => !e.OwnerId),
			...(gatePartyMembers
				? [...Characters, ...Entities.filter((e) => e.OwnerId)].filter(
						(a) => a.Id !== viewerId && a.OwnerId !== viewerId
					)
				: []),
		];
		// No viewer, or its terrain's voxels aren't loaded yet: nothing can be seen.
		if (!viewer || !terrain || terrainRevision === null) {
			return new Set(candidates.map((c) => c.Id));
		}
		return computeOutOfSightIds(viewer, candidates, terrain);
	}, [
		gated,
		gatePartyMembers,
		viewerId,
		viewer,
		terrain,
		terrainRevision,
		Characters,
		Entities,
	]);
}
