// domains/TerrainLink/TerrainLinkUtils.ts
//
// Supporting helpers for terrain-link validation. Extracted from
// TerrainLinkActions.ts so the Actions file contains only registered handlers.

import { anchorsEqual, type TerrainLink, type TerrainLinkAnchor } from "./TerrainLink";

export function isValidAnchor(
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

export function isAnchorOccupiedByOtherLink(
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
