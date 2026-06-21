/**
 * Generates the downloadable AI-authoring brief: a single self-contained markdown
 * document a DM hands to an AI agent so it can write a Quest-Net script having
 * never seen the source.
 *
 * Anti-drift: the action list / roles / scriptable flags come straight from
 * `ACTION_REGISTRY`, the budgets from `SCRIPT_BUDGETS`, the forbidden tokens from
 * `FORBIDDEN_TOKENS`, and the prose reference from the shared `scriptingApiModel`.
 * Nothing about the API is restated here.
 */

import type { Campaign } from "../../../domains/Campaign/Campaign";
import { ACTION_REGISTRY, isScriptableAction } from "../../Actions/ActionRegistry";
import { SCRIPT_BUDGETS } from "../scriptConstants";
import { FORBIDDEN_TOKENS } from "../scriptValidation";
import { APP_VERSION } from "../../../version";
import { toPlain } from "../../../utils/toPlain";
import { LogUtils } from "../../../domains/Log/LogUtils";
import {
	ACTION_DOCS,
	FACADE_DOCS,
	SCRIPTING_LIMITS,
	SCRIPT_FORMAT_INTRO,
	SCRIPT_ENVELOPE_EXAMPLE,
	SCRIPT_ENVELOPE_FIELDS,
	validateActionDocs,
} from "./scriptingApiModel";

/** Number of most-recent log entries to embed as campaign context. */
const RECENT_LOG_COUNT = 10;
/** Top-level campaign fields excluded from the embedded dump. */
const STRIPPED_CAMPAIGN_FIELDS = new Set(["Images", "VoxelTerrains", "Log", "LogHead"]);

/** Escape a string for safe inclusion in a markdown table cell. */
function td(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** Build the campaign object minus images/terrains, with only the last N logs. */
function buildCampaignDump(campaign: Campaign): Record<string, unknown> {
	const plain = toPlain(campaign) as unknown as Record<string, unknown>;
	const dump: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(plain)) {
		if (STRIPPED_CAMPAIGN_FIELDS.has(key)) continue;
		dump[key] = value;
	}
	const recent = LogUtils.getChronologicalLog(campaign).slice(-RECENT_LOG_COUNT);
	dump.RecentLog = toPlain(recent);
	return dump;
}

function header(campaign: Campaign): string {
	return [
		"# Quest-Net Scripting Brief",
		"",
		`> Generated ${new Date().toISOString()} · Quest-Net v${APP_VERSION} · Campaign: **${campaign.Name}**`,
		"",
		"You are writing a **script** for Quest-Net, a collaborative tabletop RPG manager. A script is a small",
		"snippet of JavaScript attached to a campaign object that reacts to in-game *actions* and changes the",
		"world by calling other actions. This document is everything you need: how scripting works, every",
		"trigger, the API surface, the limits, the exact reply format, and the current campaign's data. Read the",
		"campaign data (bottom) to use the real stats, items, statuses, and actors that exist — never invent names.",
	].join("\n");
}

function howItWorks(): string {
	return [
		"## How scripting works",
		"",
		"A script is an **Event-Condition-Action** rule:",
		"",
		"- **Event** — a dispatched action whose key matches the script's `Trigger` glob (e.g. `actor:move`, `*:move`, `*`). Only `*` is special.",
		"- **Condition** — whatever the code checks (it reads the live campaign through `this`, `game`, `event`).",
		"- **Action** — the code changes the world by calling a facade method or `await game.action(key, params)`. A direct field write changes state but emits no event, so nothing reacts — always mutate through a method/action.",
		"",
		"**Binding.** `this` is the host the script lives on (a campaign, actor, or item/status/skill template).",
		"On a template host, `this` is the template and `this.actor` is the bearer. `game` is the world handle;",
		"`event` is the triggering action: `event.key`, `event.params`, and `event.actor` (the acting actor as a facade, if any).",
		"",
		"**Self-filter.** A script on a status/item/skill template runs once for *every* instance of that template",
		"when its trigger fires. Narrow with params, e.g. `if (event.params.actorId !== this.actor.Id) return;`.",
		"(Round ticks like `combat:incrementRound` carry no actor, so each bearer's `this.actor` is already correct.)",
		"",
		"**Before vs after.** A script's `When` defaults to `\"after\"` (it reacts to a completed action). Set `When: \"before\"`",
		"to intercept: the script runs first and may rewrite `event.params` in place or call `event.cancel()` to veto the action.",
		"",
		"**Cascades.** Every facade mutation is itself an event, so reactions chain. The whole chain resolves inside one",
		"mutation and broadcasts once. Guard one-shot reactions with a `this.vars` latch to avoid loops.",
		"",
		"**Scheduling.** There is no wait. For \"in N rounds\", store a countdown in `this.vars` and decrement it from a",
		"`combat:incrementRound` script.",
	].join("\n");
}

