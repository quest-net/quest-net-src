/**
 * Actor facade — the reference template for the scripting API.
 *
 * Shape: INSTANCE FACADE. An author always *holds* an actor (`this.actor`,
 * `game.find("Goblin")`, an element of `game.party()`), so `wrapActor` returns a
 * Proxy over the LIVE actor that passes every field through (`this.actor.Name`,
 * `this.actor.Position`, any field added later) and layers on the methods below.
 * This is the only instance facade — items/statuses/skills are slots referenced
 * by name, not field objects the author holds (see `itemApi`/`statusApi`/`skillApi`).
 *
 * This file is also the HOME of the two shared ref types every other facade
 * imports (never redefine them elsewhere — GUIDELINES rule 2).
 *
 * Resolution contract for every `RefByNameOrId` / `ActorRef`:
 *   Id (exact) -> Name (exact) -> first match -> undefined.
 * Ids are GUIDs so the cases never collide; the Id is the unambiguous escape hatch.
 * The single shared resolver is `ActorUtils.resolveActorId(campaign, ref)` (NEW util).
 *
 * Backing actions/utils:
 *   actions:  changeStat / setStat go through actor:edit (clamped 0..Max in the
 *             facade — no dedicated stat action, to keep the registry lean);
 *             dice:roll (observable roll; total + breakdown ride in event.params)
 *   utils:    ActorUtils.resolveActorId / resolveActiveActor / getStat (the one
 *             shared stat resolver), clampStat, distanceTo (movement-cost based),
 *             getTagValue, plus the read primitives behind hasStatus / getAttribute.
 */
import type { Actor, Position, StatSlot, StatusSlotExpiration } from "../../../domains/Actor/Actor";
import type { ScriptApiContext } from "./apiContext";
import { ActorUtils } from "../../../domains/Actor/ActorUtils";
import { resolveByNameOrId } from "../../../utils/resolveByNameOrId";
import { rollDiceFormula, getRollOutcome } from "../../../utils/DiceUtils";
import * as itemApi from "./itemApi";
import * as statusApi from "./statusApi";
import * as skillApi from "./skillApi";

/** A name OR an Id of some named thing (stat, item, status, skill, attribute, ...). */
export type RefByNameOrId = string;

/** An actor by held object/facade, or by name/Id. Resolved via ActorUtils.resolveActorId. */
export type ActorRef = string | { Id: string };

/**
 * Methods layered onto the live actor by `wrapActor`. Reads are `getX`/`hasX`/
 * `isX`; mutations are imperative verbs returning `Promise<void>` (they dispatch a
 * real action so cascades fire — never a raw field write). Cross-domain forwarders
 * delegate to the sibling operation modules (logic does NOT live here).
 */
export interface ActorApiMethods {
	// ---- Reads (tier 1: pure utils) ----------------------------------------

	/** The stat slot (name|id). -> NEW util ActorUtils.getStat */
	getStat(stat: RefByNameOrId): StatSlot | undefined;
	/** Current value, or `null` if the actor doesn't have the stat. -> NEW util */
	getStatValue(stat: RefByNameOrId): number | null;
	/** Max for the stat, or `undefined` if absent. -> NEW util */
	getStatMax(stat: RefByNameOrId): number | undefined;
	/** Whether the actor has the stat set (Current !== null). -> NEW util */
	hasStat(stat: RefByNameOrId): boolean;
	/** Whether any stack of the status is on the actor. -> NEW util */
	hasStatus(status: RefByNameOrId): boolean;
	/** Attribute value (name|id), or `undefined`. -> NEW util */
	getAttribute(attr: RefByNameOrId): string | undefined;
	/** "character" | "entity" (or undefined if unresolvable). -> ActorUtils.getActorKind */
	getKind(): "character" | "entity" | undefined;
	/** Sugar over getKind(). */
	isCharacter(): boolean;
	/** Sugar over getKind(). */
	isEntity(): boolean;
	/** Grid distance to another actor (same terrain). -> NEW util (position math) */
	distanceTo(other: ActorRef): number;
	/** distanceTo(other) <= 1. -> NEW util */
	isAdjacentTo(other: ActorRef): boolean;
	/**
	 * Value of a `"prefix:value"` tag, e.g. getTagValue("level") -> "7" for tag
	 * "level:7" (caller does Number()); `undefined` if absent. -> NEW util
	 */
	getTagValue(prefix: string): string | undefined;

	// ---- Mutations (tier 2: registered actions) ----------------------------

