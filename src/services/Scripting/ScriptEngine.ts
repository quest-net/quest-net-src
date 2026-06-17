/**
 * Script engine (v2 — action-driven ECA rules).
 *
 * Replaces the v1 QuickJS sandbox + snapshot-diffing dispatcher with a tiny,
 * self-contained reactor over LIVE objects:
 *
 *   ActionService runs a domain action → calls ScriptEngine.onAction(...) →
 *   the engine finds every enabled script whose Trigger glob matches the action
 *   key, binds `this` / `game` / `event`, and runs each script body. A script
 *   changes the world by awaiting game.action(key, params), which runs the same
 *   handler and recurses the engine, so reactions cascade and the whole chain
 *   resolves inside the single triggering mutation (one broadcast).
 *
 * Authority: the engine is only ever invoked on the DM's authoritative path
 * (ActionService.executeDM), so scripts never run during a player's optimistic
 * pass. There is no sandbox: `this`, `game`, `event`, and everything reachable
 * from them are the real campaign objects, which is what makes reading any field
 * (including ones added to the model later) free, with zero engine changes.
 */
import type { Campaign } from "../../domains/Campaign/Campaign";
import type { Context } from "../../domains/Context/Context";
import type { Actor } from "../../domains/Actor/Actor";
import type { Script, ScriptParam, ScriptValue, ScriptVars } from "../../domains/Script/Script";
import { ACTION_REGISTRY, isScriptableAction } from "../Actions/ActionRegistry";
import { CampaignActions } from "../../domains/Campaign/CampaignActions";
import { LogActions } from "../../domains/Log/LogActions";
import { rollDiceFormula } from "../../utils/DiceUtils";
import { validateScriptSource } from "./scriptValidation";
import { SCRIPT_BUDGETS, SCRIPTING_DISABLED_SETTING } from "./scriptConstants";

type AsyncFunctionConstructor = new (
	...args: string[]
) => (...args: any[]) => Promise<unknown>;

const AsyncFunction = (async function () {}).constructor as AsyncFunctionConstructor;

// ---- Glob matching (action keys, names) -------------------------------------

const globCache = new Map<string, RegExp>();
function globToRegExp(glob: string): RegExp {
	let re = globCache.get(glob);
	if (!re) {
		const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
		re = new RegExp("^" + escaped + "$", "i");
		globCache.set(glob, re);
	}
	return re;
}
function globMatches(glob: string, value: string): boolean {
	return globToRegExp(glob).test(value);
}

// ---- Campaign reads ---------------------------------------------------------

/** Every active actor (characters + entities) — scripts and triggers see these. */
function activeActors(campaign: Campaign): Actor[] {
	return [...campaign.GameState.Characters, ...campaign.GameState.Entities];
}

function isActorActive(campaign: Campaign, actor: Actor): boolean {
	return activeActors(campaign).some((a) => a.Id === actor.Id);
}

/** Campaign template collections a script can resolve a template by name from. */
type TemplateCollection =
	| "EntityTemplates"
	| "ItemTemplates"
	| "SkillTemplates"
	| "StatusTemplates"
	| "CharacterRoster";

function resolveTemplate(
	campaign: Campaign,
	collection: TemplateCollection,
	nameOrGlob: string
): { Id: string; Name: string } | undefined {
	const list = (campaign as any)[collection] as Array<{ Id: string; Name: string }>;
	if (!Array.isArray(list)) return undefined;
	const lowered = String(nameOrGlob).toLowerCase();
	const exact = list.find((t) => t.Name?.toLowerCase() === lowered);
	if (exact) return exact;
	return list.find((t) => t.Name != null && globMatches(nameOrGlob, t.Name));
}

function scriptsDisabled(context: Context): boolean {
	return context.AppSettings?.[SCRIPTING_DISABLED_SETTING] === "true";
}

// ---- `this` / vars / params facades -----------------------------------------

