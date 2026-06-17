import { Actor, StatusSlotExpiration } from "../Actor/Actor";
import { Status, StatusExpiration } from "./Status";
import { Context } from "../Context/Context";

/**
 * Syncs all status slots across all actors when a status template's Expiration changes.
 * Updates slot expiration to reflect the new template expiration type.
 */
export function syncStatusSlotsAfterEdit(
	statusId: string,
	newExpiration: StatusExpiration,
	actors: Actor[]
): void {
	actors.forEach((actor) => {
		actor.Statuses.forEach((slot) => {
			if (slot.Id === statusId) {
				syncStatusSlot(slot, newExpiration);
			}
		});
	});
}

/**
 * Syncs a single status slot to match template's Expiration.
 * For countable types (turns, days), clamps existing values down but doesn't increase them.
 */
function syncStatusSlot(
	slot: { expiration: StatusSlotExpiration },
	templateExp: StatusExpiration
): void {
	switch (templateExp.type) {
		case "permanent":
			slot.expiration = { type: "permanent" };
			break;
		case "turns":
			if (slot.expiration.type === "turns") {
				// Both are turns - clamp current to new max (don't increase)
				slot.expiration = {
					type: "turns",
					turnsLeft: Math.min(slot.expiration.turnsLeft, templateExp.count),
				};
			} else {
				// Type changed to turns - set to template count
				slot.expiration = { type: "turns", turnsLeft: templateExp.count };
			}
			break;
		case "shortRest":
			slot.expiration = { type: "shortRest" };
			break;
		case "longRest":
			slot.expiration = { type: "longRest" };
			break;
		case "days":
			if (slot.expiration.type === "days") {
				// Both are days - clamp current to new max (don't increase)
				slot.expiration = {
					type: "days",
					daysLeft: Math.min(slot.expiration.daysLeft, templateExp.count),
				};
			} else {
				// Type changed to days - set to template count
				slot.expiration = { type: "days", daysLeft: templateExp.count };
			}
			break;
	}
}

/**
 * Converts a template StatusExpiration to a runtime StatusSlotExpiration
 */
export function templateToSlotExpiration(expiration: StatusExpiration): StatusSlotExpiration {
	switch (expiration.type) {
		case "permanent":
			return { type: "permanent" };
		case "turns":
			return { type: "turns", turnsLeft: expiration.count };
		case "shortRest":
			return { type: "shortRest" };
		case "longRest":
			return { type: "longRest" };
		case "days":
			return { type: "days", daysLeft: expiration.count };
	}
}

/**
 * Formats a StatusSlotExpiration for display text
 */
export function formatSlotExpiration(exp: StatusSlotExpiration): string {
	switch (exp.type) {
		case "permanent":
			return "Permanent (never expires)";
		case "turns":
			return `${exp.turnsLeft} turn${exp.turnsLeft === 1 ? '' : 's'} remaining`;
		case "shortRest":
			return "Until short rest";
		case "longRest":
			return "Until long rest";
		case "days":
			return `${exp.daysLeft} day${exp.daysLeft === 1 ? '' : 's'} remaining`;
	}
}

/**
 * Formats a template StatusExpiration for display text
 */
export function formatTemplateExpiration(exp: StatusExpiration): string {
	switch (exp.type) {
		case "permanent":
			return "Permanent";
		case "turns":
			return `${exp.count} turn${exp.count === 1 ? '' : 's'}`;
		case "shortRest":
			return "Until short rest";
		case "longRest":
			return "Until long rest";
		case "days":
			return `${exp.count} day${exp.count === 1 ? '' : 's'}`;
	}
}

export const StatusUtils = {
	/**
	 * Creates a default status template
	 */
	createDefault(_context: Context): Status {
		return {
			Id: crypto.randomUUID(),
			Name: "New Status",
			Description: "",
			Image: undefined,
			Tags: [],
			Expiration: { type: "turns", count: 3 }, // Default 3 turns
		};
	},
};
