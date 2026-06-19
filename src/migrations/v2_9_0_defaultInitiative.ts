// src/migrations/v2_9_0_defaultInitiative.ts
//
// New campaigns default to a configured initiative (Move Speed primary,
// party-based rounds) instead of starting "not configured". This migration
// seeds that same default into existing campaigns whose InitiativeSettings is
// undefined, so they show the default config rather than the empty-state gate.
//
// Campaigns that already have InitiativeSettings (configured, or deliberately
// shaped) are left untouched.
//
// NO domain type imports — access everything via `(data as any).field`.

import type { Migration } from "./types";

export const defaultInitiativeV290Migration: Migration = {
	version: "2.9.0",
	migrate: (data: unknown) => {
		const campaign = data as any;
		if (!campaign || typeof campaign !== "object") return campaign;

		const settings = campaign.Settings;
		if (!settings || typeof settings !== "object") return campaign;

		if (settings.InitiativeSettings === undefined) {
			settings.InitiativeSettings = {
				Sources: [{ kind: "moveSpeed" }],
				Mode: "party",
			};
		}

		return campaign;
	},
};
