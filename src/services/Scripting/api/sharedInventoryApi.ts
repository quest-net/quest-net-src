/**
 * Shared inventory facade.
 *
 * Shape: INSTANCE FACADE (the second one, after `actorApi`). A shared inventory is
 * a standalone field object on `campaign.Settings.SharedInventories` (Id + Name +
 * Stats + Inventory), so — unlike item/status/skill slots — an author genuinely
 * *holds* one (`game.sharedInventory("Party Funds")`). `wrapSharedInventory`
 * returns a Proxy over the LIVE pool that passes every field through (`.Name`,
 * `.Stats`, any field added later) and layers on the methods below, cached in the
 * run's `facadeCache` so identity holds within a run.
 *
 * Stats are pooled resources (party gold/rations); items are a shared loot bag.
 * Transfers move them to an actor OR another pool — the target ref resolves to
 * either via `SharedInventoryUtils.resolveTransferTargetId`.
 *
 * Tier discipline (mirrors the other facades): reads delegate to
 * `SharedInventoryUtils` (tier 1, pure); mutations resolve refs to ids then
 * dispatch a real `sharedInventory:*` action through `api.action` (tier 2).
 */
import type { StatSlot } from "../../../domains/Actor/Actor";
import type { SharedInventory } from "../../../domains/SharedInventory/SharedInventory";
import type { ScriptApiContext } from "./apiContext";
import type { ActorRef, RefByNameOrId } from "./actorApi";
import { ActorUtils } from "../../../domains/Actor/ActorUtils";
import { SharedInventoryUtils } from "../../../domains/SharedInventory/SharedInventoryUtils";
import { resolveByNameOrId } from "../../../utils/resolveByNameOrId";

/**
 * Methods layered onto a live shared inventory by `wrapSharedInventory`. Reads are
 * `getX`/`hasX`; mutations are imperative verbs returning `Promise<void>` (they
 * dispatch a real `sharedInventory:*` action so cascades fire). A transfer target
 * is an `ActorRef` that may name an actor OR another pool.
 */
export interface SharedInventoryApiMethods {
	// ---- Reads (tier 1: pure utils) ----------------------------------------

	/** The pooled stat slot (name|id). -> SharedInventoryUtils.getStat */
	getStat(stat: RefByNameOrId): StatSlot | undefined;
	/** Current pooled value, or `null` if the pool doesn't track the stat. */
	getStatValue(stat: RefByNameOrId): number | null;
	/** Max for the pooled stat, or `undefined` if absent. */
	getStatMax(stat: RefByNameOrId): number | undefined;
	/** Whether the pool holds any copy of the item (name|id). */
	hasItem(item: RefByNameOrId): boolean;

	// ---- Mutations (tier 2: registered actions) ----------------------------

	/** Add `delta` to the pooled stat, clamped 0..Max. -> sharedInventory:editStat */
	changeStat(stat: RefByNameOrId, delta: number): Promise<void>;
	/** Set the pooled stat to `value`, clamped 0..Max. -> sharedInventory:editStat */
	setStat(stat: RefByNameOrId, value: number): Promise<void>;
	/** Transfer `amount` of a pooled stat to an actor or another pool. -> sharedInventory:transferStat */
	transferStatTo(target: ActorRef, stat: RefByNameOrId, amount: number): Promise<void>;
	/** Move one item slot (name|id) from the pool to an actor or another pool. -> sharedInventory:transferItem */
	transferItemTo(target: ActorRef, item: RefByNameOrId): Promise<void>;
	/** Remove one item slot (name|id) from the pool entirely. -> sharedInventory:discardItem */
	discardItem(item: RefByNameOrId): Promise<void>;
}

/** The live pool with API methods layered on (what `game.sharedInventory()` returns). */
export type SharedInventoryFacade = SharedInventory & SharedInventoryApiMethods;

// ---- Internal helpers -------------------------------------------------------

/** Resolve a stat NAME or definition Id to its StatDefinition Id, or undefined. */
function resolveStatId(api: ScriptApiContext, statRef: RefByNameOrId): string | undefined {
	return resolveByNameOrId(api.campaign().Settings.StatDefinitions, statRef)?.Id;
}

/**
 * Write one pooled stat's `Current` to `next` via `sharedInventory:editStat`. The
 * handler sets the value directly (no clamp), so the caller clamps to 0..Max first.
 */