/** A live, lazily-created scratch object: writes land on owner.ScriptVars. */
function makeVarsProxy(owner: { ScriptVars?: ScriptVars }): ScriptVars {
	return new Proxy({} as ScriptVars, {
		get: (_t, k) => owner.ScriptVars?.[k as string],
		set: (_t, k, v) => {
			(owner.ScriptVars ??= {})[k as string] = v as ScriptValue;
			return true;
		},
		has: (_t, k) => !!owner.ScriptVars && (k as string) in owner.ScriptVars,
		deleteProperty: (_t, k) => {
			if (owner.ScriptVars) delete owner.ScriptVars[k as string];
			return true;
		},
		ownKeys: () => Reflect.ownKeys(owner.ScriptVars ?? {}),
		getOwnPropertyDescriptor: (_t, k) =>
			owner.ScriptVars && (k as string) in owner.ScriptVars
				? { enumerable: true, configurable: true, value: owner.ScriptVars[k as string] }
				: undefined,
	});
}

/** Resolve declared Parameters to their defaults: { Key: Default }. Read-only. */
function resolveParams(holder: { Parameters?: ScriptParam[] }): Record<string, ScriptValue> {
	const out: Record<string, ScriptValue> = {};
	for (const p of holder.Parameters ?? []) out[p.Key] = p.Default;
	return Object.freeze(out);
}

interface HostBinding {
	/** The object whose fields `this` reads (campaign, actor, or template). */
	raw: object;
	/** The bearer/holder actor, or undefined for campaign hosts. */
	actor?: Actor;
	/** Where declared Parameters live. */
	paramsHolder: { Parameters?: ScriptParam[] };
	/** Where `this.vars` reads/writes (actor, slot, or campaign). */
	varsOwner: { ScriptVars?: ScriptVars };
}

/**
 * Build the `this` a script runs with: a Proxy over the host's real object that
 * also exposes `vars` (mutable scratch), `params` (frozen config), and `actor`
 * (the bearer). All other reads pass through to the live object, so the model can
 * grow without touching this code.
 */
function makeThis(binding: HostBinding): any {
	const params = resolveParams(binding.paramsHolder);
	const vars = makeVarsProxy(binding.varsOwner);
	return new Proxy(binding.raw, {
		get(target, key) {
			if (key === "vars") return vars;
			if (key === "params") return params;
			if (key === "actor") return binding.actor;
			return Reflect.get(target, key);
		},
	});
}

// ---- `game` / `event` -------------------------------------------------------

function makeEvent(
	key: string,
	params: any,
	result: unknown,
	campaign: Campaign
): any {
	const actorId = params?.actorId ?? params?.entityId ?? params?.characterId;
	const actor = actorId
		? activeActors(campaign).find((a) => a.Id === actorId)
		: undefined;
	return Object.freeze({ key, params: params ?? {}, result, actor });
}

interface ScriptRunState {
	cascadeDepth: number;
	actionCount: number;
}

function createRunState(): ScriptRunState {
	return { cascadeDepth: 0, actionCount: 0 };
}

/**
 * Per-script action sink. Every `game.action`/`game.log` a single script body
 * starts is funneled through here. It does two jobs that together keep the
 * "await is optional but recommended" contract honest:
 *
 *  - SEQUENCING: actions are chained so they run in call order even when the
 *    author forgets to `await`. Without this, two un-awaited async actions race
 *    and can read-modify-write the same state out of order (lost updates).
 *  - DRAINING: every action promise is collected so `runOneScript` can await the
 *    whole batch before the mutation commits, and surface any failure the script
 *    did not await itself (instead of swallowing it). A failed action does not
 *    break the chain — later actions still run.
 *
 * The sink is created fresh per script body, so a nested cascade script gets its
 * own sink: it never chains onto (and so never deadlocks awaiting) the parent
 * action that is still running while the cascade executes.
 */
interface ScriptActionSink {
	run(start: () => Promise<void>): Promise<void>;
	/** Await every started action; throw the first rejection (or resolve clean). */
	drain(): Promise<void>;
}

function createActionSink(): ScriptActionSink {
	const all: Promise<void>[] = [];
	let tail: Promise<void> = Promise.resolve();
	return {
		run(start) {
			const promise = tail.then(start);
			tail = promise.catch(() => {});
			all.push(promise);
			return promise;
		},
		async drain() {
			const settled = await Promise.allSettled(all);
			const failed = settled.find((s) => s.status === "rejected");
			if (failed) throw (failed as PromiseRejectedResult).reason;
		},
	};
}

