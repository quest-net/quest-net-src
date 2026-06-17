import { Actor, InventorySlot, EquipmentSlot } from "../Actor/Actor";
import { Context } from "../Context/Context";
import { Item } from "./Item";

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

export const ItemUtils = {
	/**
	 * Creates a default item template
	 */
	createDefault(_context: Context): Item {
		return {
			Id: crypto.randomUUID(),
			Name: "New Item",
			Description: "",
			Image: undefined,
			Tags: [],
			MaxUses: undefined,
			IsEquippable: false,
			DiceRoll: "",
		};
	},
};