function triggerReference(): string {
	const lines: string[] = [
		"## Triggers — every action and when it fires",
		"",
		"Any action key can be a `Trigger` (a script reacts to it). The **Scriptable** column shows which actions a",
		"script may also *call* (`game.action(key, …)` or a facade method); non-scriptable actions can still be",
		"triggers but cannot be dispatched from a script.",
		"",
	];

	// Group by domain (the part before the first ":").
	const keys = Object.keys(ACTION_REGISTRY).sort();
	const byDomain = new Map<string, string[]>();
	for (const key of keys) {
		const domain = key.split(":")[0];
		if (!byDomain.has(domain)) byDomain.set(domain, []);
		byDomain.get(domain)!.push(key);
	}

	for (const [domain, domainKeys] of [...byDomain.entries()].sort()) {
		lines.push(`### ${domain}`, "");
		lines.push("| Action | Roles | Scriptable | When it fires |");
		lines.push("| --- | --- | --- | --- |");
		for (const key of domainKeys) {
			const def = ACTION_REGISTRY[key];
			const roles = def.roles.join(" / ");
			const scriptable = isScriptableAction(key) ? "yes" : "—";
			const doc = ACTION_DOCS[key];
			const when = doc
				? doc.whenFires + (doc.paramsNote ? ` _(${doc.paramsNote})_` : "")
				: "_(undocumented — add to ACTION_DOCS)_";
			lines.push(`| \`${td(key)}\` | ${td(roles)} | ${scriptable} | ${td(when)} |`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

function apiReference(): string {
	const lines: string[] = [
		"## API & helpers",
		"",
		"Prefer these facade methods — they take a **name or id** for every reference, so you never need a GUID.",
		"Reading any other field is plain property access on `this` / `game.campaign` / a facade. Mutations return a",
		"promise; `await` when ordering matters.",
		"",
	];

	for (const group of FACADE_DOCS) {
		lines.push(`### ${group.title}`, "", group.intro, "");
		lines.push("| Call | Description | Backed by |");
		lines.push("| --- | --- | --- |");
		for (const m of group.methods) {
			lines.push(`| \`${td(m.signature)}\` | ${td(m.description)} | ${m.backedBy ? td(m.backedBy) : ""} |`);
		}
		lines.push("");
	}

	const scriptableKeys = Object.keys(ACTION_REGISTRY).filter(isScriptableAction).sort();
	lines.push(
		"### Escape hatch — `game.action`",
		"",
		"Anything the facades don't cover, dispatch directly: `await game.action(\"domain:verb\", params)` runs the",
		"same validated handler the app uses. Pass plain ids/values (use `actor.Id`, `template.Id`) — never a live",
		"object as an id. Only these keys are callable (anything else throws):",
		"",
		"```",
		scriptableKeys.join("\n"),
		"```",
	);

	return lines.join("\n");
}

function limitsSection(): string {
	const lines: string[] = ["## Limits — what the API cannot do", ""];
	for (const limit of SCRIPTING_LIMITS) lines.push(`- ${limit}`);
	lines.push(
		"",
		"**Cascade budgets (per top-level mutation):**",
		`- Max cascade depth (action → reacting script → action → …): \`${SCRIPT_BUDGETS.MAX_CASCADE_DEPTH}\``,
		`- Max total \`game.action()\` calls: \`${SCRIPT_BUDGETS.MAX_TOTAL_ACTIONS}\``,
		"",
		"**Forbidden tokens (the validator rejects a script containing any of these):**",
		"",
		"```",
		FORBIDDEN_TOKENS.join(" "),
		"```",
	);
	return lines.join("\n");
}

function outputFormat(): string {
	const lines: string[] = ["## How to reply — the script format", "", SCRIPT_FORMAT_INTRO, ""];
	lines.push("| Field | Type | Notes |");
	lines.push("| --- | --- | --- |");
	for (const f of SCRIPT_ENVELOPE_FIELDS) {
		lines.push(`| \`${td(f.field)}\` | \`${td(f.type)}\` | ${td(f.notes)} |`);
	}
	lines.push("", "Example:", "", "```json", SCRIPT_ENVELOPE_EXAMPLE, "```");
	return lines.join("\n");
}

function campaignContext(campaign: Campaign): string {
	const dump = buildCampaignDump(campaign);
	return [
		"## Your campaign",
		"",
		`The full campaign object below (images and terrains omitted; only the last ${RECENT_LOG_COUNT} log entries`,
		"included, under `RecentLog`). Use the actual names and ids here when writing the script.",
		"",
		"```json",
		JSON.stringify(dump, null, 2),
		"```",
	].join("\n");
}

/** Build the complete markdown brief for a campaign. */
export function generateScriptingDoc(campaign: Campaign): string {
	validateActionDocs(); // dev-time drift warning; no-op when in sync
	return [
		header(campaign),
		howItWorks(),
		triggerReference(),
		apiReference(),
		limitsSection(),
		outputFormat(),
		campaignContext(campaign),
	].join("\n\n");
}

/** Generate the brief and trigger a browser download as a `.md` file. */
export function downloadScriptingDoc(campaign: Campaign): void {
	const markdown = generateScriptingDoc(campaign);
	const blob = new Blob([markdown], { type: "text/markdown" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `${campaign.Name.replace(/[^a-z0-9]/gi, "_")}_scripting_brief.md`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}
