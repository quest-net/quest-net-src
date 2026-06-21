import { Actor, InventorySlot, EquipmentSlot } from "../Actor/Actor";
import { Context } from "../Context/Context";
import { Campaign } from "../Campaign/Campaign";
import { Item } from "./Item";
import { resolveByNameOrId } from "../../utils/resolveByNameOrId";

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

	/**
	 * Resolve an item TEMPLATE name or Id to its template. Mirrors the scripting
	 * resolution contract via the shared resolver (Id exact -> Name exact ->
	 * first glob match -> undefined) over `campaign.ItemTemplates`.
	 */
	findTemplate(campaign: Campaign, ref: string): Item | undefined {
		return resolveByNameOrId(campaign.ItemTemplates, ref);
	},

	/**
	 * Resolve an item the ACTOR holds, by template name or Id. An inventory/
	 * equipment slot's `Id` references its template, so this resolves the template
	 * Id first (via `findTemplate`) then returns the actor's slot whose `Id`
	 * equals it -- inventory takes precedence over equipment. Returns undefined
	 * when the template can't be resolved or the actor holds no such slot.
	 */
	findSlot(
		actor: Actor,
		campaign: Campaign,
		ref: string
	): InventorySlot | EquipmentSlot | undefined {
		const templateId = ItemUtils.findTemplate(campaign, ref)?.Id;
		if (!templateId) return undefined;
		return (
			actor.Inventory.find((s) => s.Id === templateId) ??
			actor.Equipment.find((s) => s.Id === templateId)
		);
	},
};
