// src/migrations/v3_2_0_scriptScopeAny.ts
//
// 3.2.0 adds Script.Scope. Absent now means "self": a script on an actor or an
// item/status/skill template only sees events about its own bearer/template.
// Before 3.2.0 every script saw every matching event, so this stamps
// Scope: "any" on every existing script to keep its behavior unchanged.
//
// Scripts live on the campaign, actors, templates, and copies of those (roster,
// scenarios), so walk the whole campaign and stamp every `Scripts` array found.
//
// NO domain type imports -- access everything via `(data as any).field`.

import type { Migration } from "./types";

function stampScripts(node: unknown): void {
	if (!node || typeof node !== "object" || ArrayBuffer.isView(node)) return;
	if (Array.isArray(node)) {
		for (const item of node) stampScripts(item);
		return;
	}
	const obj = node as Record<string, unknown>;
	if (Array.isArray(obj.Scripts)) {
		for (const script of obj.Scripts as any[]) {
			if (script && typeof script === "object" && script.Scope === undefined) {
				script.Scope = "any";
			}
		}
	}
	for (const value of Object.values(obj)) stampScripts(value);
}

export const scriptScopeAnyV320Migration: Migration = {
	version: "3.2.0",
	migrate: (data: unknown) => {
		stampScripts(data);
		return data;
	},
};

// Self-check: nested scripts get stamped, an explicit Scope is kept.
{
	const sample: any = {
		Scripts: [{ Code: "" }],
		ItemTemplates: [{ Scripts: [{ Code: "", Scope: "self" }] }],
		Scenarios: [{ Entities: [{ Scripts: [{ Code: "" }] }] }],
	};
	stampScripts(sample);
	console.assert(
		sample.Scripts[0].Scope === "any" &&
			sample.ItemTemplates[0].Scripts[0].Scope === "self" &&
			sample.Scenarios[0].Entities[0].Scripts[0].Scope === "any",
		"[migration 3.2.0] script scope stamping self-check failed"
	);
}
