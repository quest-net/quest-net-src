/**
 * Status operations.
 *
 * Shape: OPERATION MODULE (statuses are slots on an actor, referenced by name —
 * not held field objects). The actor facade's `giveStatus`/`removeStatus` and
 * `hasStatus` forwarders delegate here. Verbs normalized to give / remove.
 *
 * Single-target: `give` may apply `count` stacks (one action); `remove` drops ONE
 * copy — clearing every stack is the author's loop (no `removeAll`, no `count` on
 * remove). `getSlots` is the distinct all-stacks read (plural, deliberately not
 * `getSlot`).
 *
 * Resolution: refs are name|id. Actors resolve via `ActorUtils.resolveActorId`;
 * status templates resolve via `StatusUtils.findTemplate`. Every method no-ops
 * cleanly when its actor or status ref doesn't resolve (no doomed dispatch).
 *
 * Tier discipline: mutations dispatch a real registered action (status:give /
 * status:remove); reads delegate to `StatusUtils.findSlots` (tier 1, pure). No
 * mutation logic lives here.
 */
import type { StatusSlot, StatusSlotExpiration } from "../../../domains/Actor/Actor";
import type { ScriptApiContext } from "./apiContext";
import type { ActorRef, RefByNameOrId } from "./actorApi";
import { ActorUtils } from "../../../domains/Actor/ActorUtils";
import { StatusUtils } from "../../../domains/Status/StatusUtils";

/**
 * Give `count` stacks of a status (name|id) to an actor — one `status:give` action.
 * Defaults to 1 stack; the handler floors/clamps count to >= 1. No-ops if the
 * actor or status ref doesn't resolve. -> status:give
 */
export function give(
	api: ScriptApiContext,
	actor: ActorRef,
	status: RefByNameOrId,
	count?: number
): Promise<void> {
	const campaign = api.campaign();
	const actorId = ActorUtils.resolveActorId(campaign, actor);
	const statusId = StatusUtils.findTemplate(campaign, status)?.Id;
	if (!actorId || !statusId) return Promise.resolve();
	return api.action("status:give", {
		actorIds: [actorId],
		statusIds: [statusId],
		count: count ?? 1,
	});
}

/**
 * Remove ONE stack of a status (name|id) from an actor (the handler drops the first
 * matching slot). No count, no removeAll — clearing every copy is the author's loop.
 * No-ops if the actor or status ref doesn't resolve. -> status:remove
 */
export function remove(
	api: ScriptApiContext,
	actor: ActorRef,
	status: RefByNameOrId
): Promise<void> {
	const campaign = api.campaign();
	const actorId = ActorUtils.resolveActorId(campaign, actor);
	const statusId = StatusUtils.findTemplate(campaign, status)?.Id;
	if (!actorId || !statusId) return Promise.resolve();
	return api.action("status:remove", { actorId, statusId });
}

/**
 * Set the absolute expiration of a status (name|id) on an actor (the handler edits
 * the FIRST matching slot). The `expiration` is the full runtime expiration object,
 * e.g. `{ type: "turns", turnsLeft: 3 }`, `{ type: "days", daysLeft: 2 }`, or
 * `{ type: "permanent" }` — it SETS, it does not add a delta (read `getSlots` first
 * if you want to extend by N). No-ops if the actor/status ref doesn't resolve or the
 * actor carries no stack (so an absent status never logs a doomed warning).
 * -> status:adjustDuration
 */
export function setDuration(
	api: ScriptApiContext,
	actor: ActorRef,
	status: RefByNameOrId,
	expiration: StatusSlotExpiration
): Promise<void> {
	const campaign = api.campaign();
	const actorId = ActorUtils.resolveActorId(campaign, actor);
	const statusId = StatusUtils.findTemplate(campaign, status)?.Id;
	if (!actorId || !statusId) return Promise.resolve();
	// Gate on a live stack so a status the actor doesn't carry no-ops cleanly.
	if (getSlots(api, actor, status).length === 0) return Promise.resolve();
	return api.action("status:adjustDuration", { actorId, statusId, expiration });
}

/** Whether the actor has any stack of the status (name|id). -> StatusUtils.findSlots */
export function has(
	api: ScriptApiContext,
	actor: ActorRef,
	status: RefByNameOrId
): boolean {
	return getSlots(api, actor, status).length > 0;
}

/**
 * Every stack of the status (name|id) on the actor (live data, no clone). `[]` when
 * the actor or status ref doesn't resolve, or no stack is present.
 * -> StatusUtils.findSlots
 */
export function getSlots(
	api: ScriptApiContext,
	actor: ActorRef,
	status: RefByNameOrId
): StatusSlot[] {
	const campaign = api.campaign();
	const live = ActorUtils.resolveActiveActor(campaign, actor);
	if (!live) return [];
	return StatusUtils.findSlots(live, campaign, status);
}
