/**
 * Scripting API documentation model — the SINGLE SOURCE OF TRUTH for the
 * structured, prose-bearing parts of the scripting reference.
 *
 * Both the in-app wiki page (`src/wiki/pages/Scripting.tsx`) and the downloadable
 * AI-authoring brief (`generateScriptingDoc.ts`) render from this module, so the
 * enumerable reference content (per-action trigger explanations, the facade/helper
 * surface, the limits, and the output format) never drifts between the two.
 *
 * What lives here vs. what is derived at runtime:
 *   - Runtime-derived elsewhere (NOT here): the action keys/roles/scriptable flag
 *     (`ACTION_REGISTRY`), cascade budgets (`SCRIPT_BUDGETS`), forbidden tokens
 *     (`FORBIDDEN_TOKENS`), and the campaign/log dump.
 *   - Authored here: the per-action "when it fires" prose, the facade method
 *     reference, the curated "cannot do" list, and the JSON-envelope spec — none of
 *     which survive to runtime as structured data (they're TS interfaces / JSDoc).
 *
 * DRIFT GUARD: `ACTION_DOCS` must have exactly one entry per `ACTION_REGISTRY` key.
 * There is no test runner in this project, so the guard is `validateActionDocs()`,
 * called in dev from the generator (and the wiki), plus the generator marks any
 * undocumented key inline. Adding an action without documenting it is loud.
 */

import { ACTION_REGISTRY } from "../../Actions/ActionRegistry";

// ---------------------------------------------------------------------------
// Per-action trigger reference
// ---------------------------------------------------------------------------

/** Documentation for one action, as both a trigger and (if scriptable) a call. */
export interface ActionDoc {
	/** When this action is dispatched — i.e. when a script with this Trigger runs. */
	whenFires: string;
	/** Optional note about the action's params (only useful detail; keep terse). */
	paramsNote?: string;
}

/**
 * One entry per key in `ACTION_REGISTRY`. Keep keys in sync with the registry —
 * `validateActionDocs()` enforces this at dev time.
 */
