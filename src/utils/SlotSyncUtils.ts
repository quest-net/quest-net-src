// utils/SlotSyncUtils.ts

import { Actor, InventorySlot, EquipmentSlot, SkillSlot } from "../domains/Actor/Actor";
import { StatusExpiration } from "../domains/Status/Status";

/**
 * Syncs all inventory and equipment slots across all actors when an item template is edited
 * Updates UsesLeft to match new MaxUses behavior
 */
export function syncItemSlotsAfterEdit(
	itemId: string,
	newMaxUses: number | undefined,
	actors: Actor[]
): void {
	actors.forEach((actor) => {
		// Sync inventory slots
		actor.Inventory.forEach((slot) => {
			if (slot.Id === itemId) {
				syncItemSlot(slot, newMaxUses);
			}
		});

		// Sync equipment slots
		actor.Equipment.forEach((slot) => {
			if (slot.Id === itemId) {
				syncItemSlot(slot, newMaxUses);
			}
		});
	});
}

/**
 * Syncs a single item slot to match template's MaxUses
 */
function syncItemSlot(
	slot: InventorySlot | EquipmentSlot,
	maxUses: number | undefined
): void {
	if (maxUses === undefined) {
		// Template now has unlimited uses - clear UsesLeft
		slot.UsesLeft = undefined;
	} else if (slot.UsesLeft === undefined) {
		// Template now has limited uses, but slot was unlimited - set to max
		slot.UsesLeft = maxUses;
	} else {
		// Both have values - clamp current to new max
		slot.UsesLeft = Math.min(slot.UsesLeft, maxUses);
	}
}

/**
 * Syncs all skill slots across all actors when a skill template is edited
 * Updates UsesLeft to match new MaxUses behavior
 */
export function syncSkillSlotsAfterEdit(
	skillId: string,
	newMaxUses: number | undefined,
	actors: Actor[]
): void {
	actors.forEach((actor) => {
		actor.Skills.forEach((slot) => {
			if (slot.Id === skillId) {
				syncSkillSlot(slot, newMaxUses);
			}
		});
	});
}

/**
 * Syncs a single skill slot to match template's MaxUses
 */
function syncSkillSlot(slot: SkillSlot, maxUses: number | undefined): void {
	if (maxUses === undefined) {
		// Template now has unlimited uses - clear UsesLeft
		slot.UsesLeft = undefined;
	} else if (slot.UsesLeft === undefined) {
		// Template now has limited uses, but slot was unlimited - set to max
		slot.UsesLeft = maxUses;
	} else {
		// Both have values - clamp current to new max
		slot.UsesLeft = Math.min(slot.UsesLeft, maxUses);
	}
}

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
	slot: { expiration: import("../domains/Actor/Actor").StatusSlotExpiration },
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
 * Gets all actors from campaign (both in GameState and collections)
 */
export function getAllActors(campaign: any): Actor[] {
	return [
		...campaign.GameState.Characters,
		...campaign.GameState.Entities,
		...campaign.CharacterRoster,
		...campaign.EntityTemplates,
	];
}