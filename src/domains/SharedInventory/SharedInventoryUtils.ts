// domains/SharedInventory/SharedInventoryUtils.ts

import type { Campaign } from "../Campaign/Campaign";
import type { StatSlot, InventorySlot } from "../Actor/Actor";
import type { SharedInventory } from "./SharedInventory";
import { resolveByNameOrId } from "../../utils/resolveByNameOrId";
import { ActorUtils } from "../Actor/ActorUtils";
import { ItemUtils } from "../Item/ItemUtils";

/**
 * Pure (tier-1) shared-inventory reads/resolvers for the scripting API facade.
 * No dispatch lives here — mutations go through SharedInventoryActions.
 *
 * A shared inventory is a standalone field object on
 * `campaign.Settings.SharedInventories` (Id + Name + Stats + Inventory), so it
 * resolves by name|id exactly like an actor/template via the shared resolver.
 * Its Stats are `StatSlot`s (slot `Id` === StatDefinition Id) and its Inventory
 * are `InventorySlot`s (slot `Id` === ItemTemplate Id), so the stat/item readers
 * mirror the equivalent ActorUtils reads.
 */
export const SharedInventoryUtils = {
	/** All shared inventory pools (empty array when the campaign has none). */
	getInventories(campaign: Campaign): SharedInventory[] {
		return campaign.Settings.SharedInventories ?? [];
	},

	/**
	 * Resolve a shared-inventory NAME or Id to its pool over
	 * `campaign.Settings.SharedInventories` (Id exact -> Name exact -> first glob
	 * match -> undefined). The single shared resolver every shared-inventory
	 * read/forwarder routes its ref through. Returns the live record (no clone).
	 */
	findInventory(campaign: Campaign, ref: string): SharedInventory | undefined {
		return resolveByNameOrId(SharedInventoryUtils.getInventories(campaign), ref);
	},

	/**
	 * THE shared stat resolver for a pool: resolves a stat NAME or definition Id to
	 * the matching StatSlot on `inv`. The ref resolves over the campaign's
	 * StatDefinitions (name|id -> definition Id), then the pool's slot whose `Id`
	 * equals that definition Id is returned. Returns undefined when the definition
	 * or the pool's slot is absent. (Mirrors ActorUtils.getStat.)
	 */
	getStat(inv: SharedInventory, campaign: Campaign, statRef: string): StatSlot | undefined {
		const def = resolveByNameOrId(campaign.Settings.StatDefinitions, statRef);
		if (!def) return undefined;
		return inv.Stats?.find((s) => s.Id === def.Id);
	},

	/**
	 * Current value of a pool stat (name|id), or `null` when the pool doesn't track
	 * the stat — either the slot is absent OR its Current is null (the "unset"
	 * state). `null` = "not tracked by this pool". (Mirrors ActorUtils.getStatValue.)
	 */
	getStatValue(inv: SharedInventory, campaign: Campaign, statRef: string): number | null {
		const slot = SharedInventoryUtils.getStat(inv, campaign, statRef);
		if (!slot || slot.Current === null) return null;
		return slot.Current;
	},

	/**
	 * Max for a pool stat (name|id), or `undefined` when the pool has no slot for it
	 * (Max is always a number on a present slot). (Mirrors ActorUtils.getStatMax.)
	 */
	getStatMax(inv: SharedInventory, campaign: Campaign, statRef: string): number | undefined {
		const slot = SharedInventoryUtils.getStat(inv, campaign, statRef);
		return slot ? slot.Max : undefined;
	},

	/**
	 * Resolve an item the POOL holds, by template name or Id. An inventory slot's
	 * `Id` references its template, so this resolves the template Id first (via
	 * `ItemUtils.findTemplate`) then returns the pool's slot whose `Id` equals it.
	 * Returns undefined when the template can't be resolved or the pool holds no
	 * such slot. (Mirrors ItemUtils.findSlot.)
	 */
	findItem(inv: SharedInventory, campaign: Campaign, ref: string): InventorySlot | undefined {
		const templateId = ItemUtils.findTemplate(campaign, ref)?.Id;
		if (!templateId) return undefined;
		return inv.Inventory.find((s) => s.Id === templateId);
	},

	/**
	 * Resolve a transfer TARGET ref to an Id the `sharedInventory:transfer*` handlers
	 * accept — which is either an active actor's Id OR another shared inventory's Id
	 * (the handler tries the id as an actor first, then as a pool). An object ref
	 * reads `.Id` directly; a string ref resolves an active actor first, then a
	 * shared inventory (actor precedence on a name collision). Returns undefined when
	 * nothing resolves.
	 */
	resolveTransferTargetId(
		campaign: Campaign,
		ref: string | { Id: string }
	): string | undefined {
		if (ref != null && typeof ref === "object") return ref.Id;
		return (
			ActorUtils.resolveActorId(campaign, ref) ??
			SharedInventoryUtils.findInventory(campaign, ref)?.Id
		);
	},
};
