import type { ReactNode } from "react";
import {
	WikiCallout,
	WikiCardGrid,
	WikiCode,
	WikiFieldGrid,
	WikiHighlight,
} from "../components/content";
import type { WikiPageDefinition } from "./WikiPage";
import { ACTION_REGISTRY, isScriptableAction } from "../../services/Actions/ActionRegistry";
import {
	ACTION_DOCS,
	FACADE_DOCS,
	SCRIPTING_LIMITS,
	type FacadeGroupDoc,
} from "../../services/Scripting/docs/scriptingApiModel";
import { ScriptTestHarness } from "../components/ScriptTestHarness";

// ---------------------------------------------------------------------------
// Authoritative scripting API reference (v2) — the single document handed to an
// AI agent (or a curious DM) to author scripts. The scriptable-action list is
// GENERATED from the registry so it cannot drift as actions are added.
// ---------------------------------------------------------------------------

/** A small multi-line code block (WikiCode is inline-only). */
function CodeBlock({ children }: { children: ReactNode }) {
	return (
		<pre className="overflow-x-auto rounded-lg border border-base-300 bg-base-200 p-4 font-mono text-sm leading-relaxed text-base-content">
			<code>{children}</code>
		</pre>
	);
}

const SCRIPTABLE_ACTION_KEYS = Object.keys(ACTION_REGISTRY)
	.filter(isScriptableAction)
	.sort();

/**
 * Exhaustive facade reference for one group, rendered from the shared model so it
 * stays in sync with the downloadable scripting brief.
 */