	/** Add `delta` to the stat, clamped 0..Max. -> actor:edit (clamp in facade) */
	changeStat(stat: RefByNameOrId, delta: number): Promise<void>;
	/** Set the stat to `value`, clamped 0..Max. -> actor:edit (clamp in facade) */
	setStat(stat: RefByNameOrId, value: number): Promise<void>;
	/** Transfer `amount` of `stat` to another actor/shared inventory. -> actor:transferStat */
	transferStatTo(other: ActorRef, stat: RefByNameOrId, amount: number): Promise<void>;
	/** Teleport to a position (no pathing). -> actor:move */
	move(position: Position): Promise<void>;
	/** Escape hatch for fields without a dedicated verb. -> actor:edit */
	edit(updates: Partial<Actor>): Promise<void>;
	/** Remove from the field (character -> roster, entity -> deleted). -> actor:despawn */
	despawn(): Promise<void>;
	/**
	 * OBSERVABLE roll: computes a total and dispatches `dice:roll` so other scripts
	 * can react (re-roll/announce). Returns the total. For silent math use `game.roll`.
	 * `tags` label the roll in the log; `secret: true` forces a DM-only log line
	 * (otherwise it follows the campaign's "players see DM rolls" setting).
	 * -> action dice:roll (total + breakdown ride in event.params; event.result is dead in cascades)
	 */
	roll(expr: string, opts?: { tags?: string[]; secret?: boolean }): Promise<number>;
	/**
	 * Private toast/whisper to THIS actor's player: a line only this character's
	 * player (and the DM) can see, surfaced as a toast alert for them. -> log:create
	 * (owner visibility + self-mention)
	 */
	toast(text: string, opts?: { category?: string; level?: string; details?: string }): Promise<void>;

	// ---- Cross-domain forwarders (logic lives in sibling modules) ----------

	giveStatus(status: RefByNameOrId, count?: number): Promise<void>; // -> statusApi.give -> status:give
	removeStatus(status: RefByNameOrId): Promise<void>; // -> statusApi.remove -> status:remove
	/** Set a status's absolute expiration (not a delta). -> statusApi.setDuration -> status:adjustDuration */
	setStatusDuration(status: RefByNameOrId, expiration: StatusSlotExpiration): Promise<void>;
	giveItem(item: RefByNameOrId, count?: number): Promise<void>; // -> itemApi.give -> item:give
	removeItem(item: RefByNameOrId, count?: number): Promise<void>; // -> itemApi.remove -> item:discard
	useItem(item: RefByNameOrId): Promise<void>; // -> itemApi.use -> item:use
	equipItem(item: RefByNameOrId): Promise<void>; // -> itemApi.equip -> item:equip
	unequipItem(item: RefByNameOrId): Promise<void>; // -> itemApi.unequip -> item:unequip
	/** Set an item's remaining uses (number, or undefined for unlimited). -> itemApi.adjustUses -> item:adjustUses */
	setItemUses(item: RefByNameOrId, usesLeft: number | undefined): Promise<void>;
	giveSkill(skill: RefByNameOrId): Promise<void>; // -> skillApi.give -> skill:give
	removeSkill(skill: RefByNameOrId): Promise<void>; // -> skillApi.remove -> skill:discard
	useSkill(skill: RefByNameOrId): Promise<void>; // -> skillApi.use -> skill:use
	/** Set a skill's remaining uses (number, or undefined for unlimited). -> skillApi.adjustUses -> skill:adjustUses */
	setSkillUses(skill: RefByNameOrId, usesLeft: number | undefined): Promise<void>;
}

/** The live actor with API methods layered on (what `this.actor` / `game.find()` return). */
export type ActorFacade = Actor & ActorApiMethods;

// ---- Internal helpers -------------------------------------------------------

/**
 * Resolve a stat NAME or definition Id to its StatDefinition Id. `actor:transferStat`
 * takes `statId`s (definition Ids), so `transferStatTo` resolves the author-typed ref
 * to that Id before dispatching. Returns undefined when nothing matches (the caller
 * then no-ops rather than dispatching a doomed action). (changeStat/setStat resolve
 * via ActorUtils.getStat instead — they need the slot's Current/Max to clamp.)
 */
function resolveStatId(api: ScriptApiContext, statRef: RefByNameOrId): string | undefined {
	return resolveByNameOrId(api.campaign().Settings.StatDefinitions, statRef)?.Id;
}

/**
 * Write one stat slot's `Current` to `next` via `actor:edit` (this lean version has
 * no dedicated actor:changeStat/setStat action). Rebuilds `Stats` with only that
 * slot changed, as plain objects (never the live proxy slots), and lets `actor:edit`
 * apply + log it. The caller clamps to 0..Max first.
 */
