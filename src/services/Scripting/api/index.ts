/**
 * Scripting API — public barrel.
 *
 * The curated, DM-friendly layer the scripting engine exposes as `this`, `game`,
 * and the objects they reach, so an author can write the obvious thing
 * (`this.actor.changeStat(stat, -potency)`) without resolving GUIDs or rebuilding
 * arrays by hand. See `./README.md` (surface + decisions) and the implementation
 * brief `./IMPLEMENTATION_GUIDELINES.md`.
 *
 * STATUS: implemented and wired into `ScriptEngine`. Per script run the engine
 * builds one `ScriptApiContext` (`ScriptEngine.makeApiContext`) and threads it into:
 *   - `makeThis(binding, api)` — `this.actor` is `wrapActor(bearer, api)` layered
 *     onto the existing `vars` / `params` proxy (they compose, not collide: the
 *     proxy resolves vars/params/actor, and the actor facade reflects live fields);
 *   - `makeGameApi(api)` — the `game` facade (log/action still route through the
 *     run's sink via `api.action`);
 *   - `makeEvent` / `makeBeforeEvent` — `event.actor` wrapped via the same api.
 * The shared per-run `facadeCache` makes the identities coincide:
 * `this.actor === game.find(sameActor) === event.actor`.
 */

export type { ScriptApiContext } from "./apiContext";
export type { ActorRef, RefByNameOrId, ActorApiMethods, ActorFacade } from "./actorApi";
export { wrapActor, spawnActor } from "./actorApi";

export type { GameApi, TemplateCollection } from "./gameApi";
export { makeGameApi } from "./gameApi";

export type { CombatApi } from "./combatApi";
export { makeCombatApi } from "./combatApi";
export type { SceneApi } from "./sceneApi";
export { makeSceneApi } from "./sceneApi";
export type { AudioApi } from "./audioApi";
export { makeAudioApi } from "./audioApi";
export type { CalendarApi } from "./calendarApi";
export { makeCalendarApi } from "./calendarApi";

export type { SharedInventoryFacade, SharedInventoryApiMethods } from "./sharedInventoryApi";
export { wrapSharedInventory } from "./sharedInventoryApi";

export * as itemApi from "./itemApi";
export * as statusApi from "./statusApi";
export * as skillApi from "./skillApi";
export * as pingApi from "./pingApi";