function makeGame(context: Context, state: ScriptRunState, sink: ScriptActionSink): any {
	const campaign = () => CampaignActions.getActiveCampaign(context);
	return {
		get campaign() {
			return campaign();
		},
		get combat() {
			return campaign().GameState.CombatState;
		},
		actors: () => activeActors(campaign()),
		find: (glob: string) =>
			activeActors(campaign()).find((a) => globMatches(glob, a.Name)),
		template: (collection: TemplateCollection, name: string) =>
			resolveTemplate(campaign(), collection, name),
		roll: (expr: string) => rollDiceFormula(expr).total,
		rng: () => Math.random(),
		log: (text: string, opts?: { category?: string; level?: string; details?: string }) =>
			sink.run(() =>
				dispatch(
					"log:create",
					{
						action: text,
						details: opts?.details,
						category: opts?.category ?? "system",
						level: opts?.level ?? "info",
					},
					context,
					state
				)
			),
		action: (key: string, params?: any) =>
			sink.run(() => dispatch(key, params ?? {}, context, state)),
	};
}

// ---- Cascade state ----------------------------------------------------------
/**
 * Hosts that matched the top-level action's trigger BEFORE it ran. ActionService
 * passes this snapshot back to onAction so a script on a thing the action then
 * removed (e.g. a status's onRemove cleanup) still has a host to bind.
 */
type ScriptActionSnapshot = ScriptMatch[];

/** The mutation channel exposed to scripts as game.action -- awaits + cascades. */
async function dispatch(
	key: string,
	params: any,
	context: Context,
	state: ScriptRunState
): Promise<void> {
	const action = ACTION_REGISTRY[key];
	if (!action || !isScriptableAction(key)) {
		throw new Error(`Action "${key}" is not allowed in scripts.`);
	}
	if (state.actionCount >= SCRIPT_BUDGETS.MAX_TOTAL_ACTIONS) {
		throw new Error(
			`Script action budget exceeded (${SCRIPT_BUDGETS.MAX_TOTAL_ACTIONS}); cascade halted.`
		);
	}
	state.actionCount++;
	// Capture hosts before the action so a removal still has a host to react with.
	const pre = collectMatches(CampaignActions.getActiveCampaign(context), key);
	// Run the SAME handler the app uses against the live campaign.
	await action.handler(params, context);
	// React to what this action just did (the cascade).
	await runReactions(key, params, undefined, context, pre, state);
}

// ---- Host enumeration -------------------------------------------------------

interface ScriptMatch extends HostBinding {
	script: Script;
	/**
	 * Stable LOGICAL identity of the host (not object identity). Used to dedupe
	 * pre- and post-action hosts: an action that rebuilds a slot object (e.g.
	 * combat:incrementRound remaps Statuses to decrement durations) keeps the same
	 * hostKey, so the script still runs exactly once. A truly removed host's
	 * hostKey is absent post-action, so its onRemove script runs once.
	 */
	hostKey: string;
}

function pushMatches(
	out: ScriptMatch[],
	scripts: Script[] | undefined,
	key: string,
	binding: HostBinding,
	hostKey: string
): void {
	if (!scripts) return;
	for (const script of scripts) {
		if (script.Enabled === false) continue;
		if (!globMatches(script.Trigger, key)) continue;
		out.push({ ...binding, script, hostKey });
	}
}

function collectSlotMatches(
	out: ScriptMatch[],
	key: string,
	actor: Actor,
	collection: string,
	slots: Array<{ Id: string; ScriptVars?: ScriptVars }> | undefined,
	templates: Array<{ Id: string; Scripts?: Script[]; Parameters?: ScriptParam[] }>
): void {
	if (!slots) return;
	// Occurrence index per templateId, so two slots sharing a template get
	// distinct, stable host keys regardless of object identity.
	const occurrence = new Map<string, number>();
	for (const slot of slots) {
		const n = occurrence.get(slot.Id) ?? 0;
		occurrence.set(slot.Id, n + 1);
		const template = templates.find((t) => t.Id === slot.Id);
		if (!template?.Scripts?.length) continue;
		pushMatches(
			out,
			template.Scripts,
			key,
			{ raw: template, actor, paramsHolder: template, varsOwner: slot },
			`slot:${actor.Id}:${collection}:${slot.Id}:${n}`
		);
	}
}

