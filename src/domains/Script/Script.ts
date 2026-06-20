/**
 * Scripting system data model (v2 — action-driven ECA rules).
 *
 * A script is a small piece of JS authored by the DM (in practice, by an AI agent
 * on their behalf) and attached to a campaign object to add a custom behavior. It
 * runs ONLY on the DM (the authority), and is an Event-Condition-Action rule:
 *
 *   - Event     : a domain action was dispatched (matched by an action-key glob).
 *   - Condition : whatever the Code chooses to check (it reads the live campaign).
 *   - Action    : the Code awaits game.action(key, params) — the SAME handlers
 *                 the app uses — which is the only sanctioned way to change the world.
 *
 * There is no sandbox and no marshaling: inside a script, `this`, `game`, and
 * `event` are real live objects, so reading any field/collection — including ones
 * added to the campaign in the future — is plain property access. The engine
 * never needs to change as the model grows; reach is bounded only by which
 * actions are script-ok (see isScriptableAction in ActionRegistry).
 */

/** A single behavior rule attached to a host object (campaign / actor / template). */
export interface Script {
	/**
	 * Action-key glob that triggers this script. Matched against the key of every
	 * dispatched action. Examples: "actor:move", "*:move", "item:use",
	 * "combat:incrementRound", "*". Only `*` is special; everything else is literal.
	 */
	Trigger: string;
	/**
	 * The script body. Evaluated as a function body with `game` and `event` as
	 * arguments and `this` bound to the host. May `return` early to bail.
	 */
	Code: string;
	/** Optional DM/AI-facing label. */
	Name?: string;
	/** Defaults to true; set false to keep a script attached but inert. */
	Enabled?: boolean;
	/**
	 * Phase relative to the triggering action. Defaults to "after" (a reaction:
	 * the action has already mutated the world and the script reacts by dispatching
	 * more actions). "before" runs the script BEFORE the domain handler, with a
	 * mutable `event.params` it may rewrite and an `event.cancel()` it may call to
	 * prevent the action entirely. Absent === "after", so existing scripts are
	 * unchanged.
	 */
	When?: "before" | "after";
}

/** JSON-ish primitive that a script param/var may hold. */
export type ScriptValue = string | number | boolean | null;

/**
 * A DM-tunable, typed input the author declares so a DM can adjust a behavior
 * WITHOUT reading the code. Read in scripts as `this.params.<Key>`. `Type` drives
 * which input renders (and can reuse existing pickers).
 */
export interface ScriptParam {
	/** Identifier used in the script: this.params.<Key>. */
	Key: string;
	/** DM-facing name. */
	Label: string;
	/** Drives which input renders. Extensible. */
	Type: "number" | "boolean" | "text" | "select" | "statRef" | "color";
	Default: ScriptValue;
	// number
	Min?: number;
	Max?: number;
	// select
	Options?: { value: string; label: string }[];
}

/**
 * Per-instance runtime SCRATCH a script reads/writes (counters, stacks remaining,
 * countdowns). Lives on the host (actor, slot, or campaign) and syncs as ordinary
 * campaign state. In a script it is `this.vars` — a real mutable object, so direct
 * assignment (`this.vars.x = 1`) persists. Distinct from Parameters: vars are
 * untyped and never surfaced as config.
 */
export type ScriptVars = Record<string, ScriptValue>;
