// domains/Item/ItemActions.ts

import { Context } from "../Context/Context";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import { Item } from "./Item";
import { Actor } from "../Actor/Actor";
import { rollDiceFormula } from "../../utils/DiceUtils";
import {
	syncItemSlotsAfterEdit,
	getAllActors,
} from "../../utils/SlotSyncUtils";

/**
 * Item action handlers
 * Items are templates stored at Campaign.ItemTemplates
 */
export const ItemActions = {
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
	 * Creates a new item and adds to the campaign item templates
	 */
	create(params: { item: Item }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		campaign.ItemTemplates.push(params.item);

		LogActions.create(
			{
				action: "Item created",
				details: `${params.item.Name} added to item templates`,
				category: "item",
				level: "info",
				visibility: ["dm", "owner"],
			},
			context
		);
	},

	/**
	 * Edits an existing item
	 * Syncs all actor slots if MaxUses changes
	 */
	edit(
		params: { itemId: string; updates: Partial<Item> },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		const idx = campaign.ItemTemplates.findIndex((i) => i.Id === params.itemId);
		if (idx === -1) {
			console.warn(`Item not found: ${params.itemId}`);
			return;
		}

		const oldMaxUses = campaign.ItemTemplates[idx].MaxUses;
		const newMaxUses = params.updates.MaxUses;

		// Apply updates
		campaign.ItemTemplates[idx] = {
			...campaign.ItemTemplates[idx],
			...params.updates,
			Id: campaign.ItemTemplates[idx].Id, // guard against accidental Id overwrite
		};

		// If MaxUses changed, sync all actor slots
		if (newMaxUses !== oldMaxUses) {
			const allActors = getAllActors(campaign);
			syncItemSlotsAfterEdit(params.itemId, newMaxUses, allActors);
		}

		LogActions.create(
			{
				action: "Item edited",
				details: `${campaign.ItemTemplates[idx].Name} updated`,
				category: "item",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Deletes an item template permanently
	 */
	delete(params: { itemId: string }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		const idx = campaign.ItemTemplates.findIndex((i) => i.Id === params.itemId);
		if (idx === -1) {
			console.warn(`Item not found: ${params.itemId}`);
			return;
		}
		const [removed] = campaign.ItemTemplates.splice(idx, 1);

		LogActions.create(
			{
				action: "Item deleted",
				details: `${removed?.Name ?? "Item"} removed from templates`,
				category: "item",
				level: "important",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Gives items to actors (characters or entities)
	 * Each actor receives `count` copies of each item
	 *
	 * Example: give(["potion", "sword"], ["hero1", "hero2"], 2)
	 * Result: hero1 and hero2 each receive 2 potions and 2 swords
	 */
	give(
		params: {
			itemIds: string[];
			actorIds: string[];
			count: number;
		},
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		// Validate count
		const count = Math.max(1, Math.floor(params.count));

		// Combine all actors (IDs are unique)
		const actors: Actor[] = getAllActors(campaign);

		let totalGiven = 0;
		const actorNames: string[] = [];

		// For each actor
		params.actorIds.forEach((actorId) => {
			const actor = actors.find((a) => a.Id === actorId);
			if (!actor) {
				console.warn(`Actor not found: ${actorId}`);
				return;
			}

			actorNames.push(actor.Name);

			// For each item
			params.itemIds.forEach((itemId) => {
				const itemTemplate = campaign.ItemTemplates.find(
					(i) => i.Id === itemId
				);
				if (!itemTemplate) {
					console.warn(`Item template not found: ${itemId}`);
					return;
				}

				// Give `count` copies of this item to this actor
				for (let i = 0; i < count; i++) {
					actor.Inventory.push({
						Id: itemId,
						UsesLeft: itemTemplate.MaxUses, // undefined if MaxUses is undefined
					});
					totalGiven++;
				}
			});
		});

		// Log the action
		if (totalGiven > 0) {
			const itemNames = params.itemIds
				.map((id) => campaign.ItemTemplates.find((i) => i.Id === id)?.Name)
				.filter(Boolean)
				.join(", ");

			LogActions.create(
				{
					action: "Items given",
					details: `${itemNames} (${totalGiven} total) given to ${actorNames.join(
						", "
					)}`,
					category: "item",
					level: "info",
					visibility: ["dm", "owner"],
				},
				context
			);
		}
	},
	
	/**
	 * Transfers an item from one actor to another
	 * Moves the item slot from source actor to target actor's inventory
	 * Works with any actors (characters or entities, in any location)
	 */
	transfer(
		params: {
			sourceActorId: string;
			targetActorId: string;
			itemId: string;
		},
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		// Find all actors in all possible locations
		const allActors: Actor[] = getAllActors(campaign);

		// Find source actor
		const sourceActor = allActors.find((a) => a.Id === params.sourceActorId);
		if (!sourceActor) {
			console.warn(`Source actor not found: ${params.sourceActorId}`);
			return;
		}

		// Find target actor
		const targetActor = allActors.find((a) => a.Id === params.targetActorId);
		if (!targetActor) {
			console.warn(`Target actor not found: ${params.targetActorId}`);
			return;
		}

		// Prevent transferring to self
		if (params.sourceActorId === params.targetActorId) {
			console.warn(`Cannot transfer item to self`);
			return;
		}

		// Find the item template for logging
		const itemTemplate = campaign.ItemTemplates.find(
			(i) => i.Id === params.itemId
		);
		const itemName = itemTemplate?.Name || "Unknown Item";

		// Try to find and remove from source's inventory first
		const inventoryIndex = sourceActor.Inventory.findIndex(
			(s) => s.Id === params.itemId
		);
		if (inventoryIndex !== -1) {
			// Remove from source inventory
			const [slot] = sourceActor.Inventory.splice(inventoryIndex, 1);

			// Add to target inventory
			targetActor.Inventory.push(slot);

			LogActions.create(
				{
					action: "Item transferred",
					details: `${sourceActor.Name} gave ${itemName} to ${targetActor.Name}`,
					category: "item",
					level: "info",
					visibility: ["all"],
					actorId: params.sourceActorId,
				},
				context
			);
			return;
		}

		// If not in inventory, try equipment
		const equipmentIndex = sourceActor.Equipment.findIndex(
			(s) => s.Id === params.itemId
		);
		if (equipmentIndex !== -1) {
			// Remove from source equipment
			const [slot] = sourceActor.Equipment.splice(equipmentIndex, 1);

			// Add to target inventory (not equipment)
			targetActor.Inventory.push(slot);

			LogActions.create(
				{
					action: "Item transferred",
					details: `${sourceActor.Name} gave ${itemName} to ${targetActor.Name}`,
					category: "item",
					level: "info",
					visibility: ["all"],
					actorId: params.sourceActorId,
				},
				context
			);
			return;
		}

		console.warn(
			`Item not found in source actor's inventory or equipment: ${params.itemId}`
		);
	},
	/**
	 * Bulk edit tags for multiple items
	 */
	bulkEditTags(
		params: { updates: Array<{ itemId: string; tags: string[] }> },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		let successCount = 0;
		params.updates.forEach((update) => {
			const item = campaign.ItemTemplates.find((i) => i.Id === update.itemId);
			if (item) {
				item.Tags = update.tags;
				successCount++;
			} else {
				console.warn(`Item not found for bulk update: ${update.itemId}`);
			}
		});

		LogActions.create(
			{
				action: "Items organized",
				details: `Updated tags for ${successCount} item(s)`,
				category: "item",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Uses an item from an actor's inventory or equipment
	 * Decrements UsesLeft if the item has limited uses
	 * Rolls dice if the item has a DiceRoll property
	 * Works with any actor (characters or entities, in any location)
	 */
	use(params: { actorId: string; itemId: string }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		// Find actor in all possible locations
		const actors: Actor[] = getAllActors(campaign);

		const actor = actors.find((a) => a.Id === params.actorId);
		if (!actor) {
			console.warn(`Actor not found: ${params.actorId}`);
			return;
		}

		// Find the item template
		const itemTemplate = campaign.ItemTemplates.find(
			(i) => i.Id === params.itemId
		);
		if (!itemTemplate) {
			console.warn(`Item template not found: ${params.itemId}`);
			return;
		}

		// Find the item slot in inventory or equipment
		let slot = actor.Inventory.find((s) => s.Id === params.itemId);

		if (!slot) {
			slot = actor.Equipment.find((s) => s.Id === params.itemId);
		}

		if (!slot) {
			console.warn(
				`Item not found in actor's inventory or equipment: ${params.itemId}`
			);
			return;
		}

		// Check if item has uses left
		if (slot.UsesLeft !== undefined && slot.UsesLeft <= 0) {
			console.warn(`Item has no uses left: ${itemTemplate.Name}`);
			return;
		}

		// Decrement uses if applicable
		if (slot.UsesLeft !== undefined) {
			slot.UsesLeft--;
		}

		// Determine visibility based on the ACTOR TYPE, not who pressed the button
		const visibilitySettings = campaign.Settings.VisibilitySettings;
		let visibility: ("dm" | "player" | "owner" | "all")[];

		// Check if this actor is a character (player-controlled) or entity (DM-controlled)
		const isCharacter =
			campaign.GameState.Characters.some((c) => c.Id === params.actorId) ||
			campaign.CharacterRoster.some((c) => c.Id === params.actorId);

		if (isCharacter) {
			// Character action - use player visibility rules
			visibility = visibilitySettings.playersSeePeerRolls
				? ["all"]
				: ["dm", "owner"];
		} else {
			// Entity action - use DM visibility rules
			visibility = visibilitySettings.playersSeeDMRolls ? ["all"] : ["dm"];
		}

		// Roll dice if the item has a DiceRoll formula
		if (itemTemplate.DiceRoll && itemTemplate.DiceRoll.trim() !== "") {
			try {
				const rollResult = rollDiceFormula(itemTemplate.DiceRoll.trim());

				LogActions.create(
					{
						action: `${actor.Name} used ${itemTemplate.Name} : ${rollResult.total}`,
						details: `${rollResult.formula} : ${rollResult.breakdown}`,
						category: "dice",
						level: "important",
						visibility,
						actorId: params.actorId,
					},
					context
				);
			} catch (error) {
				console.error(
					`Failed to roll dice for item ${itemTemplate.Name}:`,
					error
				);

				// Log without dice roll if it fails
				LogActions.create(
					{
						action: `${actor.Name} used ${itemTemplate.Name}`,
						details: `${
							slot.UsesLeft !== undefined ? ` (${slot.UsesLeft} uses left)` : ""
						}`,
						category: "item",
						level: "info",
						visibility,
						actorId: params.actorId,
					},
					context
				);
			}
		} else {
			// No dice roll - just log the use
			LogActions.create(
				{
					action: `${actor.Name} used ${itemTemplate.Name}`,
					details: `${
						slot.UsesLeft !== undefined ? ` (${slot.UsesLeft} uses left)` : ""
					}`,
					category: "item",
					level: "info",
					visibility,
					actorId: params.actorId,
				},
				context
			);
		}
	},

	/**
	 * Equips an item from an actor's inventory
	 * Moves the item from Inventory to Equipment
	 * Works with any actor (characters or entities, in any location)
	 */
	equip(params: { actorId: string; itemId: string }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		// Find actor in all possible locations
		const actors: Actor[] = getAllActors(campaign);

		const actor = actors.find((a) => a.Id === params.actorId);
		if (!actor) {
			console.warn(`Actor not found: ${params.actorId}`);
			return;
		}

		// Find the item template
		const itemTemplate = campaign.ItemTemplates.find(
			(i) => i.Id === params.itemId
		);
		if (!itemTemplate) {
			console.warn(`Item template not found: ${params.itemId}`);
			return;
		}

		// Check if item is equippable
		if (!itemTemplate.IsEquippable) {
			console.warn(`Item is not equippable: ${itemTemplate.Name}`);
			return;
		}

		// Find the item in inventory
		const inventoryIndex = actor.Inventory.findIndex(
			(s) => s.Id === params.itemId
		);
		if (inventoryIndex === -1) {
			console.warn(`Item not found in actor's inventory: ${params.itemId}`);
			return;
		}

		// Move from inventory to equipment
		const [slot] = actor.Inventory.splice(inventoryIndex, 1);
		actor.Equipment.push(slot);

		LogActions.create(
			{
				action: "Item equipped",
				details: `${actor.Name} equipped ${itemTemplate.Name}`,
				category: "item",
				level: "info",
				visibility: ["all"],
				actorId: params.actorId,
			},
			context
		);
	},

	/**
	 * Unequips an item from an actor's equipment
	 * Moves the item from Equipment to Inventory
	 * Works with any actor (characters or entities, in any location)
	 */
	unequip(params: { actorId: string; itemId: string }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		// Find actor in all possible locations
		const actors: Actor[] = getAllActors(campaign);

		const actor = actors.find((a) => a.Id === params.actorId);
		if (!actor) {
			console.warn(`Actor not found: ${params.actorId}`);
			return;
		}

		// Find the item template
		const itemTemplate = campaign.ItemTemplates.find(
			(i) => i.Id === params.itemId
		);
		if (!itemTemplate) {
			console.warn(`Item template not found: ${params.itemId}`);
			return;
		}

		// Find the item in equipment
		const equipmentIndex = actor.Equipment.findIndex(
			(s) => s.Id === params.itemId
		);
		if (equipmentIndex === -1) {
			console.warn(`Item not found in actor's equipment: ${params.itemId}`);
			return;
		}

		// Move from equipment to inventory
		const [slot] = actor.Equipment.splice(equipmentIndex, 1);
		actor.Inventory.push(slot);

		LogActions.create(
			{
				action: "Item unequipped",
				details: `${actor.Name} unequipped ${itemTemplate.Name}`,
				category: "item",
				level: "info",
				visibility: ["all"],
				actorId: params.actorId,
			},
			context
		);
	},

	/**
	 * Discards an item from an actor's inventory or equipment
	 * Removes the item entirely (does not return it to templates)
	 * Works with any actor (characters or entities, in any location)
	 */
	discard(params: { actorId: string; itemId: string }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		// Find actor in all possible locations
		const actors: Actor[] = getAllActors(campaign);

		const actor = actors.find((a) => a.Id === params.actorId);
		if (!actor) {
			console.warn(`Actor not found: ${params.actorId}`);
			return;
		}

		// Find the item template for logging
		const itemTemplate = campaign.ItemTemplates.find(
			(i) => i.Id === params.itemId
		);
		const itemName = itemTemplate?.Name || "Unknown Item";

		// Try to find and remove from inventory first
		const inventoryIndex = actor.Inventory.findIndex(
			(s) => s.Id === params.itemId
		);
		if (inventoryIndex !== -1) {
			actor.Inventory.splice(inventoryIndex, 1);

			LogActions.create(
				{
					action: "Item discarded",
					details: `${actor.Name} discarded ${itemName}`,
					category: "item",
					level: "info",
					visibility: ["all"],
					actorId: params.actorId,
				},
				context
			);
			return;
		}

		// If not in inventory, try equipment
		const equipmentIndex = actor.Equipment.findIndex(
			(s) => s.Id === params.itemId
		);
		if (equipmentIndex !== -1) {
			actor.Equipment.splice(equipmentIndex, 1);

			LogActions.create(
				{
					action: "Item discarded",
					details: `${actor.Name} discarded ${itemName}`,
					category: "item",
					level: "info",
					visibility: ["all"],
					actorId: params.actorId,
				},
				context
			);
			return;
		}

		console.warn(
			`Item not found in actor's inventory or equipment: ${params.itemId}`
		);
	},
	/**
	 * Adjusts the uses of an item on an actor
	 * Can set UsesLeft to a specific value or undefined (unlimited)
	 * Works with items in both inventory and equipment
	 */
	adjustUses(
		params: { actorId: string; itemId: string; usesLeft: number | undefined },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		// Find actor in all possible locations
		const actors: Actor[] = getAllActors(campaign);

		const actor = actors.find((a) => a.Id === params.actorId);
		if (!actor) {
			console.warn(`Actor not found: ${params.actorId}`);
			return;
		}

		// Find the item slot (first instance) - check inventory first, then equipment
		let slot = actor.Inventory.find((s) => s.Id === params.itemId);
		if (!slot) {
			slot = actor.Equipment.find((s) => s.Id === params.itemId);
		}

		if (!slot) {
			console.warn(
				`Item not found in actor's inventory or equipment: ${params.itemId}`
			);
			return;
		}

		// Update uses
		slot.UsesLeft = params.usesLeft;

		// Find the item template for logging
		const itemTemplate = campaign.ItemTemplates.find(
			(i) => i.Id === params.itemId
		);
		const itemName = itemTemplate?.Name || "Unknown Item";

		const usesText =
			params.usesLeft === undefined ? "unlimited" : `${params.usesLeft} use(s)`;

		LogActions.create(
			{
				action: "Item uses adjusted",
				details: `${itemName} on ${actor.Name} set to ${usesText}`,
				category: "item",
				level: "info",
				visibility: ["dm", "owner"],
				actorId: params.actorId,
			},
			context
		);
	},
};
