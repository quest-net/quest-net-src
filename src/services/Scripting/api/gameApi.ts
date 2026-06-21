/**
 * `game` facade integrator.
 *
 * Builds the curated `game` object a script runs with, replacing the inline
 * `makeGame` in `ScriptEngine` once wiring lands. It keeps the existing flat
 * surface (`roll`/`rng`/`log`/`action`/`template`/`campaign`) but upgrades the
 * actor reads to return `ActorFacade`s (wrapped via the shared `facadeCache`, so
 * `game.find("X") === this.actor`) and mounts the cross-domain singletons as
 * `game.combat` / `game.scene` / `game.audio`. Spawn verbs stay FLAT
 * (`game.spawnActor` / `game.spawnItem`) to match the other flat `game.*` verbs.
 *
 * Tier discipline (mirrors the other facades): reads delegate to tier-1 utils /
 * pure helpers (`resolveByNameOrId`, `rollDiceFormula`, the active-actor reads);
 * mutations dispatch a real scriptable action through `api.action`. No new
 * mutation logic lives here — `log`/`spawnActor`/`spawnItem` all bottom out in
 * already-scriptable actions.
 */
import type { Campaign } from "../../../domains/Campaign/Campaign";
import type { Position, Actor } from "../../../domains/Actor/Actor";
import type { ScriptApiContext } from "./apiContext";
import {
	wrapActor,
	spawnActor as spawnActorApi,
	type ActorFacade,
	type ActorRef,
	type RefByNameOrId,
} from "./actorApi";
import { makeCombatApi, type CombatApi } from "./combatApi";
import { makeSceneApi, type SceneApi } from "./sceneApi";
import { makeAudioApi, type AudioApi } from "./audioApi";
import { makeCalendarApi, type CalendarApi } from "./calendarApi";
import { spawnItem as spawnItemApi } from "./itemApi";
import { ping as pingApi } from "./pingApi";
import {
	wrapSharedInventory,
	type SharedInventoryFacade,
} from "./sharedInventoryApi";
import * as statusApi from "./statusApi";
import { ActorUtils } from "../../../domains/Actor/ActorUtils";
import { SharedInventoryUtils } from "../../../domains/SharedInventory/SharedInventoryUtils";
import { resolveByNameOrId } from "../../../utils/resolveByNameOrId";
import { rollDiceFormula } from "../../../utils/DiceUtils";

/** Template collections a script can resolve a template by name from (mirrors ScriptEngine). */
export type TemplateCollection =
	| "EntityTemplates"
	| "ItemTemplates"
	| "SkillTemplates"
	| "StatusTemplates"
	| "CharacterRoster";

export interface GameApi {
	/** The live active campaign (escape hatch for arbitrary reads). */
	readonly campaign: Campaign;

	/** Combat singleton. */
	readonly combat: CombatApi;
	/** Scene singleton. */
	readonly scene: SceneApi;
	/** Audio singleton. */
	readonly audio: AudioApi;
	/** Calendar singleton (in-world date + rests). */
	readonly calendar: CalendarApi;

	/** Every active actor (characters + entities), wrapped. */
	actors(): ActorFacade[];
	/** Active characters, wrapped. */
	party(): ActorFacade[];
	/** Active entities, wrapped. */
	enemies(): ActorFacade[];
	/** First active actor whose name matches (name|id), wrapped, or undefined. */
	find(nameOrId: string): ActorFacade | undefined;
	/** Active actors carrying a status (name|id), wrapped. */
	actorsWithStatus(status: RefByNameOrId): ActorFacade[];
	/** Resolve a shared inventory pool (name|id), wrapped, or undefined. */
	sharedInventory(ref: RefByNameOrId): SharedInventoryFacade | undefined;
	/** Every shared inventory pool, wrapped. */
	sharedInventories(): SharedInventoryFacade[];
	/** Resolve a template by name from a collection (unchanged from today). */
	template(collection: TemplateCollection, name: string): { Id: string; Name: string } | undefined;

	/** Silent dice math (no cascade). Use actor.roll for an observable roll. */
	roll(expr: string): number;
	/** Math.random passthrough. */
	rng(): number;
	/** Write a log line. -> log:create */
	log(text: string, opts?: { category?: string; level?: string; details?: string }): Promise<void>;
	/** Dispatch any scriptable action by key (the raw escape hatch). */
	action(key: string, params?: any): Promise<void>;