export const ACTION_DOCS: Record<string, ActionDoc> = {
	// Campaign
	"campaign:edit": {
		whenFires: "The whole campaign object is replaced (structural). Not scriptable.",
	},

	// Character
	"character:create": {
		whenFires: "A new character is created and added to the roster (not yet on the field).",
	},
	"character:spawn": {
		whenFires: "A roster character is placed onto the field (becomes active).",
	},
	"character:createAndSpawn": {
		whenFires: "A character is created and immediately placed onto the field.",
	},

	// Actor (unified surface over characters + entities)
	"actor:move": {
		whenFires: "An active actor changes position (teleport or movement).",
		paramsNote: "params.actorId is the mover; params.position is the destination.",
	},
	"actor:spawn": {
		whenFires: "An actor is placed onto the field (character from roster, or entity cloned from a template).",
	},
	"actor:despawn": {
		whenFires: "An active actor leaves the field (character back to roster, entity deleted).",
	},
	"actor:edit": {
		whenFires:
			"Any actor field is written — INCLUDING stat changes, since changeStat/setStat route through actor:edit. The catch-all for actor mutation.",
		paramsNote: "params.actorId + params.updates (a partial actor). There is no stat-specific trigger.",
	},
	"actor:delete": {
		whenFires: "An actor is deleted from the roster/templates (not the field). Not scriptable.",
	},
	"actor:bulkEditTags": {
		whenFires: "Tags are added/removed across one or more actors in a batch.",
	},
	"actor:bulkDelete": {
		whenFires: "Multiple actors are deleted from the roster/templates in a batch (not the field). Not scriptable.",
	},
	"actor:transferStat": {
		whenFires: "A stat amount is moved from one actor to another (clamped 0..Max).",
	},

	// Dice
	"dice:roll": {
		whenFires:
			"An OBSERVABLE roll is made via actor.roll(...) — the cascade carrier other scripts react to. game.roll(...) is silent and does NOT fire this.",
		paramsNote: "The result rides in event.params.total (event.result is dead in cascades).",
	},

	// Item
	"item:use": {
		whenFires: "An actor uses an item (consumes a charge / triggers its effect).",
		paramsNote: "params.actorId + params.itemId. A before-script may set params.diceFormula.",
	},
	"item:equip": { whenFires: "An actor equips an item from inventory." },
	"item:unequip": { whenFires: "An actor unequips an item back to inventory." },
	"item:discard": { whenFires: "One copy of an item is removed from an actor's inventory." },
	"item:give": { whenFires: "An item is added to an actor's inventory (from a template)." },
	"item:transfer": { whenFires: "An item is moved from one actor to another." },
	"item:create": { whenFires: "A new item template is created." },
	"item:edit": { whenFires: "An item template's fields are edited." },
	"item:delete": { whenFires: "An item template is deleted. Not scriptable." },
	"item:adjustUses": { whenFires: "An item slot's remaining uses are set to an absolute value." },
	"item:drop": { whenFires: "An item is dropped onto the terrain at a position." },
	"item:pickup": { whenFires: "An item is picked up from the terrain by an actor." },
	"item:spawn": { whenFires: "An item is placed onto the terrain (loot drop) from a template." },
	"item:bulkEditTags": { whenFires: "Tags are batch-edited across item templates." },
	"item:bulkDelete": { whenFires: "Multiple item templates are deleted in a batch. Not scriptable." },

	// Shared inventory
	"sharedInventory:transferItem": {
		whenFires: "An item is moved out of a shared pool to an actor or another pool.",
	},
	"sharedInventory:discardItem": { whenFires: "An item is removed from a shared pool." },
	"sharedInventory:transferStat": {
		whenFires: "A pooled stat amount is moved from a shared pool to an actor or another pool.",
	},
	"sharedInventory:editStat": {
		whenFires: "A shared pool's stat is changed (changeStat/setStat route here; clamped in the facade).",
	},

	// Skill
	"skill:create": { whenFires: "A new skill template is created." },
	"skill:edit": { whenFires: "A skill template's fields are edited." },
	"skill:delete": { whenFires: "A skill template is deleted. Not scriptable." },
	"skill:use": {
		whenFires: "An actor uses a skill (pays its cost, triggers its effect).",
		paramsNote: "params.actorId + params.skillId. A before-script may set params.diceFormula.",
	},
	"skill:discard": { whenFires: "A skill is removed from an actor." },
	"skill:give": { whenFires: "A skill is added to an actor (from a template)." },
	"skill:bulkEditTags": { whenFires: "Tags are batch-edited across skill templates." },
	"skill:bulkDelete": { whenFires: "Multiple skill templates are deleted in a batch. Not scriptable." },
	"skill:adjustUses": { whenFires: "A skill slot's remaining uses are set to an absolute value." },

	// Entity
	"entity:create": { whenFires: "A new entity (NPC/enemy) template is created." },
	"entity:spawn": { whenFires: "An entity is cloned from a template onto the field." },

	// Combat
	"combat:start": { whenFires: "Combat begins (a starting side is chosen)." },
	"combat:end": { whenFires: "Combat ends and characters are restored." },
	"combat:incrementRound": {
		whenFires: "A new combat round begins (the round tick). Carries no actor — each bearer's this.actor is itself.",
	},
	"combat:decrementRound": { whenFires: "The combat round counter is stepped back." },
	"combat:markActorTurnDone": { whenFires: "An actor's turn is toggled done/undone for the round." },

	// Audio
	"audio:create": { whenFires: "A new audio track is added. Not scriptable." },
	"audio:importPlaylistByIds": { whenFires: "A playlist is imported by id. Not scriptable." },
	"audio:edit": { whenFires: "An audio track's metadata is edited." },
	"audio:delete": { whenFires: "An audio track is deleted. Not scriptable." },
	"audio:setTrack": { whenFires: "The current background track is set / changed." },
	"audio:setVolume": { whenFires: "The audio volume is changed (clamped 0..1)." },
	"audio:stopTrack": { whenFires: "Playback is stopped." },
	"audio:bulkEditTags": { whenFires: "Tags are batch-edited across audio tracks." },

	// Scene / image
	"scene:setEnvironmentImage": { whenFires: "The scene's background/environment image is set (or cleared)." },
	"scene:setFocusImage": { whenFires: "The scene's focus/detail image is set (or cleared)." },
	"image:create": { whenFires: "An image is added to the campaign." },
	"image:bulkCreate": { whenFires: "Multiple images are added at once." },
	"image:edit": { whenFires: "An image's metadata is edited." },
	"image:delete": { whenFires: "An image is deleted. Not scriptable." },
	"image:bulkEditTags": { whenFires: "Tags are batch-edited across images." },
	"image:bulkDelete": { whenFires: "Multiple images are deleted in a batch. Not scriptable." },
	"image:reassignOwner": { whenFires: "An image's owner is reassigned." },

	// Status
	"status:give": { whenFires: "A status is applied to an actor (optionally with a count)." },
	"status:remove": { whenFires: "One copy of a status is removed from an actor." },
	"status:create": { whenFires: "A new status template is created." },
	"status:edit": { whenFires: "A status template's fields are edited." },
	"status:delete": { whenFires: "A status template is deleted. Not scriptable." },
	"status:adjustDuration": { whenFires: "A status slot's remaining duration is set to an absolute value." },
	"status:bulkEditTags": { whenFires: "Tags are batch-edited across status templates." },
	"status:bulkDelete": { whenFires: "Multiple status templates are deleted in a batch. Not scriptable." },

	// Log
	"log:create": { whenFires: "A log entry is created with full metadata (category/level/visibility)." },
	"log:log": { whenFires: "A quick log entry is created (the shorthand used by game.log)." },

	// Ping / sticker
	"ping:create": { whenFires: "A transient ping marker is flashed on the map at a position." },
	"sticker:create": { whenFires: "An emoji sticker is placed on a terrain surface." },

	// Note
	"note:create": { whenFires: "A player creates a private character note." },
	"note:edit": { whenFires: "A player edits a private character note." },
	"note:delete": { whenFires: "A player deletes a private character note. Not scriptable." },

	// Setting
	"setting:edit": { whenFires: "Campaign settings/rules are edited." },

	// Calendar
	"calendar:edit": { whenFires: "The in-world calendar/day is changed (advanceDays/setDay/setDate route here)." },
	"calendar:shortRest": { whenFires: "The party takes a short rest (rest-recovery rules apply)." },
	"calendar:longRest": { whenFires: "The party takes a long rest (rest-recovery rules apply)." },

	// Terrain
	"terrain:create": { whenFires: "A new voxel terrain is created. Not scriptable." },
	"terrain:edit": { whenFires: "A terrain's voxels are edited." },
	"terrain:delete": { whenFires: "A terrain is deleted (cascades to its links). Not scriptable." },
	"terrain:moveActors": { whenFires: "Multiple actors are moved on a terrain in one batch." },
	"terrain:bulkEditTags": { whenFires: "Tags are batch-edited across terrains." },

	// Terrain links
	"terrainLink:create": { whenFires: "A portal/link between two tiles (or terrains) is created." },
	"terrainLink:edit": { whenFires: "A terrain link is edited." },
	"terrainLink:delete": { whenFires: "A terrain link is deleted. Not scriptable." },

	// Scenario
	"scenario:capture": { whenFires: "The current game state is saved as a scenario." },
	"scenario:load": { whenFires: "A saved scenario is loaded over the current state." },
	"scenario:delete": { whenFires: "A scenario is deleted. Not scriptable." },
	"scenario:edit": { whenFires: "A scenario's metadata is edited." },
	"scenario:bulkEditTags": { whenFires: "Tags are batch-edited across scenarios." },
};

