// domains/Door/DoorActions.ts
//
// DM authoring handlers for doors — the invisible, undirected tile-to-tile links
// in Campaign.Doors. The DM creates, edits, locks, and deletes doors.
//
// Note: there is no "traverse" action. Using a door is just a terrain-crossing
// move: the map's door layer resolves the destination from the door (via the
// helpers in Door.ts) and dispatches the ordinary character:move / entity:move,
// which already honors a destination terrainId and re-anchors the combat budget
// on a terrain change (ActorActions.moveActor, §5.7). Lock and adjacency are
// enforced client-side at the interaction point, consistent with how movement
// legality is handled throughout the app. See docs/multi-terrain-world.md §5.5.

import type { Context } from "../Context/Context";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import {
	anchorsEqual,
	createDoor,
	isDoorAnchorOccupied,
	type Door,
	type DoorAnchor,
} from "./Door";

function isValidAnchor(anchor: DoorAnchor | undefined | null): anchor is DoorAnchor {
	return (
		!!anchor &&
		typeof anchor.terrainId === "string" &&
		anchor.terrainId.length > 0 &&
		Number.isFinite(anchor.x) &&
		Number.isFinite(anchor.y) &&
		Number.isFinite(anchor.h)
	);
}

export const DoorActions = {
	/** Creates an undirected door linking two anchors (DM authoring). */
	create(params: { a: DoorAnchor; b: DoorAnchor }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		if (!isValidAnchor(params.a) || !isValidAnchor(params.b)) {
			console.warn("Door create rejected: invalid anchor(s)");
			return;
		}

		// Both anchors must reference real terrains.
		const terrainExists = (id: string) =>
			campaign.VoxelTerrains.some((t) => t.Id === id);
		if (!terrainExists(params.a.terrainId) || !terrainExists(params.b.terrainId)) {
			console.warn("Door create rejected: anchor references a missing terrain");
			return;
		}

		// A door's two ends can't be the same tile, and no tile may host two doors.
		if (anchorsEqual(params.a, params.b)) {
			console.warn("Door create rejected: both ends are the same tile");
			return;
		}
		if (
			isDoorAnchorOccupied(campaign.Doors, params.a) ||
			isDoorAnchorOccupied(campaign.Doors, params.b)
		) {
			console.warn("Door create rejected: a door already exists at that position");
			return;
		}

		const door = createDoor(params.a, params.b);
		campaign.Doors.push(door);

		LogActions.create(
			{
				action: "Door created",
				details: `Linked a tile on one map to another`,
				category: "system",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	/** Edits a door's anchors and/or lock state (DM). */
	edit(
		params: { doorId: string; updates: Partial<Pick<Door, "A" | "B" | "Locked">> },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		const door = campaign.Doors.find((d) => d.Id === params.doorId);
		if (!door) {
			console.warn(`Door not found: ${params.doorId}`);
			return;
		}

		if (params.updates.A !== undefined) {
			if (!isValidAnchor(params.updates.A)) return;
			door.A = { ...params.updates.A };
		}
		if (params.updates.B !== undefined) {
			if (!isValidAnchor(params.updates.B)) return;
			door.B = { ...params.updates.B };
		}
		if (typeof params.updates.Locked === "boolean") {
			door.Locked = params.updates.Locked;
		}
	},

	/** Deletes a door (DM). */
	delete(params: { doorId: string }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		const index = campaign.Doors.findIndex((d) => d.Id === params.doorId);
		if (index === -1) {
			console.warn(`Door not found: ${params.doorId}`);
			return;
		}
		campaign.Doors.splice(index, 1);

		LogActions.create(
			{
				action: "Door deleted",
				details: "",
				category: "system",
				level: "verbose",
				visibility: ["dm"],
			},
			context
		);
	},
};
