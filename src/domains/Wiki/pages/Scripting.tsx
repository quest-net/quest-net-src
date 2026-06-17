import type { ReactNode } from "react";
import {
	WikiCallout,
	WikiCardGrid,
	WikiCode,
	WikiFieldGrid,
	WikiHighlight,
} from "../components/content";
import type { WikiPageDefinition } from "./WikiPage";
import { ACTION_REGISTRY, isScriptableAction } from "../../../services/Actions/ActionRegistry";
import { ScriptTestHarness } from "../components/ScriptTestHarness";

// ---------------------------------------------------------------------------
// Authoritative scripting API reference (v2) — the single document handed to an
// AI agent (or a curious DM) to author scripts. The scriptable-action list is
// GENERATED from the registry so it cannot drift as actions are added.
// ---------------------------------------------------------------------------

/** A small multi-line code block (WikiCode is inline-only). */
function CodeBlock({ children }: { children: ReactNode }) {
	return (
		<pre className="overflow-x-auto rounded-lg border border-base-300 bg-base-200 p-4 font-mono text-xs leading-relaxed">
			<code>{children}</code>
		</pre>
	);
}

const SCRIPTABLE_ACTION_KEYS = Object.keys(ACTION_REGISTRY)
	.filter(isScriptableAction)
	.sort();

