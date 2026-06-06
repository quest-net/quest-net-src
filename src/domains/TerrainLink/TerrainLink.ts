// domains/TerrainLink/TerrainLink.ts
//
// Terrain links are invisible, undirected, interactable links from one tile to
// another tile — across terrains or within the same terrain. A single TerrainLink
// entry links both ends both ways: interacting at end A carries the actor to end
// B, and vice versa. Links live in a central campaign-level registry
// (Campaign.TerrainLinks) rather than on a terrain, because a link references TWO
// terrains and storing it on one would leave the other ignorant of it.
//
// A link has no geometry, label, or facing of its own — any visual ("door arch",
// "cave mouth", "trapdoor") is a purely cosmetic, fully-decoupled voxel stamp the
// DM places at the anchor tile. The mechanical link neither knows nor cares about
// it, so a link can even be buried under voxels for a secret passage.

/** One end of a terrain link: a specific tile on a specific terrain. */
export interface TerrainLinkAnchor {
	terrainId: string;
	x: number;
	y: number;
	h: number;
}

/**
 * An undirected link between two tiles (TerrainLinkAnchors). Same-terrain links
 * are allowed (puzzles / portals: both ends may share a `terrainId`).
 */
export interface TerrainLink {
	Id: string;
	A: TerrainLinkAnchor;
	B: TerrainLinkAnchor;
	/** When locked, the link is invisible and inert to anyone controlling an actor
	 *  -- players and impersonating DMs alike: no prompt, no hover reveal, no
	 *  traversal. Only the DM's "Display Terrain Links" authoring mode surfaces a
	 *  locked link (so the DM can unlock it). */
	Locked: boolean;
}

/** Which end of a terrain link an anchor is. */
export type TerrainLinkEnd = "A" | "B";

/** Creates a new, unlocked terrain link linking two anchors. */
export function createTerrainLink(
	a: TerrainLinkAnchor,
	b: TerrainLinkAnchor
): TerrainLink {
	return { Id: crypto.randomUUID(), A: { ...a }, B: { ...b }, Locked: false };
}

/** Whether two anchors refer to the same tile on the same terrain. */
export function anchorsEqual(a: TerrainLinkAnchor, b: TerrainLinkAnchor): boolean {
	return (
		a.terrainId === b.terrainId && a.x === b.x && a.y === b.y && a.h === b.h
	);
}

/** Whether either end of `link` lives on `terrainId`. */
export function terrainLinkReferencesTerrain(
	link: TerrainLink,
	terrainId: string
): boolean {
	return link.A.terrainId === terrainId || link.B.terrainId === terrainId;
}

/** Whether any existing link already has an anchor at `anchor`'s exact tile.
 *  Two links may not share a tile (one anchor per tile). */
export function isTerrainLinkAnchorOccupied(
	links: readonly TerrainLink[],
	anchor: TerrainLinkAnchor
): boolean {
	return links.some(
		(link) => anchorsEqual(link.A, anchor) || anchorsEqual(link.B, anchor)
	);
}

/**
 * Every anchor that sits on `terrainId`, paired with its end and the link it
 * belongs to. A same-terrain link contributes both of its anchors. This is the
 * shape the map's invisible hitbox layer and the player's one-hop world map both
 * consume: each entry is a pickable tile plus where it leads.
 */
export interface TerrainLinkAnchorOnTerrain {
	link: TerrainLink;
	end: TerrainLinkEnd;
	anchor: TerrainLinkAnchor;
	destination: TerrainLinkAnchor;
}

export function getTerrainLinkAnchorsOnTerrain(
	links: readonly TerrainLink[],
	terrainId: string
): TerrainLinkAnchorOnTerrain[] {
	const result: TerrainLinkAnchorOnTerrain[] = [];
	for (const link of links) {
		if (link.A.terrainId === terrainId) {
			result.push({ link, end: "A", anchor: link.A, destination: link.B });
		}
		if (link.B.terrainId === terrainId) {
			result.push({ link, end: "B", anchor: link.B, destination: link.A });
		}
	}
	return result;
}

/**
 * Whether `position` is on or orthogonally/diagonally adjacent to `anchor` —
 * the traversal gate. Same terrain, Chebyshev distance on the tactical (x, y)
 * grid <= 1. Height is ignored: standing on the tile at any surface, or one tile
 * away, counts. The walk-on case is deliberately excluded as the trigger (it
 * would ping-pong between paired links); this only governs whether an
 * *interaction* is allowed.
 */
export function isAdjacentToAnchor(
	anchor: TerrainLinkAnchor,
	position: { terrainId: string; x: number; y: number }
): boolean {
	if (anchor.terrainId !== position.terrainId) return false;
	return (
		Math.max(Math.abs(anchor.x - position.x), Math.abs(anchor.y - position.y)) <= 1
	);
}

export interface TerrainLinkInteractionState {
	/** The actor is close enough to notice this link endpoint. */
	visible: boolean;
	/** The actor can traverse this endpoint now (adjacent and unlocked). */
	usable: boolean;
	/** The underlying link lock flag. */
	locked: boolean;
}

/**
 * UI-only interaction gate for a terrain-link endpoint. Link traversal remains an
 * ordinary actor move; this helper keeps hover, prompts, click suppression, and
 * first-person targeting on the same adjacency rule. Role plays no part: a locked
 * link is unusable for everyone controlling an actor (players and an impersonating
 * DM alike). Only the DM's separate authoring/display mode -- which does not go
 * through this helper -- ever surfaces a locked link.
 */
export function getTerrainLinkInteractionState(
	anchor: TerrainLinkAnchor,
	position: { terrainId: string; x: number; y: number } | null | undefined,
	locked: boolean
): TerrainLinkInteractionState | null {
	if (!position || !isAdjacentToAnchor(anchor, position)) return null;
	return {
		visible: true,
		usable: !locked,
		locked,
	};
}
