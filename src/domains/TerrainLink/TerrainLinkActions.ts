// domains/TerrainLink/TerrainLinkActions.ts
//
// DM authoring handlers for terrain links — the invisible, undirected
// tile-to-tile links in Campaign.TerrainLinks. The DM creates, edits, locks, and
// deletes links.
//
// Note: there is no "traverse" action. Using a link is just a terrain-crossing
// move: the map's link layer resolves the destination from the link (via the
// helpers in TerrainLink.ts) and dispatches the ordinary character:move /
// entity:move, which already honors a destination terrainId and re-anchors the
// combat budget on a terrain change (ActorActions.moveActor). Lock and adjacency
// are enforced client-side at the interaction point, consistent with how movement
// legality is handled throughout the app.

import type { Context } from "../Context/Context";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import {
	anchorsEqual,
	createTerrainLink,
	isTerrainLinkAnchorOccupied,
	type TerrainLink,
	type TerrainLinkAnchor,
} from "./TerrainLink";

function isValidAnchor(
	anchor: TerrainLinkAnchor | undefined | null
): anchor is TerrainLinkAnchor {
	return (
		!!anchor &&
		typeof anchor.terrainId === "string" &&
		anchor.terrainId.length > 0 &&
		Number.isFinite(anchor.x) &&
		Number.isFinite(anchor.y) &&
		Number.isFinite(anchor.h)
	);
}

function isAnchorOccupiedByOtherLink(
	links: readonly TerrainLink[],
	anchor: TerrainLinkAnchor,
	linkId: string
): boolean {
	return links.some(
		(link) =>
			link.Id !== linkId &&
			(anchorsEqual(link.A, anchor) || anchorsEqual(link.B, anchor))
	);
}

export const TerrainLinkActions = {
	/** Creates an undirected terrain link between two anchors (DM authoring). */
	create(params: { a: TerrainLinkAnchor; b: TerrainLinkAnchor }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		if (!isValidAnchor(params.a) || !isValidAnchor(params.b)) {
			console.warn("Terrain link create rejected: invalid anchor(s)");
			return;
		}

		// Both anchors must reference real terrains.
		const terrainExists = (id: string) =>
			campaign.VoxelTerrains.some((t) => t.Id === id);
		if (!terrainExists(params.a.terrainId) || !terrainExists(params.b.terrainId)) {
			console.warn("Terrain link create rejected: anchor references a missing terrain");
			return;
		}

		// A link's two ends can't be the same tile, and no tile may host two links.
		if (anchorsEqual(params.a, params.b)) {
			console.warn("Terrain link create rejected: both ends are the same tile");
			return;
		}
		if (
			isTerrainLinkAnchorOccupied(campaign.TerrainLinks, params.a) ||
			isTerrainLinkAnchorOccupied(campaign.TerrainLinks, params.b)
		) {
			console.warn("Terrain link create rejected: a link already exists at that position");
			return;
		}

		const link = createTerrainLink(params.a, params.b);
		campaign.TerrainLinks.push(link);

		LogActions.create(
			{
				action: "Terrain link created",
				details: `Linked a tile on one map to another`,
				category: "system",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	/** Edits a link's anchors and/or lock state (DM). */
	edit(
		params: { linkId: string; updates: Partial<Pick<TerrainLink, "A" | "B" | "Locked">> },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		const link = campaign.TerrainLinks.find((l) => l.Id === params.linkId);
		if (!link) {
			console.warn(`Terrain link not found: ${params.linkId}`);
			return;
		}

		const nextA = params.updates.A !== undefined ? params.updates.A : link.A;
		const nextB = params.updates.B !== undefined ? params.updates.B : link.B;
		if (!isValidAnchor(nextA) || !isValidAnchor(nextB)) return;

		const terrainExists = (id: string) =>
			campaign.VoxelTerrains.some((t) => t.Id === id);
		if (!terrainExists(nextA.terrainId) || !terrainExists(nextB.terrainId)) {
			console.warn("Terrain link edit rejected: anchor references a missing terrain");
			return;
		}
		if (anchorsEqual(nextA, nextB)) {
			console.warn("Terrain link edit rejected: both ends are the same tile");
			return;
		}
		if (
			isAnchorOccupiedByOtherLink(campaign.TerrainLinks, nextA, link.Id) ||
			isAnchorOccupiedByOtherLink(campaign.TerrainLinks, nextB, link.Id)
		) {
			console.warn("Terrain link edit rejected: a link already exists at that position");
			return;
		}

		link.A = { ...nextA };
		link.B = { ...nextB };
		if (typeof params.updates.Locked === "boolean") {
			link.Locked = params.updates.Locked;
		}
	},

	/** Deletes a terrain link (DM). */
	delete(params: { linkId: string }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		const index = campaign.TerrainLinks.findIndex((l) => l.Id === params.linkId);
		if (index === -1) {
			console.warn(`Terrain link not found: ${params.linkId}`);
			return;
		}
		campaign.TerrainLinks.splice(index, 1);

		LogActions.create(
			{
				action: "Terrain link deleted",
				details: "",
				category: "system",
				level: "verbose",
				visibility: ["dm"],
			},
			context
		);
	},
};