function writeStatCurrent(
	api: ScriptApiContext,
	actor: Actor,
	slotId: string,
	next: number
): Promise<void> {
	const Stats = actor.Stats.map((s) =>
		s.Id === slotId ? { ...s, Current: next } : { ...s }
	);
	return api.action("actor:edit", { actorId: actor.Id, updates: { Stats } });
}

/**
 * The set of keys `wrapActor` intercepts. Anything not here reflects straight to
 * the live actor field, so the model can grow without touching this file.
 */
const ACTOR_API_KEYS = new Set<keyof ActorApiMethods>([
	"getStat",
	"getStatValue",
	"getStatMax",
	"hasStat",
	"hasStatus",
	"getAttribute",
	"getKind",
	"isCharacter",
	"isEntity",
	"distanceTo",
	"isAdjacentTo",
	"getTagValue",
	"changeStat",
	"setStat",
	"transferStatTo",
	"move",
	"edit",
	"despawn",
	"roll",
	"toast",
	"giveStatus",
	"removeStatus",
	"setStatusDuration",
	"giveItem",
	"removeItem",
	"useItem",
	"equipItem",
	"unequipItem",
	"setItemUses",
	"giveSkill",
	"removeSkill",
	"useSkill",
	"setSkillUses",
]);

/**
 * Build the bound API method table for one live actor. Reads delegate to
 * `ActorUtils` (tier 1, pure); mutations resolve refs to ids then dispatch a real
 * action through `api.action` (tier 2) so cascades fire; cross-domain verbs forward
 * to the sibling operation modules. `self` is the facade itself, so a forwarder
 * passes a stable ActorRef (`self.Id`) the sibling module re-resolves.
 */
function makeActorMethods(
	actor: Actor,
	api: ScriptApiContext,
	self: ActorFacade
): ActorApiMethods {
	return {
		// ---- Reads -----------------------------------------------------------
		getStat: (stat) => ActorUtils.getStat(actor, api.campaign(), stat),
		getStatValue: (stat) => ActorUtils.getStatValue(actor, api.campaign(), stat),
		getStatMax: (stat) => ActorUtils.getStatMax(actor, api.campaign(), stat),
		hasStat: (stat) => ActorUtils.hasStat(actor, api.campaign(), stat),
		hasStatus: (status) => statusApi.has(api, self, status),
		getAttribute: (attr) => ActorUtils.getAttribute(actor, api.campaign(), attr),
		getKind: () => ActorUtils.getActorKind(api.context, actor.Id),
		isCharacter: () => ActorUtils.getActorKind(api.context, actor.Id) === "character",
		isEntity: () => ActorUtils.getActorKind(api.context, actor.Id) === "entity",
		distanceTo: (other) => {
			const target = ActorUtils.resolveActiveActor(api.campaign(), other);
			return target ? ActorUtils.distanceTo(actor, target, api.campaign()) : Infinity;
		},
		isAdjacentTo: (other) => {
			const target = ActorUtils.resolveActiveActor(api.campaign(), other);
			return target ? ActorUtils.isAdjacentTo(actor, target, api.campaign()) : false;
		},
		getTagValue: (prefix) => ActorUtils.getTagValue(actor, prefix),

		// ---- Mutations -------------------------------------------------------
		changeStat: async (stat, delta) => {
			const slot = ActorUtils.getStat(actor, api.campaign(), stat);
			if (!slot || slot.Current === null) return;
			const next = ActorUtils.clampStat(slot.Current + delta, slot.Max);
			if (next !== slot.Current) await writeStatCurrent(api, actor, slot.Id, next);
		},
		setStat: async (stat, value) => {
			const slot = ActorUtils.getStat(actor, api.campaign(), stat);
			if (!slot || slot.Current === null) return;
			const next = ActorUtils.clampStat(value, slot.Max);
			if (next !== slot.Current) await writeStatCurrent(api, actor, slot.Id, next);
		},
		transferStatTo: async (other, stat, amount) => {
			const targetId = ActorUtils.resolveActorId(api.campaign(), other);
			const statId = resolveStatId(api, stat);
			if (!targetId || !statId) return;
			// The handler resolves source/target stats by the same definition Id on
			// each actor (source and target share the stat type).
			await api.action("actor:transferStat", {
				sourceActorId: actor.Id,
				sourceStatId: statId,
				targetId,
				targetStatId: statId,
				amount,
			});
		},
		move: async (position) => {
			await api.action("actor:move", { actorId: actor.Id, position });
		},
		edit: async (updates) => {
			await api.action("actor:edit", { actorId: actor.Id, updates });
		},
		despawn: async () => {
			await api.action("actor:despawn", { actorId: actor.Id });
		},
		roll: async (expr, opts) => {
			// Compute the full result here, then carry total + breakdown + the
			// structured crit/fumble outcome in the params (event.result is dead
			// inside cascades). The dice:roll handler logs it; the outcome drives
			// crit detection structurally (no re-parsing the breakdown text).
			const result = rollDiceFormula(expr);
			await api.action("dice:roll", {
				actorId: actor.Id,
				expr,
				total: result.total,
				breakdown: result.breakdown,
				rollOutcome: getRollOutcome(result),
				tags: opts?.tags,
				secret: opts?.secret,
			});
			return result.total;
		},
		toast: (text, opts) =>
			// Owner-scoped + self-mention: private to this actor's player (and the DM),
			// and the mention surfaces it as a toast for them. Mirrors game.toast.
			api.action("log:create", {
				action: text,
				details: opts?.details,
				category: opts?.category ?? "chat",
				level: opts?.level ?? "info",
				visibility: ["owner"],
				mentionedActorIds: [actor.Id],
			}),

		// ---- Cross-domain forwarders ----------------------------------------
		giveStatus: (status, count) => statusApi.give(api, self, status, count),
		removeStatus: (status) => statusApi.remove(api, self, status),
		setStatusDuration: (status, expiration) =>
			statusApi.setDuration(api, self, status, expiration),
		giveItem: (item, count) => itemApi.give(api, self, item, count),
		removeItem: (item, count) => itemApi.remove(api, self, item, count),
		useItem: (item) => itemApi.use(api, self, item),
		equipItem: (item) => itemApi.equip(api, self, item),
		unequipItem: (item) => itemApi.unequip(api, self, item),
		setItemUses: (item, usesLeft) => itemApi.adjustUses(api, self, item, usesLeft),
		giveSkill: (skill) => skillApi.give(api, self, skill),
		removeSkill: (skill) => skillApi.remove(api, self, skill),
		useSkill: (skill) => skillApi.use(api, self, skill),
		setSkillUses: (skill, usesLeft) => skillApi.adjustUses(api, self, skill, usesLeft),
	};
}