/**
 * Dev-time drift guard. Returns the keys that are out of sync between
 * `ACTION_REGISTRY` and `ACTION_DOCS`. Empty arrays = in sync.
 */
export function diffActionDocs(): { missing: string[]; stale: string[] } {
	const registryKeys = new Set(Object.keys(ACTION_REGISTRY));
	const docKeys = new Set(Object.keys(ACTION_DOCS));
	const missing = [...registryKeys].filter((k) => !docKeys.has(k)).sort();
	const stale = [...docKeys].filter((k) => !registryKeys.has(k)).sort();
	return { missing, stale };
}

/**
 * Logs a loud warning in dev if `ACTION_DOCS` and `ACTION_REGISTRY` have drifted.
 * Safe to call from anywhere that renders the docs; no-op when in sync.
 */
export function validateActionDocs(): void {
	const { missing, stale } = diffActionDocs();
	if (missing.length === 0 && stale.length === 0) return;
	// eslint-disable-next-line no-console
	console.warn(
		"[scriptingApiModel] ACTION_DOCS is out of sync with ACTION_REGISTRY.\n" +
			(missing.length ? `  Missing docs for: ${missing.join(", ")}\n` : "") +
			(stale.length ? `  Stale docs (no such action): ${stale.join(", ")}\n` : "")
	);
}

