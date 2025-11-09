// utils/SlotSyncUtils.ts

import { Actor, InventorySlot, EquipmentSlot, SkillSlot, StatusSlot } from "../domains/Actor/Actor";

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
 * Syncs all status slots across all actors when a status template is edited
 * Updates turnsLeft to match new Duration behavior
 */
export function syncStatusSlotsAfterEdit(
	statusId: string,
	newDuration: number | undefined,
	actors: Actor[]
): void {
	actors.forEach((actor) => {
		actor.Statuses.forEach((slot) => {
			if (slot.Id === statusId) {
				syncStatusSlot(slot, newDuration);
			}
		});
	});
}

/**
 * Syncs a single status slot to match template's Duration
 */
function syncStatusSlot(slot: StatusSlot, duration: number | undefined): void {
	if (duration === undefined) {
		// Template now is permanent - clear turnsLeft
		slot.turnsLeft = undefined;
	} else if (slot.turnsLeft === undefined) {
		// Template now has duration, but slot was permanent - set to duration
		slot.turnsLeft = duration;
	} else {
		// Both have values - clamp current to new duration (don't increase past new max)
		slot.turnsLeft = Math.min(slot.turnsLeft, duration);
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