const scriptingPage: WikiPageDefinition = {
	slug: "scripting",
	title: "Scripting",
	audience: "Developer",
	category: "Technical",
	summary:
		"Attach small scripts to items, skills, statuses, actors, or the campaign to add custom behaviors — a status that follows a target around, a buff that resizes its bearer, a world rule that fires every round.",
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
									"Every dispatched action is an event. A script subscribes to an action-key glob (a move is actor:move; a round tick is combat:incrementRound). When a matching action runs, the script runs right after it.",
							},
							{
								name: "Reads anything, changes via actions",
								tone: "info",
								detail:
									"`this`, `game`, and `event` are real live objects, so reading any field or collection is plain property access — even fields added to the app later. To CHANGE the world you await game.action(...), the same handler the app uses, so validation/clamping/logging are shared.",
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
					<CodeBlock>{`"item:use"            // exactly this action
"*:move"              // any move, e.g. actor:move
"status:give"         // when any status is applied
"combat:incrementRound"   // each round tick ("round start")
"*"                   // every action (use sparingly)`}</CodeBlock>
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
							not just the one involved in the action. Always narrow with{" "}
							<WikiCode>event.params</WikiCode>, e.g.{" "}
							<WikiCode>if (event.params.actorId !== this.actor.Id) return;</WikiCode>,
							so a poison on one creature doesn't react to another creature's move.
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
							{ name: "Status / Item / Skill host", tone: "primary", detail: "this = the template fields · this.actor = the bearer/holder · this.vars = per-instance scratch on that slot." },
							{ name: "Actor / Entity host", tone: "accent", detail: "this = the actor (this.Id, this.Position, this.Stats, ...) · this.actor = the same actor." },
							{ name: "Campaign host", tone: "info", detail: "this = the campaign (world rule) · no this.actor." },
						]}
					/>
					<p className="text-sm opacity-80">On every host:</p>
					<CodeBlock>{`this.params          // declared Parameters resolved to their defaults (read-only)
this.vars            // persistent scratch — read AND write (this.vars.count = 3)
this.actor           // the bearer/holder actor (undefined for campaign hosts)`}</CodeBlock>
					<p className="text-sm opacity-80">The <WikiCode>game</WikiCode> facade:</p>
					<CodeBlock>{`game.campaign            // the whole live Campaign (read anything)
await game.action(key, params) // THE only way to change the world (see below)
game.actors()            // active characters + entities
game.find("Goblin*")     // active actor by name glob
game.template(coll, name)// resolve a template by name -> the template object (use .Id)
game.roll("2d6+1")       // DM-authoritative dice -> number
game.rng()               // 0..1
await game.log("text")   // quick log entry
game.combat              // read-only combat state { isActive, currentRound, ... }`}</CodeBlock>
					<p className="text-sm opacity-80">The triggering <WikiCode>event</WikiCode>:</p>
					<CodeBlock>{`event.key        // the action key that fired, e.g. "actor:move"
event.params     // the params that action was called with
event.actor      // the acting actor (resolved from params.actorId/entityId), if any`}</CodeBlock>
				</div>
			),
		},
		{
			id: "actions",
			title: "Changing the World (game.action)",
			body: (
				<div className="space-y-4">
					<p>
						A script changes the world in exactly one way:{" "}
						<WikiCode>await game.action("domain:verb", params)</WikiCode>. This runs the same
						handler the app uses, so all validation/clamping/logging is shared.
						Pass plain ids and values — never a live object as an id (use{" "}
						<WikiCode>actor.Id</WikiCode>, <WikiCode>template.Id</WikiCode>).
					</p>
					<CodeBlock>{`await game.action("actor:move",   { actorId: e.Id, position: this.actor.Position });
await game.action("status:give",  { statusIds: [s.Id], actorIds: [this.actor.Id], count: 1 });
await game.action("actor:edit",   { actorId: this.actor.Id, updates: { Size: "large" } });`}</CodeBlock>
					<p className="text-sm opacity-80">
						Script-ok actions (generated from the registry — anything not listed throws
						when called):
					</p>
					<CodeBlock>{SCRIPTABLE_ACTION_KEYS.join("\n")}</CodeBlock>
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
						Because every <WikiCode>game.action</WikiCode> is itself an event, reactions
						chain: an item damages a creature → the creature's "on edit" script sees it
						hit 0 HP → it explodes and damages its neighbors → their scripts fire. The
						engine runs the whole chain inside the one triggering mutation, then
						broadcasts once.
					</p>
					<WikiFieldGrid
						items={[
							{ name: "Mutate only via game.action", tone: "primary", detail: "A direct field write changes state but emits no event, so nothing reacts. Always go through game.action to make cascades work." },
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
						Stalked status — spawns a "Stalker" on first move, then follows the bearer:
					</p>
					<CodeBlock>{`// Status hook  ·  Trigger: "*:move"
if (event.params.actorId !== this.actor.Id) return;   // only OUR bearer
const stalker = game.find("Stalker");
const pos = this.actor.Position;
if (!stalker) {
  await game.action("actor:spawn", { actorId: game.template("EntityTemplates", "Stalker").Id, position: pos });
} else {
  await game.action("actor:move", { actorId: stalker.Id, position: pos });
}`}</CodeBlock>
					<p className="text-sm opacity-80">
						Enlarging buff — bigger while applied, restored on removal:
					</p>
					<CodeBlock>{`// Status, script A  ·  Trigger: "status:give"
if (!event.params.actorIds?.includes(this.actor.Id)) return;
this.vars.prevSize = this.actor.Size ?? "medium";
await game.action("actor:edit", { actorId: this.actor.Id, updates: { Size: "large" } });

// Status, script B  ·  Trigger: "status:remove"
if (event.params.actorId !== this.actor.Id) return;
await game.action("actor:edit", { actorId: this.actor.Id, updates: { Size: this.vars.prevSize ?? "medium" } });`}</CodeBlock>
					<p className="text-sm opacity-80">
						On-use trinket — applies a status to the user:
					</p>
					<CodeBlock>{`// Item hook  ·  Trigger: "item:use"
await game.action("status:give", {
  statusIds: [game.template("StatusTemplates", "Blessed").Id],
  actorIds: [this.actor.Id],
  count: 1,
});`}</CodeBlock>
					<p className="text-sm opacity-80">Campaign world rule — log each round:</p>
					<CodeBlock>{`// Campaign hook  ·  Trigger: "combat:incrementRound"
await game.log("Round " + game.combat.currentRound + " begins", { category: "combat" });`}</CodeBlock>
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
		"scripting script behavior automation eca event condition action trigger game.action this game event params vars parameters cascade dm authority actor entity status item skill campaign world rule stalker buff size spawn move log roll combat scriptable async destructive sandbox security test harness api reference",
};

export default scriptingPage;