// ---------------------------------------------------------------------------
// Facade / helper reference (the curated scripting surface)
// ---------------------------------------------------------------------------

export interface FacadeMethodDoc {
	/** The call signature as written in a script. */
	signature: string;
	/** What it does. */
	description: string;
	/** Backing action key (mutations) or "read" (pure read), for transparency. */
	backedBy?: string;
}

export interface FacadeGroupDoc {
	/** Group heading, e.g. "Actor facade". */
	title: string;
	/** One-line intro for the group. */
	intro: string;
	methods: FacadeMethodDoc[];
}

/**
 * The curated facade surface, grouped by the object it hangs off. This is the
 * preferred API — name-or-id everywhere, no GUIDs. Anything not covered here is
 * reachable via the `game.action(key, params)` escape hatch (scriptable keys only).
 */
export const FACADE_DOCS: FacadeGroupDoc[] = [
	{
		title: "The host (`this`)",
		intro: "Every script is bound to a host (campaign, actor, or item/status/skill template).",
		methods: [
			{ signature: "this.params.<Key>", description: "A declared Parameter resolved to its default (read-only).", backedBy: "read" },
			{ signature: "this.vars.<key>", description: "Per-instance persistent scratch — read AND write (this.vars.count = 3). Use for counters, countdowns, latches.", backedBy: "read" },
			{ signature: "this.actor", description: "The bearer/holder as an actor facade (undefined for campaign hosts). On an actor host it is the actor itself.", backedBy: "read" },
		],
	},
	{
		title: "`game` — globals & reads",
		intro: "The world handle: find things, read systems, dispatch mutations.",
		methods: [
			{ signature: "game.campaign", description: "The whole live Campaign object — read any field/collection.", backedBy: "read" },
			{ signature: 'game.find("Goblin")', description: "An active actor by name or id → actor facade (or undefined).", backedBy: "read" },
			{ signature: "game.actors() / game.party() / game.enemies()", description: "All active actors / active characters / active entities, as facades.", backedBy: "read" },
			{ signature: 'game.actorsWithStatus("Poisoned")', description: "Active actors currently carrying a status.", backedBy: "read" },
			{ signature: 'game.sharedInventory("Party Funds")', description: "A shared pool facade by name or id (or undefined). game.sharedInventories() lists all.", backedBy: "read" },
			{ signature: 'game.template(collection, "Potion")', description: 'Look up a template id/name in "items"/"skills"/"statuses"/"entities".', backedBy: "read" },
			{ signature: 'game.roll("2d6+1")', description: "Silent DM dice math → number. Emits nothing (no cascade). Use for damage/re-rolls.", backedBy: "read" },
			{ signature: "game.rng()", description: "Random number 0..1 (DM-side only).", backedBy: "read" },
			{ signature: 'await game.log("text", opts?)', description: "Quick log entry. opts: { category?, level?, details? }.", backedBy: "log:log" },
			{ signature: "await game.action(key, params)", description: "Escape hatch: dispatch ANY scriptable action directly (pass plain ids/values).", backedBy: "(any scriptable)" },
			{ signature: 'await game.spawnActor("Goblin", position?)', description: "Spawn a roster character or entity template by name onto the field.", backedBy: "actor:spawn" },
			{ signature: 'await game.spawnItem("Torch", position)', description: "Drop an item onto the terrain from a template.", backedBy: "item:spawn" },
			{ signature: "await game.ping(position)", description: "Flash a transient marker on the map (no actor; skips anti-spam cooldown).", backedBy: "ping:create" },
		],
	},
	{
		title: "Actor facade",
		intro: "this.actor, game.find(...), and event.actor are facades: live fields + these methods. Every stat/item/status arg is a name OR id.",
		methods: [
			{ signature: 'actor.getStat("HP")', description: "The stat slot, or undefined.", backedBy: "read" },
			{ signature: 'actor.getStatValue("HP")', description: "Current value → number, or null if the actor lacks the stat.", backedBy: "read" },
			{ signature: 'actor.getStatMax("HP")', description: "Max value → number, or undefined if uncapped.", backedBy: "read" },
			{ signature: 'actor.hasStat("HP") / actor.hasStatus("Stunned")', description: "Presence checks → boolean.", backedBy: "read" },
			{ signature: 'actor.getAttribute("Class")', description: "An attribute value → string, or undefined.", backedBy: "read" },
			{ signature: "actor.getKind() / isCharacter() / isEntity()", description: '"character" | "entity" and sugar booleans.', backedBy: "read" },
			{ signature: 'actor.distanceTo("Hero") / actor.isAdjacentTo("Hero")', description: "Chebyshev distance (ignores height) → number / boolean.", backedBy: "read" },
			{ signature: 'actor.getTagValue("level")', description: 'Value of a "prefix:value" tag, e.g. "7" for tag level:7 (caller does Number()).', backedBy: "read" },
			{ signature: 'actor.changeStat("HP", -5)', description: "Apply a delta to a stat, clamped 0..Max.", backedBy: "actor:edit" },
			{ signature: 'actor.setStat("HP", 10)', description: "Set a stat to an absolute value, clamped 0..Max.", backedBy: "actor:edit" },
			{ signature: 'actor.transferStatTo("Hero", "HP", 3)', description: "Move a stat amount to another actor.", backedBy: "actor:transferStat" },
			{ signature: "actor.move(position)", description: "Teleport (no pathing).", backedBy: "actor:move" },
			{ signature: "actor.edit(updates)", description: "Escape hatch: write arbitrary actor fields.", backedBy: "actor:edit" },
			{ signature: "actor.despawn()", description: "Remove from the field.", backedBy: "actor:despawn" },
			{ signature: 'actor.roll("1d20+3", opts?)', description: "OBSERVABLE roll → Promise<number>; other scripts can react. opts: { tags?, secret? }.", backedBy: "dice:roll" },
			{ signature: 'actor.giveStatus("Poisoned", count?) / removeStatus / setStatusDuration', description: "Status verbs (single target).", backedBy: "status:give / status:remove / status:adjustDuration" },
			{ signature: 'actor.giveItem("Potion", count?) / removeItem / useItem / equipItem / unequipItem / setItemUses', description: "Item verbs (single target).", backedBy: "item:give / item:discard / item:use / item:equip / item:unequip / item:adjustUses" },
			{ signature: 'actor.giveSkill("Fireball") / removeSkill / useSkill / setSkillUses', description: "Skill verbs (single target).", backedBy: "skill:give / skill:discard / skill:use / skill:adjustUses" },
		],
	},
	{
		title: "`game.combat`",
		intro: "The combat system singleton.",
		methods: [
			{ signature: "game.combat.isActive / .round / .side", description: 'boolean / 1-based round number / "party" | "enemies".', backedBy: "read" },
			{ signature: "await game.combat.start() / end()", description: "Begin / end combat.", backedBy: "combat:start / combat:end" },
			{ signature: "await game.combat.nextRound() / prevRound()", description: "Step the round counter.", backedBy: "combat:incrementRound / combat:decrementRound" },
			{ signature: 'await game.combat.markTurnDone("Goblin")', description: "Toggle an actor's turn done.", backedBy: "combat:markActorTurnDone" },
			{ signature: "game.combat.actorsThisRound()", description: "Actor facades in this round's order (full roster).", backedBy: "read" },
		],
	},
	{
		title: "`game.calendar`",
		intro: "In-world date and rests.",
		methods: [
			{ signature: "game.calendar.day / .date", description: "Absolute day counter / derived { year, month, day }.", backedBy: "read" },
			{ signature: "await game.calendar.advanceDays(1) / setDay(n) / setDate({year,month,day})", description: "Change the date.", backedBy: "calendar:edit" },
			{ signature: "await game.calendar.shortRest() / longRest()", description: "Apply rest-recovery rules.", backedBy: "calendar:shortRest / calendar:longRest" },
		],
	},
	{
		title: "`game.scene` & `game.audio`",
		intro: "Scene images and background audio.",
		methods: [
			{ signature: 'await game.scene.setEnvironment("Dungeon")', description: 'Set the background image (name or id; "" clears).', backedBy: "scene:setEnvironmentImage" },
			{ signature: 'await game.scene.setFocus("Boss Portrait")', description: 'Set the focus image ("" clears).', backedBy: "scene:setFocusImage" },
			{ signature: 'await game.audio.setTrack("Battle Theme")', description: "Set the current track (name or id).", backedBy: "audio:setTrack" },
			{ signature: "await game.audio.setVolume(0.5) / stop()", description: "Volume (0..1) / stop playback.", backedBy: "audio:setVolume / audio:stopTrack" },
			{ signature: 'game.audio.getTrack("Battle Theme")', description: "Look up a track → Audio | undefined.", backedBy: "read" },
		],
	},
	{
		title: "Shared inventory facade",
		intro: "game.sharedInventory(ref) — a party resource pool.",
		methods: [
			{ signature: 'pool.getStatValue("Gold") / getStat / getStatMax', description: "Read a pooled stat.", backedBy: "read" },
			{ signature: 'pool.hasItem("Map")', description: "Presence check → boolean.", backedBy: "read" },
			{ signature: 'await pool.changeStat("Gold", -10) / setStat', description: "Adjust a pooled stat, clamped 0..Max.", backedBy: "sharedInventory:editStat" },
			{ signature: 'await pool.transferStatTo("Hero", "Gold", 5)', description: "Move a stat to an actor OR another pool.", backedBy: "sharedInventory:transferStat" },
			{ signature: 'await pool.transferItemTo("Hero", "Map") / discardItem("Map")', description: "Move out / drop an item.", backedBy: "sharedInventory:transferItem / sharedInventory:discardItem" },
		],
	},
];