/**
 * Wrap a live actor in its facade.
 *
 * Returns a Proxy over `actor` whose `get` trap returns a bound API method when
 * the key is one of `ActorApiMethods`, and otherwise reflects to the live field
 * (so `this.actor.Name`, `this.actor.Position`, any field added later all read
 * through). Cached by `api.facadeCache.get(actor)` so repeated wraps of the same
 * live actor return the same facade (identity equality across
 * `game.find`/`this.actor`).
 *
 * SCOPE: this does NOT layer `vars`/`params` onto the actor — that composition
 * stays in ScriptEngine.makeThis (the engine-wiring step). `wrapActor` only knows
 * the actor's fields + the API methods.
 */
export function wrapActor(actor: Actor, api: ScriptApiContext): ActorFacade {
	const cached = api.facadeCache.get(actor);
	if (cached) return cached as ActorFacade;

	// Build lazily so the methods can close over the finished facade (`self`) for
	// the cross-domain forwarders, while the proxy is what callers actually hold.
	let methods: ActorApiMethods | undefined;
	const facade = new Proxy(actor, {
		get(target, key) {
			if (typeof key === "string" && ACTOR_API_KEYS.has(key as keyof ActorApiMethods)) {
				methods ??= makeActorMethods(target, api, facade as ActorFacade);
				return (methods as any)[key];
			}
			return Reflect.get(target, key);
		},
	}) as ActorFacade;

	api.facadeCache.set(actor, facade);
	return facade;
}

/**
 * Spawn an actor onto the field from the roster (character) or templates (entity),
 * resolved by name/Id. A MODULE function, not an instance method — there is no
 * facade to hold before the actor exists. Surfaced flat as `game.spawnActor`.
 *
 * For spawn the ref resolves over CharacterRoster + EntityTemplates (the
 * not-yet-active sources), NOT active actors, since the actor does not exist on the
 * field yet. The unified actor:spawn handler resolves kind from the id and routes
 * to the right spawn semantics. -> actor:spawn
 */
export function spawnActor(
	api: ScriptApiContext,
	ref: ActorRef,
	position?: Position
): Promise<void> {
	const campaign = api.campaign();
	let actorId: string | undefined;
	if (ref != null && typeof ref === "object") {
		actorId = ref.Id;
	} else {
		// Resolve over the spawnable sources (roster + templates), not active actors.
		const spawnable = [...campaign.CharacterRoster, ...campaign.EntityTemplates];
		actorId = resolveByNameOrId(spawnable, ref)?.Id;
	}
	if (!actorId) return Promise.resolve();
	return api.action("actor:spawn", { actorId, position });
}
