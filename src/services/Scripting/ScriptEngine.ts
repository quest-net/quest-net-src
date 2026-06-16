/**
 * Script engine (v2 — action-driven ECA rules).
 *
 * Replaces the v1 QuickJS sandbox + snapshot-diffing dispatcher with a tiny,
 * self-contained reactor over LIVE objects:
 *
 *   ActionService runs a domain action → calls ScriptEngine.onAction(...) →
 *   the engine finds every enabled script whose Trigger glob matches the action
 *   key, binds `this` / `game` / `event`, and runs each script body. A script
 *   changes the world ONLY by calling game.action(key, params), which runs the
 *   same handler inline and recurses the engine — so reactions cascade, and the
 *   whole chain resolves inside the single triggering mutation (one broadcast).
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

function makeGame(context: Context): any {
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
			dispatch(
				"log:create",
				{
					action: text,
					details: opts?.details,
					category: opts?.category ?? "system",
					level: opts?.level ?? "info",
				},
				context
			),
		action: (key: string, params?: any) => dispatch(key, params ?? {}, context),
	};
}

// ---- Cascade state ----------------------------------------------------------

let cascadeDepth = 0;
let actionCount = 0;
/**
 * Hosts that matched the top-level action's trigger BEFORE it ran — captured by
 * beginAction (ActionService) so a script on a thing the action then REMOVED
 * (e.g. a status's onRemove cleanup) still has a host to bind. Consumed by the
 * next onAction. Cascade actions capture their own pre-set locally in dispatch().
 */
let topPre: ScriptMatch[] = [];

/** The mutation channel exposed to scripts as game.action — runs inline + cascades. */
function dispatch(key: string, params: any, context: Context): void {
	if (!isScriptableAction(key)) {
		throw new Error(`Action "${key}" is not allowed in scripts.`);
	}
	if (actionCount >= SCRIPT_BUDGETS.MAX_TOTAL_ACTIONS) {
		throw new Error(
			`Script action budget exceeded (${SCRIPT_BUDGETS.MAX_TOTAL_ACTIONS}); cascade halted.`
		);
	}
	actionCount++;
	// Capture hosts before the action so a removal still has a host to react with.
	const pre = collectMatches(CampaignActions.getActiveCampaign(context), key);
	// Run the SAME handler the app uses, inline against the live campaign.
	ACTION_REGISTRY[key].handler(params, context);
	// React to what this action just did (the cascade).
	runReactions(key, params, undefined, context, pre);
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

function runOneScript(
	match: ScriptMatch,
	game: any,
	event: any,
	context: Context,
	campaign: Campaign
): void {
	const { script } = match;
	// A host removed by an earlier script in this same pass: skip it.
	if (match.actor && !isActorActive(campaign, match.actor)) return;
	const validation = validateScriptSource(script.Code);
	if (!validation.ok) {
		logScriptError(context, script, validation.error);
		return;
	}
	try {
		const thisHost = makeThis(match);
		// eslint-disable-next-line no-new-func
		const fn = new Function("game", "event", '"use strict";\n' + script.Code);
		fn.call(thisHost, game, event);
	} catch (err) {
		logScriptError(context, script, err);
	}
}

function runReactions(
	key: string,
	params: any,
	result: unknown,
	context: Context,
	pre: ScriptMatch[]
): void {
	if (cascadeDepth >= SCRIPT_BUDGETS.MAX_CASCADE_DEPTH) {
		console.warn(
			`[Scripting] cascade depth cap (${SCRIPT_BUDGETS.MAX_CASCADE_DEPTH}) reached; not reacting to "${key}".`
		);
		return;
	}
	cascadeDepth++;
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
		const game = makeGame(context);
		const event = makeEvent(key, params, result, campaign);
		for (const match of matches) {
			runOneScript(match, game, event, context, campaign);
		}
	} finally {
		cascadeDepth--;
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
	 * that match its trigger — so a script on something the action then removes
	 * (a status's onRemove cleanup) still has a host. Paired with onAction.
	 */
	beginAction(key: string, context: Context): void {
		topPre = scriptsDisabled(context)
			? []
			: collectMatches(CampaignActions.getActiveCampaign(context), key);
	},

	/**
	 * Called by ActionService on the DM's authoritative path, after a domain action
	 * has mutated the campaign and before it is committed/broadcast. Runs every
	 * script reacting to `key` and the entire cascade it triggers, inside the
	 * current mutation. No-op when scripting is globally disabled.
	 */
	onAction(key: string, params: any, result: unknown, context: Context): void {
		const pre = topPre;
		topPre = [];
		if (scriptsDisabled(context)) return;
		// Top-level entry: reset the per-mutation action budget. (cascadeDepth is 0.)
		actionCount = 0;
		runReactions(key, params, result, context, pre);
	},

	/**
	 * Test-harness entry: run ONE pasted script as the chosen host against the
	 * campaign in `context` (the harness passes a throwaway context whose
	 * ActiveCampaign is a clone, so the live game is untouched). The script's
	 * game.action(...) calls still cascade through scripts saved on the clone.
	 */
	runForTest(opts: {
		context: Context;
		host: ScriptHostSelection;
		code: string;
		triggerKey: string;
		params?: any;
	}): { ok: boolean; error?: string } {
		const { context, host, code, triggerKey, params } = opts;
		const campaign = CampaignActions.getActiveCampaign(context);
		const binding = bindingForSelection(campaign, host);
		if (!binding) return { ok: false, error: "Selected host not found in campaign." };
		const validation = validateScriptSource(code);
		if (!validation.ok) return { ok: false, error: validation.error };
		actionCount = 0;
		const game = makeGame(context);
		const event = makeEvent(triggerKey, params ?? {}, undefined, campaign);
		try {
			const thisHost = makeThis(binding);
			// eslint-disable-next-line no-new-func
			const fn = new Function("game", "event", '"use strict";\n' + code);
			fn.call(thisHost, game, event);
			return { ok: true };
		} catch (err) {
			return { ok: false, error: String((err as any)?.message ?? err) };
		}
	},
};
