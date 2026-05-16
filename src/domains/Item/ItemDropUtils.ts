// domains/Item/ItemDropUtils.ts
// Utilities for the item drop/pickup system.
// Dropped items are entities with a serialized item snapshot stored in a tag.

import { Item } from "./Item";
import { ACTOR_DEFAULT_COLORS, Actor, InventorySlot, EquipmentSlot, Position } from "../Actor/Actor";
import { Entity } from "../Entity/Entity";
import {
	StatDefinition,
	ActionDefinition,
} from "../CampaignSetting/CampaignSetting";

const ITEM_TAG_PREFIX = "item:";

/**
 * Full snapshot of an item's state at the time it was dropped.
 * Includes both template-level fields and instance-level state (UsesLeft).
 */
export interface ItemSnapshot {
	Id: string;
	Name: string;
	Description?: string;
	Image?: string;
	MaxUses?: number;
	UsesLeft?: number;
	IsEquippable: boolean;
	DiceRoll?: string;
	RestoreRule?: any;
	Tags?: string[];
}

/** Check if an entity is a dropped item by looking for the item tag prefix. */
export function isItemEntity(entity: Actor): boolean {
	return entity.Tags?.some((tag) => tag.startsWith(ITEM_TAG_PREFIX)) ?? false;
}

/** Extract the deserialized item snapshot from an item-entity's tag. */
export function getItemDataFromEntity(entity: Actor): ItemSnapshot | null {
	const tag = entity.Tags?.find((t) => t.startsWith(ITEM_TAG_PREFIX));
	if (!tag) return null;
	try {
		return JSON.parse(tag.slice(ITEM_TAG_PREFIX.length));
	} catch {
		return null;
	}
}

/** Serialize an item template + slot into a tag string. */
export function createItemTag(
	template: Item,
	slot: InventorySlot | EquipmentSlot
): string {
	const snapshot: ItemSnapshot = {
		Id: template.Id,
		Name: template.Name,
		Description: template.Description,
		Image: template.Image,
		MaxUses: template.MaxUses,
		UsesLeft: slot.UsesLeft,
		IsEquippable: template.IsEquippable,
		DiceRoll: template.DiceRoll,
		RestoreRule: template.RestoreRule,
		Tags: template.Tags,
	};
	return ITEM_TAG_PREFIX + JSON.stringify(snapshot);
}

/**
 * Build an Entity from an item for dropping on the ground.
 * Creates a templateless entity (goes directly into GameState.Entities).
 */
export function createItemEntity(
	template: Item,
	slot: InventorySlot | EquipmentSlot,
	position: Position,
	statDefs: StatDefinition[],
	actionDefs: ActionDefinition[]
): Entity {
	return {
		Id: crypto.randomUUID(),
		Name: template.Name,
		Description: template.Description ?? "",
		Image: template.Image,
		Color: ACTOR_DEFAULT_COLORS.ITEM_ENTITY,
		Position: { ...position },
		Size: "extra-small",
		MoveSpeed: 0,
		CanFly: false,
		Stats: statDefs.map((s) => ({ ...s, Current: 0, Max: 0 })),
		Actions: actionDefs.map((a) => ({ ...a, Current: 0, Max: 0 })),
		Attributes: [],
		Inventory: [],
		Equipment: [],
		Skills: [],
		Statuses: [],
		Tags: [createItemTag(template, slot)],
	};
}

/**
 * Build an Entity from an item template directly (no existing slot needed).
 * Used by item:spawn to place items on the map from templates.
 */
export function createItemEntityFromTemplate(
	template: Item,
	position: Position,
	statDefs: StatDefinition[],
	actionDefs: ActionDefinition[]
): Entity {
	// Synthesize a slot with full uses
	const syntheticSlot: InventorySlot = {
		Id: template.Id,
		UsesLeft: template.MaxUses,
	};
	return createItemEntity(template, syntheticSlot, position, statDefs, actionDefs);
}