// ---------------------------------------------------------------------------
// Limits / unsupported
// ---------------------------------------------------------------------------

/**
 * Things the scripting API CANNOT do — so an AI agent can report a request as
 * unsupported instead of inventing an API. (Numeric budgets and the forbidden-token
 * list are injected at generation time from SCRIPT_BUDGETS / FORBIDDEN_TOKENS.)
 */
export const SCRIPTING_LIMITS: string[] = [
	"No waiting/timers/sleep. Model \"in N rounds\" by storing a countdown in this.vars and decrementing it from a combat:incrementRound script — \"later\" is always a future action firing.",
	"Reactions run AFTER the action. A script can announce or re-roll a result, but it cannot rewrite a decision the engine already made. To intercept BEFORE an action, use a When: \"before\" script (rewrite event.params or event.cancel()).",
	"Single-target only. Facade verbs act on one actor/item/status; apply to many with a plain loop (for (const a of game.party()) a.giveItem(\"Potion\")).",
	"No network, storage, DOM, workers, modules, or reflection (eval/Function/constructor/prototype). The validator blocks these tokens.",
	"No privileged damage()/heal(). Stats are arbitrary and campaign-defined — use changeStat/setStat against the stat by name.",
	"Only actions marked scriptable can be called. Non-scriptable actions (most deletes, campaign:edit, terrain create/delete, audio create/delete, etc.) throw if dispatched from a script.",
	"Scripts run ONLY on the DM (the authority). Never branch on randomness expecting players to recompute it; players receive the broadcast result.",
	"There is no wall-clock loop guard. while(true) hangs the tab — never write an unbounded loop. Cascade depth and total actions per mutation ARE bounded (see budgets).",
	"There is no scheduling, no cross-campaign access, and no direct file/image/terrain binary manipulation from scripts.",
];