/** Every (script, host) whose Trigger matches `key`, in deterministic order. */
function collectMatches(campaign: Campaign, key: string): ScriptMatch[] {
	const out: ScriptMatch[] = [];
	// Campaign-level world rules.
	pushMatches(
		out,
		campaign.Scripts,
		key,
		{ raw: campaign, paramsHolder: campaign, varsOwner: campaign },
		"campaign"
	);
	// Actors and their template-backed slots.
	for (const actor of activeActors(campaign)) {
		pushMatches(
			out,
			actor.Scripts,
			key,
			{ raw: actor, actor, paramsHolder: actor, varsOwner: actor },
			`actor:${actor.Id}`
		);
		collectSlotMatches(out, key, actor, "Statuses", actor.Statuses, campaign.StatusTemplates);
		collectSlotMatches(out, key, actor, "Inventory", actor.Inventory, campaign.ItemTemplates);
		collectSlotMatches(out, key, actor, "Equipment", actor.Equipment, campaign.ItemTemplates);
		collectSlotMatches(out, key, actor, "Skills", actor.Skills, campaign.SkillTemplates);
	}
	return out;
}

// ---- Running ----------------------------------------------------------------

function logScriptError(context: Context, script: Script, err: unknown): void {
	const label = script.Name ? ` "${script.Name}"` : "";
	// Logged directly (NOT via game.action) so an error never cascades.
	try {
		LogActions.create(
			{
				action: `Script error${label} (trigger ${script.Trigger})`,
				details: String((err as any)?.message ?? err),
				category: "system",
				level: "important",
				visibility: ["dm"],
			},
			context
		);
	} catch {
		/* logging must never throw out of the engine */
	}
	console.error("[Scripting] script failed:", script.Name ?? script.Trigger, err);
}

async function runOneScript(
	match: ScriptMatch,
	event: any,
	context: Context,
	campaign: Campaign,
	state: ScriptRunState
): Promise<void> {
	const { script } = match;
	// A host removed by an earlier script in this same pass: skip it.
	if (match.actor && !isActorActive(campaign, match.actor)) return;
	const validation = validateScriptSource(script.Code);
	if (!validation.ok) {
		logScriptError(context, script, validation.error);
		return;
	}
	const sink = createActionSink();
	const game = makeGame(context, state, sink);
	try {
		const thisHost = makeThis(match);
		// eslint-disable-next-line no-new-func
		const fn = new AsyncFunction("game", "event", '"use strict";\n' + script.Code);
		await fn.call(thisHost, game, event);
		// Finish (and surface failures from) any actions the script started but
		// did not await, before this mutation commits/broadcasts.
		await sink.drain();
	} catch (err) {
		logScriptError(context, script, err);
	}
}

async function runReactions(
	key: string,
	params: any,
	result: unknown,
	context: Context,
	pre: ScriptMatch[],
	state: ScriptRunState
): Promise<void> {
	if (state.cascadeDepth >= SCRIPT_BUDGETS.MAX_CASCADE_DEPTH) {
		console.warn(
			`[Scripting] cascade depth cap (${SCRIPT_BUDGETS.MAX_CASCADE_DEPTH}) reached; not reacting to "${key}".`
		);
		return;
	}
	state.cascadeDepth++;
	try {
		const campaign = CampaignActions.getActiveCampaign(context);
		// Current hosts run once each (keyed by logical identity, so a slot the
		// action rebuilt is NOT double-counted). Then add only pre-action hosts the
		// action genuinely removed, so onRemove cleanup still fires exactly once.
		const post = collectMatches(campaign, key);
		let matches = post;
		if (pre.length) {
			const postKeys = new Set(post.map((m) => m.hostKey));
			const removed = pre.filter((m) => !postKeys.has(m.hostKey));
			if (removed.length) matches = [...post, ...removed];
		}
		if (matches.length === 0) return;
		const event = makeEvent(key, params, result, campaign);
		for (const match of matches) {
			await runOneScript(match, event, context, campaign, state);
		}
	} finally {
		state.cascadeDepth--;
	}
}

// ---- Test harness support ---------------------------------------------------