function writeStatCurrent(
	api: ScriptApiContext,
	inventoryId: string,
	statId: string,
	next: number
): Promise<void> {
	return api.action("sharedInventory:editStat", {
		inventoryId,
		statId,
		updates: { Current: next },
	});
}

/** Keys `wrapSharedInventory` intercepts; anything else reflects to the live field. */
const SHARED_INV_API_KEYS = new Set<keyof SharedInventoryApiMethods>([
	"getStat",
	"getStatValue",
	"getStatMax",
	"hasItem",
	"changeStat",
	"setStat",
	"transferStatTo",
	"transferItemTo",
	"discardItem",
]);

/** Build the bound API method table for one live shared inventory. */
function makeSharedInventoryMethods(
	inv: SharedInventory,
	api: ScriptApiContext
): SharedInventoryApiMethods {
	return {
		// ---- Reads -----------------------------------------------------------
		getStat: (stat) => SharedInventoryUtils.getStat(inv, api.campaign(), stat),
		getStatValue: (stat) => SharedInventoryUtils.getStatValue(inv, api.campaign(), stat),
		getStatMax: (stat) => SharedInventoryUtils.getStatMax(inv, api.campaign(), stat),
		hasItem: (item) => !!SharedInventoryUtils.findItem(inv, api.campaign(), item),

		// ---- Mutations -------------------------------------------------------
		changeStat: async (stat, delta) => {
			const slot = SharedInventoryUtils.getStat(inv, api.campaign(), stat);
			if (!slot || slot.Current === null) return;
			const next = ActorUtils.clampStat(slot.Current + delta, slot.Max);
			if (next !== slot.Current) await writeStatCurrent(api, inv.Id, slot.Id, next);
		},
		setStat: async (stat, value) => {
			const slot = SharedInventoryUtils.getStat(inv, api.campaign(), stat);
			if (!slot || slot.Current === null) return;
			const next = ActorUtils.clampStat(value, slot.Max);
			if (next !== slot.Current) await writeStatCurrent(api, inv.Id, slot.Id, next);
		},
		transferStatTo: async (target, stat, amount) => {
			const targetId = SharedInventoryUtils.resolveTransferTargetId(api.campaign(), target);
			const statId = resolveStatId(api, stat);
			if (!targetId || !statId) return;
			// Source and target share the stat type, so the same definition Id is
			// both sourceStatId and targetStatId (mirrors actor.transferStatTo).
			await api.action("sharedInventory:transferStat", {
				sourceInventoryId: inv.Id,
				sourceStatId: statId,
				targetId,
				targetStatId: statId,
				amount,
			});
		},
		transferItemTo: async (target, item) => {
			const targetId = SharedInventoryUtils.resolveTransferTargetId(api.campaign(), target);
			// Gate on the pool actually holding the slot, so a missing item no-ops.
			const slot = SharedInventoryUtils.findItem(inv, api.campaign(), item);
			if (!targetId || !slot) return;
			await api.action("sharedInventory:transferItem", {
				sourceInventoryId: inv.Id,
				targetId,
				itemId: slot.Id,
			});
		},
		discardItem: async (item) => {
			const slot = SharedInventoryUtils.findItem(inv, api.campaign(), item);
			if (!slot) return;
			await api.action("sharedInventory:discardItem", {
				inventoryId: inv.Id,
				itemId: slot.Id,
			});
		},
	};
}

/**
 * Wrap a live shared inventory in its facade. Returns a Proxy over `inv` whose
 * `get` trap returns a bound API method for an API key and otherwise reflects to
 * the live field (so `.Name` / `.Stats` / any field added later read through).
 * Cached by `api.facadeCache` so repeated wraps of the same live pool return the
 * same facade. Mirrors `wrapActor`.
 */
export function wrapSharedInventory(
	inv: SharedInventory,
	api: ScriptApiContext
): SharedInventoryFacade {
	const cached = api.facadeCache.get(inv);
	if (cached) return cached as SharedInventoryFacade;

	let methods: SharedInventoryApiMethods | undefined;
	const facade = new Proxy(inv, {
		get(target, key) {
			if (
				typeof key === "string" &&
				SHARED_INV_API_KEYS.has(key as keyof SharedInventoryApiMethods)
			) {
				methods ??= makeSharedInventoryMethods(target, api);
				return (methods as any)[key];
			}
			return Reflect.get(target, key);
		},
	}) as SharedInventoryFacade;

	api.facadeCache.set(inv, facade);
	return facade;
}