// ---------------------------------------------------------------------------
// Output format — the `questNetScript` JSON envelope
// ---------------------------------------------------------------------------

/** Intro prose for the output-format section. */
export const SCRIPT_FORMAT_INTRO =
	"Reply with a single JSON object in the shape below (the `questNetScript` envelope), inside a ```json code block. " +
	"It maps 1:1 onto the host's Scripts / Parameters / ScriptVars, so it can be pasted back into Quest-Net wholesale. " +
	"Put a human summary in `description`; keep `Code` to the script body (no function wrapper).";

/** The canonical, copy-pasteable example envelope. */
export const SCRIPT_ENVELOPE_EXAMPLE = `{
  "questNetScript": 1,
  "host": { "type": "status", "name": "Poison" },
  "description": "Deals 'potency' damage to the bearer at the start of each combat round.",
  "parameters": [
    { "Key": "potency", "Label": "Potency", "Type": "number", "Default": 2, "Min": 0, "Max": 99 }
  ],
  "scripts": [
    {
      "Name": "Poison tick",
      "Trigger": "combat:incrementRound",
      "When": "after",
      "Enabled": true,
      "Code": "this.actor.changeStat('HP', -this.params.potency);"
    }
  ],
  "vars": {}
}`;

export interface EnvelopeFieldDoc {
	field: string;
	type: string;
	notes: string;
}

