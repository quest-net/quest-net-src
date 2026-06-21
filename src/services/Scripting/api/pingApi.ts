/**
 * Ping operation.
 *
 * Shape: OPERATION MODULE — a ping is a one-shot ephemeral map highlight, not a
 * held instance, so this exports a plain single-call function (mirroring
 * `itemApi.spawnItem`). Surfaced FLAT as `game.ping(position)` to match the other
 * flat `game.*` verbs (`spawnItem` / `log` / `roll`).
 *
 * A ping lets a world rule draw the table's eye to a tile — "when the trap fires,
 * ping its tile." `ping:create` takes `{ terrainId, x, y, h }`, all of which a
 * `Position` already carries, so the verb takes just a position.
 *
 * No `actorId` is passed: that field only drives the per-actor anti-spam cooldown
 * for human-placed pings (see PingActions.create). A script-placed ping is a world
 * event, not an actor action, so it skips the cooldown by design.
 */
import type { Position } from "../../../domains/Actor/Actor";
import type { ScriptApiContext } from "./apiContext";

/**
 * Drop an ephemeral ping marker at a position. -> ping:create
 *
 * No-ops on a falsy position (nothing to ping). The handler bounds-checks x/y/h
 * against the target terrain, so an off-grid position is dropped there.
 */
export function ping(api: ScriptApiContext, position: Position): Promise<void> {
	if (!position) return Promise.resolve();
	return api.action("ping:create", {
		terrainId: position.terrainId,
		x: position.x,
		y: position.y,
		h: position.h,
	});
}