/** Identifies which host a test script runs as (`this`). */
export type ScriptHostSelection =
	| { kind: "campaign" }
	| { kind: "actor"; actorId: string }
	| {
			kind: "slot";
			actorId: string;
			collection: "Statuses" | "Inventory" | "Equipment" | "Skills";
			index: number;
	  };

function templatesForCollection(
	campaign: Campaign,
	collection: "Statuses" | "Inventory" | "Equipment" | "Skills"
): Array<{ Id: string; Scripts?: Script[]; Parameters?: ScriptParam[] }> {
	if (collection === "Statuses") return campaign.StatusTemplates;
	if (collection === "Skills") return campaign.SkillTemplates;
	return campaign.ItemTemplates; // Inventory + Equipment
}

function bindingForSelection(
	campaign: Campaign,
	sel: ScriptHostSelection
): HostBinding | null {
	if (sel.kind === "campaign") {
		return { raw: campaign, paramsHolder: campaign, varsOwner: campaign };
	}
	const actor = activeActors(campaign).find((a) => a.Id === sel.actorId);
	if (!actor) return null;
	if (sel.kind === "actor") {
		return { raw: actor, actor, paramsHolder: actor, varsOwner: actor };
	}
	const slots = (actor as any)[sel.collection] as
		| Array<{ Id: string; ScriptVars?: ScriptVars }>
		| undefined;
	const slot = slots?.[sel.index];
	if (!slot) return null;
	const template = templatesForCollection(campaign, sel.collection).find(
		(t) => t.Id === slot.Id
	);
	if (!template) return null;
	return { raw: template, actor, paramsHolder: template, varsOwner: slot };
}

// ---- Public API -------------------------------------------------------------

export const ScriptEngine = {
	/**
	 * Called by ActionService BEFORE a domain action runs, to snapshot the hosts
	 * that match its trigger, so a script on something the action then removes
	 * (a status's onRemove cleanup) still has a host. Pass the returned snapshot
	 * to onAction after the domain action completes.
	 */
	beginAction(key: string, context: Context): ScriptActionSnapshot {
		return scriptsDisabled(context)
			? []
			: collectMatches(CampaignActions.getActiveCampaign(context), key);
	},

	/**
	 * Called by ActionService on the DM's authoritative path, after a domain action
	 * has mutated the campaign and before it is committed/broadcast. Runs every
	 * script reacting to `key` and the entire cascade it triggers, inside the
	 * current mutation. No-op when scripting is globally disabled.
	 */
	async onAction(
		key: string,
		params: any,
		result: unknown,
		context: Context,
		pre: ScriptActionSnapshot
	): Promise<void> {
		if (scriptsDisabled(context)) return;
		await runReactions(key, params, result, context, pre, createRunState());
	},

	/**
	 * Test-harness entry: run ONE pasted script as the chosen host against the
	 * campaign in `context` (the harness passes a throwaway context whose
	 * ActiveCampaign is a clone, so the live game is untouched). The script's
	 * game.action(...) calls still cascade through scripts saved on the clone.
	 */
	async runForTest(opts: {
		context: Context;
		host: ScriptHostSelection;
		code: string;
		triggerKey: string;
		params?: any;
	}): Promise<{ ok: boolean; error?: string }> {
		const { context, host, code, triggerKey, params } = opts;
		const campaign = CampaignActions.getActiveCampaign(context);
		const binding = bindingForSelection(campaign, host);
		if (!binding) return { ok: false, error: "Selected host not found in campaign." };
		const validation = validateScriptSource(code);
		if (!validation.ok) return { ok: false, error: validation.error };
		const state = createRunState();
		const sink = createActionSink();
		const game = makeGame(context, state, sink);
		const event = makeEvent(triggerKey, params ?? {}, undefined, campaign);
		try {
			const thisHost = makeThis(binding);
			// eslint-disable-next-line no-new-func
			const fn = new AsyncFunction("game", "event", '"use strict";\n' + code);
			await fn.call(thisHost, game, event);
			// Finish (and surface failures from) any actions the script did not await.
			await sink.drain();
			return { ok: true };
		} catch (err) {
			return { ok: false, error: String((err as any)?.message ?? err) };
		}
	},
};