/** Field-by-field spec for the envelope. */
export const SCRIPT_ENVELOPE_FIELDS: EnvelopeFieldDoc[] = [
	{ field: "questNetScript", type: "number", notes: "Format version. Always 1." },
	{ field: "host.type", type: '"campaign" | "actor" | "item" | "status" | "skill"', notes: "Which kind of object the script attaches to." },
	{ field: "host.name", type: "string", notes: "Name (or id) of the host object; resolved at paste time. Omit for type \"campaign\"." },
	{ field: "description", type: "string", notes: "Plain-English summary of the behavior (human-facing)." },
	{ field: "parameters", type: "ScriptParam[]", notes: "DM-tunable typed config. Each: { Key, Label, Type, Default, Min?, Max?, Options? }. Type ∈ number|boolean|text|select|statRef|color. Read in code as this.params.<Key>." },
	{ field: "scripts", type: "Script[]", notes: "One or more rules. Each: { Name?, Trigger, When?, Enabled?, Code }." },
	{ field: "scripts[].Trigger", type: "string", notes: 'Action-key glob, e.g. "combat:incrementRound", "*:move", "*". Only * is special.' },
	{ field: "scripts[].When", type: '"before" | "after"', notes: 'Defaults to "after" (react). "before" can rewrite event.params or event.cancel().' },
	{ field: "scripts[].Enabled", type: "boolean", notes: "Defaults to true. false keeps it attached but inert." },
	{ field: "scripts[].Code", type: "string", notes: "Script body only (this/game/event in scope). No function wrapper, no imports." },
	{ field: "vars", type: "object", notes: "Optional initial per-instance scratch (this.vars). Usually {}." },
];