function FacadeTable({ group }: { group: FacadeGroupDoc }) {
	return (
		<div className="space-y-2">
			<h4 className="font-semibold text-sm">{group.title}</h4>
			<p className="text-sm opacity-80">{group.intro}</p>
			<div className="overflow-x-auto rounded-lg border border-base-300 bg-base-200">
				<table className="table table-sm">
					<tbody>
						{group.methods.map((m) => (
							<tr key={m.signature}>
								<td className="font-mono text-xs whitespace-nowrap align-top">
									{m.signature}
								</td>
								<td className="text-xs opacity-80">
									{m.description}
									{m.backedBy && m.backedBy !== "read" && (
										<span className="opacity-60"> · {m.backedBy}</span>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

/** Every action, grouped by domain, with roles / scriptable / when-it-fires. */
function TriggerReferenceTable() {
	const keys = Object.keys(ACTION_REGISTRY).sort();
	return (
		<div className="overflow-x-auto rounded-lg border border-base-300 bg-base-200">
			<table className="table table-sm">
				<thead>
					<tr>
						<th>Action</th>
						<th>Roles</th>
						<th>Script-ok</th>
						<th>When it fires</th>
					</tr>
				</thead>
				<tbody>
					{keys.map((key) => {
						const def = ACTION_REGISTRY[key];
						const doc = ACTION_DOCS[key];
						return (
							<tr key={key}>
								<td className="font-mono text-xs whitespace-nowrap align-top">{key}</td>
								<td className="text-xs align-top">{def.roles.join(" / ")}</td>
								<td className="text-xs align-top">
									{isScriptableAction(key) ? "yes" : "—"}
								</td>
								<td className="text-xs opacity-80">
									{doc ? doc.whenFires : "(undocumented)"}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

const scriptingPage: WikiPageDefinition = {
	slug: "scripting",
	title: "Scripting",
	audience: "Developer",
	category: "Technical",
	summary:
		"Attach small scripts to items, skills, statuses, actors, or the campaign to add custom behaviors — a poison that ticks each round, a buff that resizes its bearer, a world rule that heals the party on a long rest.",
	tags: ["scripting", "automation", "behaviors", "actions", "eca", "hooks", "api"],
	icon: "icon-[mdi--code-braces]",
	sections: [
		{
			id: "overview",
			title: "What Scripting Is",
			body: (
				<div className="space-y-4">
					<p>
						Scripting lets you attach small snippets of JavaScript to campaign objects
						to give them custom behavior. A script is an{" "}
						<WikiHighlight tone="primary">Event-Condition-Action</WikiHighlight> rule: it
						runs when a game <em>action</em> is dispatched, checks whatever{" "}
						<em>condition</em> it likes, and changes the world by calling other{" "}
						<em>actions</em>. Scripts are normally written by an AI agent on the DM's
						behalf.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Runs only on the DM",
								tone: "primary",
								detail:
									"The DM is the authority. Scripts fire only on the DM's machine; players receive the results a beat later via state sync. Never branch on randomness expecting players to compute the same thing — only the DM runs the code.",
							},
							{
								name: "Triggered by actions",
								tone: "accent",
								detail:
									"Every dispatched action is an event. A script subscribes to an action-key glob (a move is actor:move; a round tick is combat:incrementRound). When a matching action runs, the script runs right after it — or right before it, to intercept and rewrite or cancel the action (see Before vs After).",
							},
							{
								name: "Reads anything, changes via methods",
								tone: "info",
								detail:
									"`this`, `game`, and `event` are real live objects, so reading any field is plain property access. To CHANGE the world you call a friendly method like this.actor.changeStat('HP', -5) — or, for anything without one, await game.action(...). Both run the same validated handlers the app uses.",
							},
							{
								name: "One atomic reaction",
								tone: "success",
								detail:
									"However much a script cascades (its actions trigger more scripts), the whole reaction resolves inside one mutation and broadcasts once. Everyone is updated together.",
							},
						]}
					/>
					<WikiCallout tone="warning" title="No sandbox — author and import with care">
						<p>
							Scripts run unsandboxed on the DM. A light keyword check blocks the
							obvious escapes (network, storage, DOM, reflection), but it is not a
							security boundary. Only run campaigns whose scripts you trust, and use the{" "}
							<WikiCode>scripting.disabled</WikiCode> setting to turn all scripts off for
							an untrusted import.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "triggers",
			title: "Triggers",
			body: (
				<div className="space-y-4">
					<p>
						A script declares a single <WikiCode>Trigger</WikiCode>: an action-key glob.
						When an action whose key matches is dispatched, the script runs. Only{" "}
						<WikiCode>*</WikiCode> is special.
					</p>
					<CodeBlock>{`"item:use"                // exactly this action
"*:move"                  // any move, e.g. actor:move
"status:give"             // when any status is applied
"combat:incrementRound"   // each round tick ("round start")
"calendar:longRest"       // when the party long-rests
"*"                       // every action (use sparingly)`}</CodeBlock>
					<p className="text-sm opacity-80">
						Every action and when it fires (the <WikiCode>Script-ok</WikiCode> column
						marks which a script may also <em>call</em>):
					</p>
					<TriggerReferenceTable />
					<WikiCallout tone="info" title="Where a script lives vs. what it can reach">
						<p>
							A script lives on an object for organization and to bind{" "}
							<WikiCode>this</WikiCode> — but it always reaches the{" "}
							<strong>whole campaign</strong>. A status that needs to spawn and move a
							different entity lives on the <em>status</em> (intuitive) yet reaches the{" "}
							other entity through <WikiCode>game</WikiCode>.
						</p>
					</WikiCallout>
					<WikiCallout tone="warning" title="A script runs once per instance — self-filter">
						<p>
							A script on a status/item/skill template runs once for{" "}
							<strong>every instance</strong> of that template when its trigger fires —
							not just the one involved in the action. Narrow with{" "}
							<WikiCode>event.params</WikiCode>, e.g.{" "}
							<WikiCode>if (event.params.actorId !== this.actor.Id) return;</WikiCode>,
							so a poison on one creature doesn't react to another creature's move.
							(Round ticks like <WikiCode>combat:incrementRound</WikiCode> carry no
							actor, so each bearer's <WikiCode>this.actor</WikiCode> already points at
							the right creature — no filter needed.)
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "binding",
			title: "`this`, `game`, `event`",
			body: (
				<div className="space-y-4">
					<p>
						Every script runs with <WikiCode>this</WikiCode> bound to its host, and{" "}
						<WikiCode>game</WikiCode> and <WikiCode>event</WikiCode> in scope.
					</p>
					<WikiFieldGrid
						items={[
							{ name: "Status / Item / Skill host", tone: "primary", detail: "this = the template fields · this.actor = the bearer/holder (an actor facade) · this.vars = per-instance scratch on that slot." },
							{ name: "Actor / Entity host", tone: "accent", detail: "this = the actor's live fields (this.Id, this.Position, ...) · this.actor = the same actor as a facade (use this.actor for methods)." },
							{ name: "Campaign host", tone: "info", detail: "this = the campaign (world rule) · no this.actor — reach actors via game.find / game.party()." },
						]}
					/>
					<p className="text-sm opacity-80">On every host:</p>
					<CodeBlock>{`this.params          // declared Parameters resolved to their defaults (read-only)
this.vars            // persistent scratch — read AND write (this.vars.count = 3)
this.actor           // the bearer/holder actor facade (undefined for campaign hosts)`}</CodeBlock>
					<p className="text-sm opacity-80">The <WikiCode>game</WikiCode> facade:</p>
					<CodeBlock>{`game.campaign                  // the whole live Campaign (read anything)
game.find("Goblin")            // an active actor by name or id -> actor facade
game.actors()                  // all active actors  ·  game.party()  ·  game.enemies()
game.actorsWithStatus("Poisoned")
game.sharedInventory("Party Funds")   // a shared pool facade
game.combat                    // combat system (round / isActive / start / nextRound...)
game.calendar                  // in-world date + rests (advanceDays / shortRest / longRest)
game.scene                     // setEnvironment / setFocus images
game.audio                     // setTrack / setVolume / stop
game.roll("2d6+1")             // silent DM dice -> number   ·   game.rng() -> 0..1
await game.log("text")         // quick log entry
await game.spawnActor("Goblin", pos)    //  await game.spawnItem("Torch", pos)
await game.ping(pos)           // flash a marker on the map
await game.action(key, params) // escape hatch: dispatch ANY scriptable action`}</CodeBlock>
					<p className="text-sm opacity-80">The triggering <WikiCode>event</WikiCode>:</p>
					<CodeBlock>{`event.key        // the action key that fired, e.g. "actor:move"
event.params     // the params that action was called with
event.actor      // the acting actor as a facade (from params.actorId), if any`}</CodeBlock>
					<p className="text-sm opacity-80">
						In a <WikiCode>"before"</WikiCode> script <WikiCode>event.params</WikiCode> is
						mutable and <WikiCode>event.cancel()</WikiCode> is available — see Before vs
						After.
					</p>
				</div>
			),
		},
		{
			id: "actors",
			title: "Working with Actors",
			body: (
				<div className="space-y-4">
					<p>
						<WikiCode>this.actor</WikiCode>, <WikiCode>game.find(...)</WikiCode>, and{" "}
						<WikiCode>event.actor</WikiCode> are <WikiHighlight tone="primary">actor
						facades</WikiHighlight>: the live actor with handy methods layered on. Every
						"which stat / item / status" argument takes a <strong>name or id</strong> —
						you never type a GUID. Reading any field is plain property access.
					</p>
					<CodeBlock>{`const goblin = game.find("Goblin");        // by name (or id, or "Gob*")

goblin.changeStat("HP", -5);               // damage, clamped 0..Max
goblin.setStat("HP", 10);                  // set an absolute value
goblin.getStatValue("HP");                 // read -> number | null
goblin.hasStatus("Stunned");               // -> boolean
goblin.distanceTo("Hero");                 // movement-cost distance -> number

goblin.giveStatus("Poisoned");             // also: removeStatus, setStatusDuration
goblin.giveItem("Potion", 2);              // also: removeItem, useItem, equipItem, unequipItem
goblin.giveSkill("Fireball");              // also: removeSkill, useSkill
goblin.move(this.actor.Position);          // teleport (no pathing)
goblin.roll("1d20+3");                      // an OBSERVABLE roll other scripts can react to

goblin.Name, goblin.Position, goblin.Stats // any live field reads straight through`}</CodeBlock>
					<WikiCallout tone="info" title="await is optional, but recommended">
						<p>
							Every facade mutation (and <WikiCode>game.action</WikiCode>) returns a
							promise. <WikiCode>await</WikiCode> it when ordering matters; if you forget,
							the engine still runs your calls in order and finishes them before the one
							broadcast.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "systems",
			title: "Game Systems",
			body: (
				<div className="space-y-4">
					<p>
						The cross-cutting systems hang off <WikiCode>game</WikiCode> as small
						facades. Reads are properties; verbs are methods.
					</p>
					<p className="text-sm opacity-80">Combat:</p>
					<CodeBlock>{`game.combat.isActive          // boolean
game.combat.round             // 1-based round number
game.combat.side              // "party" | "enemies" (party mode)
await game.combat.start();    // also: end(), nextRound(), prevRound()
await game.combat.markTurnDone("Goblin");
game.combat.actorsThisRound(); // actor facades acting this round`}</CodeBlock>
					<p className="text-sm opacity-80">Calendar &amp; rests:</p>
					<CodeBlock>{`game.calendar.day             // absolute day counter
game.calendar.date            // { year, month, day, ... }
await game.calendar.advanceDays(1);   // also: setDay(n), setDate({ year, month, day })
await game.calendar.shortRest();      // also: longRest()`}</CodeBlock>
					<p className="text-sm opacity-80">Scene &amp; audio:</p>
					<CodeBlock>{`await game.scene.setEnvironment("Dungeon");     // background image (name or id)
await game.scene.setFocus("Boss Portrait");     // pass "" to clear
await game.audio.setTrack("Battle Theme");      // also: setVolume(0.5), stop()`}</CodeBlock>
					<p className="text-sm opacity-80">Shared inventories (party pools):</p>
					<CodeBlock>{`const funds = game.sharedInventory("Party Funds");
funds.getStatValue("Gold");                     // read a pooled stat
await funds.changeStat("Gold", -10);            // spend, clamped 0..Max
await funds.transferStatTo("Hero", "Gold", 5);  // to an actor OR another pool
await funds.transferItemTo("Hero", "Map");      // move an item out  ·  discardItem(item)`}</CodeBlock>
				</div>
			),
		},
		{
			id: "api-reference",
			title: "API Reference",
			body: (
				<div className="space-y-4">
					<p>
						The complete curated surface, generated from the same model as the
						downloadable scripting brief. Every reference argument takes a{" "}
						<strong>name or id</strong>; mutation methods show their backing action.
					</p>
					{FACADE_DOCS.map((group) => (
						<FacadeTable key={group.title} group={group} />
					))}
				</div>
			),
		},
		{
			id: "phase",
			title: "Before vs After (intercepting actions)",
			body: (
				<div className="space-y-4">
					<p>
						A script has a phase, <WikiCode>When</WikiCode>, relative to the action it
						triggers on. The default is <WikiCode>"after"</WikiCode> — the action has
						already run and the script <strong>reacts</strong> (every example above).
						Set it to <WikiCode>"before"</WikiCode> to <strong>intercept</strong> the
						action: the script runs <em>first</em>, and may rewrite the action or stop it.
					</p>
					<p className="text-sm opacity-80">
						In a <WikiCode>"before"</WikiCode> script the <WikiCode>event</WikiCode> is
						mutable:
					</p>
					<CodeBlock>{`event.params.amount *= 2;   // rewrite the action's params in place
event.cancel();             // veto: the action (and its after-reactions) never run`}</CodeBlock>
					<WikiCallout tone="info" title="Intercepting a dice roll">
						<p>
							A skill/item roll uses its template formula unless a before-script supplies{" "}
							<WikiCode>event.params.diceFormula</WikiCode>. A "bless" status can read the
							skill's base formula and add to it:
						</p>
						<CodeBlock>{`// Status, When: "before"  ·  Trigger: "skill:use"
if (event.params.actorId !== this.actor.Id) return;   // only OUR bearer
const skill = game.campaign.SkillTemplates.find(s => s.Id === event.params.skillId);
if (skill?.DiceRoll) event.params.diceFormula = skill.DiceRoll + " + 1d4";`}</CodeBlock>
					</WikiCallout>
					<WikiCallout tone="warning" title="Before-scripts run on the DM only">
						<p>
							Like reactions, before-scripts run on the DM's authoritative path. A player
							sees their own un-modified result optimistically for a moment, then the DM's
							broadcast (with the rewritten or cancelled outcome) corrects it. A
							before-script's own <WikiCode>game.action</WikiCode> calls run as normal
							reactions — they don't recurse the before-phase.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "actions",
			title: "The Escape Hatch (game.action)",
			body: (
				<div className="space-y-4">
					<p>
						The facade methods cover the common effects, but anything they don't can be
						dispatched directly with{" "}
						<WikiCode>await game.action("domain:verb", params)</WikiCode>. This runs the
						same handler the app uses, so all validation/clamping/logging is shared.
						Pass plain ids and values — never a live object as an id (use{" "}
						<WikiCode>actor.Id</WikiCode>, <WikiCode>template.Id</WikiCode>).
					</p>
					<CodeBlock>{`await game.action("actor:bulkEditTags", { updates: [{ actorId: this.actor.Id, tags: ["seen"] }] });
await game.action("status:give", { statusIds: [s.Id], actorIds: [this.actor.Id], count: 1 });`}</CodeBlock>
					<p className="text-sm opacity-80">
						Script-ok actions (generated from the registry — anything not listed throws
						when called):
					</p>
					<CodeBlock>{SCRIPTABLE_ACTION_KEYS.join("\n")}</CodeBlock>
					<p className="text-sm opacity-80">What scripts cannot do:</p>
					<ul className="list-disc space-y-1 pl-6 text-sm opacity-80">
						{SCRIPTING_LIMITS.map((limit, i) => (
							<li key={i}>{limit}</li>
						))}
					</ul>
					<WikiCallout tone="info" title="Why some actions are missing">
						<p>
							An action is script-ok only when its registry entry has{" "}
							<WikiCode>scriptable: true</WikiCode>. Sync and async handlers both work;
							destructive or structural actions such as deletes and{" "}
							<WikiCode>campaign:edit</WikiCode> stay out unless they are explicitly opted in.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "cascades",
			title: "Cascades & Safety",
			body: (
				<div className="space-y-4">
					<p>
						Because every facade mutation (and <WikiCode>game.action</WikiCode>) is itself
						an event, reactions chain: an item damages a creature → the creature's "on
						edit" script sees it hit 0 HP → it explodes and damages its neighbors → their
						scripts fire. The engine runs the whole chain inside the one triggering
						mutation, then broadcasts once.
					</p>
					<WikiFieldGrid
						items={[
							{ name: "Mutate via methods / game.action", tone: "primary", detail: "A direct field write changes state but emits no event, so nothing reacts. Always change the world through a facade method or game.action so cascades work." },
							{ name: "Guard against loops", tone: "warning", detail: "Use this.vars as a latch (e.g. this.vars.exploded) so a one-shot reaction can't re-fire. Avoid scripts that undo each other." },
							{ name: "Bounded", tone: "info", detail: "Per-mutation caps on cascade depth and total actions halt a runaway chain (and log it). There is no wall-clock limit, so never write an infinite loop." },
							{ name: "Errors are isolated", tone: "success", detail: "A throwing script logs to the DM-visible campaign log and the rest of the cascade continues — one bad script never wedges a turn." },
						]}
					/>
					<WikiCallout tone="info" title='Scheduling for "later"'>
						<p>
							There is no wait. For "in 3 rounds…", store a countdown in{" "}
							<WikiCode>this.vars</WikiCode> and decrement it from a{" "}
							<WikiCode>combat:incrementRound</WikiCode> script — "later" is always a
							future action firing.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "params",
			title: "Parameters vs. Vars",
			body: (
				<div className="space-y-4">
					<WikiCardGrid
						columns={2}
						items={[
							{
								title: "Parameters (this.params)",
								tone: "primary",
								body:
									"Author-declared, typed, DM-tunable config — a number with min/max, a toggle, a select. Read-only at runtime, surfaced as friendly inputs on the edit form so a DM can retune behavior without reading code. A param resolves to its declared default.",
							},
							{
								title: "Vars (this.vars)",
								tone: "accent",
								body:
									"Per-instance untyped scratch (counters, countdowns, latches). The script reads and writes them; they persist and sync as ordinary campaign state. Never surfaced as config.",
							},
						]}
					/>
				</div>
			),
		},
		{
			id: "examples",
			title: "Worked Examples",
			body: (
				<div className="space-y-4">
					<p className="text-sm opacity-80">
						Poison — ticks the bearer's HP at the start of every round:
					</p>
					<CodeBlock>{`// Status hook  ·  Trigger: "combat:incrementRound"
this.actor.changeStat("HP", -this.params.potency);`}</CodeBlock>
					<p className="text-sm opacity-80">
						Stalker status — spawns a "Stalker" on first move, then follows the bearer:
					</p>
					<CodeBlock>{`// Status hook  ·  Trigger: "*:move"
if (event.params.actorId !== this.actor.Id) return;   // only when OUR bearer moves
const stalker = game.find("Stalker");
if (stalker) stalker.move(this.actor.Position);
else game.spawnActor("Stalker", this.actor.Position);`}</CodeBlock>
					<p className="text-sm opacity-80">
						Blessing trinket — gives a status to whoever uses it:
					</p>
					<CodeBlock>{`// Item hook  ·  Trigger: "item:use"
if (event.params.itemId !== this.Id) return;          // this item...
if (event.params.actorId !== this.actor.Id) return;   // ...used by our holder
this.actor.giveStatus("Blessed");`}</CodeBlock>
					<p className="text-sm opacity-80">
						World rule — restore the whole party to full HP on a long rest:
					</p>
					<CodeBlock>{`// Campaign hook  ·  Trigger: "calendar:longRest"
for (const pc of game.party()) pc.setStat("HP", pc.getStatMax("HP"));`}</CodeBlock>
					<p className="text-sm opacity-80">World rule — announce each round:</p>
					<CodeBlock>{`// Campaign hook  ·  Trigger: "combat:incrementRound"
await game.log("Round " + game.combat.round + " begins", { category: "combat" });`}</CodeBlock>
				</div>
			),
		},
		{
			id: "test-harness",
			title: "Test Harness",
			body: (
				<div className="space-y-4">
					<p>
						Paste a script, pick a host and a triggering action, and run it against a{" "}
						<WikiHighlight tone="primary">copy</WikiHighlight> of the current campaign. You
						see the resulting state diff and any error —{" "}
						<strong>the live game is never touched</strong>. Cascades through saved
						scripts run too, so you can test a whole reaction.
					</p>
					<ScriptTestHarness />
				</div>
			),
		},
	],
	searchText:
		"scripting script behavior automation eca event condition action trigger game.action this game event params vars parameters cascade dm authority actor entity status item skill campaign world rule facade changestat setstat givestatus giveitem useitem equip giveskill move roll distanceto spawnactor spawnitem ping shared inventory pool calendar long rest short rest advance day scene environment focus audio track volume combat round nextround markturndone stalker buff size spawn move log roll scriptable async destructive sandbox security test harness api reference before after when intercept interception cancel veto modify rewrite diceformula bless phase",
};

export default scriptingPage;
