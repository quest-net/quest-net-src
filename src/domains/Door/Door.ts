// domains/Door/Door.ts
//
// Doors are invisible, undirected, interactable links from one tile to another
// tile — across terrains or within the same terrain. A single Door entry links
// both ends both ways: interacting at end A carries the actor to end B, and vice
// versa. Doors live in a central campaign-level registry (Campaign.Doors) rather
// than on a terrain, because a door references TWO terrains and storing it on one
// would leave the other ignorant of it. See docs/multi-terrain-world.md §4.3.
//
// A door has no geometry, label, or facing of its own — any visual ("door arch",
// "cave mouth", "trapdoor") is a purely cosmetic, fully-decoupled voxel stamp the
// DM places at the anchor tile. The mechanical door neither knows nor cares about
// it, so a door can even be buried under voxels for a secret passage.

/** One end of a door: a specific tile on a specific terrain. */
export interface DoorAnchor {
	terrainId: string;
	x: number;
	y: number;
	h: number;
}

/**
 * An undirected link between two tiles (DoorAnchors). Same-terrain links are
 * allowed (puzzles / portals: both ends may share a `terrainId`).
 */
export interface Door {
	Id: string;
	A: DoorAnchor;
	B: DoorAnchor;
	/** When locked, players cannot traverse and hover does not reveal the
	 *  destination. The DM can still pass and can unlock. See §5.6. */
	Locked: boolean;
}

/** Which end of a door an anchor is. */
export type DoorEnd = "A" | "B";

/** Creates a new, unlocked door linking two anchors. */
export function createDoor(a: DoorAnchor, b: DoorAnchor): Door {
	return { Id: crypto.randomUUID(), A: { ...a }, B: { ...b }, Locked: false };
}

/** Stable key for a tile, useful for set membership / hitbox lookups. */
export function anchorKey(anchor: DoorAnchor): string {
	return `${anchor.terrainId}:${anchor.x},${anchor.y},${anchor.h}`;
}

/** Whether two anchors refer to the same tile on the same terrain. */
export function anchorsEqual(a: DoorAnchor, b: DoorAnchor): boolean {
	return (
		a.terrainId === b.terrainId && a.x === b.x && a.y === b.y && a.h === b.h
	);
}

/** The end of `door` whose anchor matches `anchor`, or null if neither does. */
export function getDoorEndAt(door: Door, anchor: DoorAnchor): DoorEnd | null {
	if (anchorsEqual(door.A, anchor)) return "A";
	if (anchorsEqual(door.B, anchor)) return "B";
	return null;
}

/** The anchor on the far side of the door from `end`. */
export function getOppositeAnchor(door: Door, end: DoorEnd): DoorAnchor {
	return end === "A" ? door.B : door.A;
}

/** Whether either end of `door` lives on `terrainId`. */
export function doorReferencesTerrain(door: Door, terrainId: string): boolean {
	return door.A.terrainId === terrainId || door.B.terrainId === terrainId;
}

/** Whether any existing door already has an anchor at `anchor`'s exact tile.
 *  Two doors may not share a tile (one anchor per tile). */
export function isDoorAnchorOccupied(
	doors: readonly Door[],
	anchor: DoorAnchor
): boolean {
	return doors.some(
		(door) => anchorsEqual(door.A, anchor) || anchorsEqual(door.B, anchor)
	);
}

/**
 * All doors with at least one anchor on `terrainId` — the doors that should be
 * hover-pickable / rendered while that terrain is the one in view.
 */
export function getDoorsOnTerrain(
	doors: readonly Door[],
	terrainId: string
): Door[] {
	return doors.filter((door) => doorReferencesTerrain(door, terrainId));
}

/**
 * Every anchor that sits on `terrainId`, paired with its end and the door it
 * belongs to. A same-terrain door contributes both of its anchors. This is the
 * shape the map's invisible hitbox layer and the player's one-hop world map both
 * consume: each entry is a pickable tile plus where it leads.
 */
export interface DoorAnchorOnTerrain {
	door: Door;
	end: DoorEnd;
	anchor: DoorAnchor;
	destination: DoorAnchor;
}

export function getDoorAnchorsOnTerrain(
	doors: readonly Door[],
	terrainId: string
): DoorAnchorOnTerrain[] {
	const result: DoorAnchorOnTerrain[] = [];
	for (const door of doors) {
		if (door.A.terrainId === terrainId) {
			result.push({ door, end: "A", anchor: door.A, destination: door.B });
		}
		if (door.B.terrainId === terrainId) {
			result.push({ door, end: "B", anchor: door.B, destination: door.A });
		}
	}
	return result;
}

/**
 * Whether `position` is on or orthogonally/diagonally adjacent to `anchor` —
 * the traversal gate (§5.5). Same terrain, Chebyshev distance on the tactical
 * (x, y) grid <= 1. Height is ignored: standing on the tile at any surface, or
 * one tile away, counts. The walk-on case is deliberately excluded as the
 * trigger (it would ping-pong between paired doors); this only governs whether
 * an *interaction* is allowed.
 */
export function isAdjacentToAnchor(
	anchor: DoorAnchor,
	position: { terrainId: string; x: number; y: number }
): boolean {
	if (anchor.terrainId !== position.terrainId) return false;
	return (
		Math.max(Math.abs(anchor.x - position.x), Math.abs(anchor.y - position.y)) <= 1
	);
}

/**
 * The end of `door` an actor at `position` may traverse from, or null if it is
 * not adjacent to either end. Prefers the end the actor is standing exactly on
 * (matters for same-terrain doors where both ends could be in range), then the
 * nearer adjacent end, then A as a tie-break. The actor moves to the OPPOSITE
 * anchor (`getOppositeAnchor`).
 */
export function resolveTraversableEnd(
	door: Door,
	position: { terrainId: string; x: number; y: number }
): DoorEnd | null {
	const ends: DoorEnd[] = ["A", "B"];
	let best: DoorEnd | null = null;
	let bestDistance = Infinity;
	for (const end of ends) {
		const anchor = end === "A" ? door.A : door.B;
		if (!isAdjacentToAnchor(anchor, position)) continue;
		const distance = Math.max(
			Math.abs(anchor.x - position.x),
			Math.abs(anchor.y - position.y)
		);
		if (distance < bestDistance) {
			best = end;
			bestDistance = distance;
		}
	}
	return best;
}
