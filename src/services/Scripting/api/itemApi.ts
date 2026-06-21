/**
 * Item operations.
 *
 * Shape: OPERATION MODULE. An item is a slot on an actor (or loot dropped on the
 * map), not a field object an author holds — so this exports plain single-target
 * functions, NOT an instance facade. The actor facade's `giveItem`/`removeItem`/
 * `useItem` forwarders delegate here; `game.spawnItem` calls `spawnItem`. Item
 * helpers stay in THIS file — they are never imported into `actorApi`.
 *
 * Verbs are normalized to give / remove / use (the underlying actions are
 * item:give / item:discard / item:use). Single-target only: applying to many
 * actors is the author's loop. `count` is allowed on give/remove (one action each).
 *
 * Resolution: the actor resolves via `ActorUtils.resolveActorId` (Id -> Name ->
 * first -> undefined over active actors); the item TEMPLATE resolves via
 * `ItemUtils.findTemplate`. For remove/use we operate on a slot the actor holds,
 * found via `ItemUtils.findSlot` (resolve template Id, then match the actor slot
 * whose `.Id` equals it). Every method no-ops cleanly when resolution fails.
 */
import type { Position } from "../../../domains/Actor/Actor";
import type { ScriptApiContext } from "./apiContext";
import type { ActorRef, RefByNameOrId } from "./actorApi";
import { ActorUtils } from "../../../domains/Actor/ActorUtils";
import { ItemUtils } from "../../../domains/Item/ItemUtils";

/**
 * Give `count` copies of an item (template name|id) to an actor. -> item:give
 *
 * `item:give` takes arrays (`itemIds`/`actorIds`) and a `count`; the facade is
 * single-target, so it passes one-element arrays. The handler clamps `count`
 * (`Math.max(1, Math.floor(count))`), so the facade does not re-clamp.
 */
export function give(
	api: ScriptApiContext,
	actor: ActorRef,
	item: RefByNameOrId,
	count?: number
): Promise<void> {
	const campaign = api.campaign();
	const actorId = ActorUtils.resolveActorId(campaign, actor);
	const itemId = ItemUtils.findTemplate(campaign, item)?.Id;
	if (!actorId || !itemId) return Promise.resolve();
	return api.action("item:give", {
		itemIds: [itemId],
		actorIds: [actorId],
		count: count ?? 1,
	});
}

/**
 * Remove `count` copies of an item (template name|id) from an actor. -> item:discard
 *
 * `item:discard` removes a single slot per call (no count param), so removing N
 * copies fires N discards. Each is gated on the actor still holding a matching
 * slot, so removing more than the actor has stops cleanly rather than dispatching
 * doomed actions.
 */
export async function remove(
	api: ScriptApiContext,
	actor: ActorRef,
	item: RefByNameOrId,
	count?: number
): Promise<void> {
	const campaign = api.campaign();
	const actorId = ActorUtils.resolveActorId(campaign, actor);
	const itemId = ItemUtils.findTemplate(campaign, item)?.Id;
	if (!actorId || !itemId) return;

	const times = Math.max(1, Math.floor(count ?? 1));
	for (let i = 0; i < times; i++) {
		// Re-read the live actor each pass: the prior discard mutated the slot list.
		// Pass the raw ref to findSlot (resolves internally) — same call shape as
		// skillApi/statusApi.
		const live = ActorUtils.resolveActiveActor(campaign, actorId);
		if (!live || !ItemUtils.findSlot(live, campaign, item)) return;
		await api.action("item:discard", { actorId, itemId });
	}
}

/**
 * Use an item the actor holds (template name|id). -> item:use
 *
 * Single-target use: the actor forwarder carries no target args, so only
 * `{ actorId, itemId }` is passed (the handler's `targetActorId`/`targetPosition`/
 * `diceFormula` are optional). Gated on the actor actually holding the slot.
 */
export function use(
	api: ScriptApiContext,
	actor: ActorRef,
	item: RefByNameOrId
): Promise<void> {
	const campaign = api.campaign();
	const live = ActorUtils.resolveActiveActor(campaign, actor);
	if (!live) return Promise.resolve();
	const slot = ItemUtils.findSlot(live, campaign, item);
	if (!slot) return Promise.resolve();
	return api.action("item:use", { actorId: live.Id, itemId: slot.Id });
}

/**
 * Equip an item the actor holds in inventory (template name|id). -> item:equip
 *
 * The handler refuses non-equippable items and items not in inventory, so the
 * facade just resolves the slot the actor holds (inventory or equipment) and
 * dispatches; an unheld item no-ops cleanly. (Re-equipping an already-equipped item
 * is a handler no-op via its inventory check.)
 */
export function equip(
	api: ScriptApiContext,
	actor: ActorRef,
	item: RefByNameOrId
): Promise<void> {
	const campaign = api.campaign();
	const live = ActorUtils.resolveActiveActor(campaign, actor);
	if (!live) return Promise.resolve();
	const slot = ItemUtils.findSlot(live, campaign, item);
	if (!slot) return Promise.resolve();
	return api.action("item:equip", { actorId: live.Id, itemId: slot.Id });
}

/**
 * Unequip an item the actor has equipped (template name|id). -> item:unequip
 *
 * Resolves the actor's slot first (an unheld item no-ops); the handler moves it
 * from equipment back to inventory and is a no-op if the item isn't equipped.
 */
export function unequip(
	api: ScriptApiContext,
	actor: ActorRef,
	item: RefByNameOrId
): Promise<void> {
	const campaign = api.campaign();
	const live = ActorUtils.resolveActiveActor(campaign, actor);
	if (!live) return Promise.resolve();
	const slot = ItemUtils.findSlot(live, campaign, item);
	if (!slot) return Promise.resolve();
	return api.action("item:unequip", { actorId: live.Id, itemId: slot.Id });
}

/**
 * Set the remaining uses of an item the actor holds (template name|id). -> item:adjustUses
 *
 * Absolute set, not a delta: `usesLeft` is the new value, or `undefined` for
 * unlimited (recharge/drain a charged item). Resolves the actor's slot first so an
 * unheld item no-ops; the handler finds the slot in inventory or equipment.
 */
export function adjustUses(
	api: ScriptApiContext,
	actor: ActorRef,
	item: RefByNameOrId,
	usesLeft: number | undefined
): Promise<void> {
	const campaign = api.campaign();
	const live = ActorUtils.resolveActiveActor(campaign, actor);
	if (!live) return Promise.resolve();
	const slot = ItemUtils.findSlot(live, campaign, item);
	if (!slot) return Promise.resolve();
	return api.action("item:adjustUses", { actorId: live.Id, itemId: slot.Id, usesLeft });
}

/**
 * Drop a fresh copy of an item template (name|id) onto the map as loot. -> item:spawn
 *
 * `item:spawn` requires `terrainId` and takes an optional `position`; the facade's
 * `position` carries its own `terrainId`, so both are derived from it.
 */
export function spawnItem(
	api: ScriptApiContext,
	item: RefByNameOrId,
	position: Position
): Promise<void> {
	const campaign = api.campaign();
	const itemId = ItemUtils.findTemplate(campaign, item)?.Id;
	if (!itemId || !position) return Promise.resolve();
	return api.action("item:spawn", {
		itemId,
		terrainId: position.terrainId,
		position,
	});
}