	/** Spawn an actor from roster/templates (name|id). -> actorApi.spawnActor -> actor:spawn */
	spawnActor(ref: ActorRef, position?: Position): Promise<void>;
	/** Drop an item template (name|id) onto the map. -> itemApi.spawnItem -> item:spawn */
	spawnItem(item: RefByNameOrId, position: Position): Promise<void>;
	/** Drop an ephemeral ping marker at a position. -> pingApi.ping -> ping:create */
	ping(position: Position): Promise<void>;
}

/** Every active actor (characters + entities) — the read all actor-list reads share. */
function activeActors(campaign: Campaign): Actor[] {
	return ActorUtils.getActiveActors(campaign);
}

/**
 * Build the `game` facade for one script run.
 *
 * The cross-domain singletons (`combat`/`scene`/`audio`) are built ONCE here and
 * cached in the closure — accessing `game.combat` repeatedly returns the same
 * instance rather than rebuilding the facade on every property read (the inner
 * facades still re-read live campaign state on each call, so caching the wrapper
 * is safe).
 */
export function makeGameApi(api: ScriptApiContext): GameApi {
	// Build the singletons lazily-once so a run that never touches combat/scene/
	// audio/calendar pays nothing, but repeat access shares one instance.
	let combat: CombatApi | undefined;
	let scene: SceneApi | undefined;
	let audio: AudioApi | undefined;
	let calendar: CalendarApi | undefined;

	return {
		// ---- Reads: pull live every access; never cache the campaign ----------
		get campaign() {
			return api.campaign();
		},
		get combat() {
			return (combat ??= makeCombatApi(api));
		},
		get scene() {
			return (scene ??= makeSceneApi(api));
		},
		get audio() {
			return (audio ??= makeAudioApi(api));
		},
		get calendar() {
			return (calendar ??= makeCalendarApi(api));
		},

		// ---- Wrapped actor reads (shared facadeCache -> stable identity) ------
		actors: () => activeActors(api.campaign()).map((a) => wrapActor(a, api)),
		party: () =>
			api.campaign().GameState.Characters.map((a) => wrapActor(a, api)),
		enemies: () =>
			api.campaign().GameState.Entities.map((a) => wrapActor(a, api)),
		find: (nameOrId: string) => {
			// Resolution contract: Id -> Name -> first glob -> undefined over the
			// active actors (superset of the old glob-only makeGame.find: still
			// globs, plus the Id-exact escape hatch).
			const match = resolveByNameOrId(activeActors(api.campaign()), nameOrId);
			return match ? wrapActor(match, api) : undefined;
		},
		actorsWithStatus: (status: RefByNameOrId) =>
			activeActors(api.campaign())
				// statusApi.has resolves the status template name/Id and checks the
				// actor's live stacks; wrap only the carriers.
				.filter((a) => statusApi.has(api, a, status))
				.map((a) => wrapActor(a, api)),

		// ---- Wrapped shared-inventory reads (shared facadeCache) -------------
		sharedInventory: (ref: RefByNameOrId) => {
			const inv = SharedInventoryUtils.findInventory(api.campaign(), ref);
			return inv ? wrapSharedInventory(inv, api) : undefined;
		},
		sharedInventories: () =>
			SharedInventoryUtils.getInventories(api.campaign()).map((inv) =>
				wrapSharedInventory(inv, api)
			),

		// ---- Template resolution (mirrors ScriptEngine.resolveTemplate) -------
		template: (collection: TemplateCollection, name: string) =>
			resolveByNameOrId(
				(api.campaign() as any)[collection] as Array<{ Id: string; Name: string }>,
				name
			),

		// ---- Silent dice / rng (no dispatch; the observable path is actor.roll)
		roll: (expr: string) => rollDiceFormula(expr).total,
		rng: () => Math.random(),

		// ---- Mutations: dispatch scriptable actions through the run's sink ----
		log: (text, opts) =>
			api.action("log:create", {
				action: text,
				details: opts?.details,
				category: opts?.category ?? "system",
				level: opts?.level ?? "info",
			}),
		action: (key, params) => api.action(key, params),

		// ---- Spawn / ping verbs (FLAT) -> delegate to sibling module fns ------
		spawnActor: (ref, position) => spawnActorApi(api, ref, position),
		spawnItem: (item, position) => spawnItemApi(api, item, position),
		ping: (position) => pingApi(api, position),
	};
}
