// src/migrations/v2_9_0_removeStatOverflow.ts
//
// The stat-overflow feature (a stat's surplus regen spilling into a chosen
// shared-inventory pool stat) was removed in 2.9.0. This migration strips the
// now-orphaned OverflowTarget field from everywhere it could have been stored:
//
//   - Settings.StatDefinitions[]            (the campaign-default target)
//   - Settings.SharedInventories[].Stats[]  (per-slot override)
//   - CharacterRoster[].Stats[]             (per-slot override)
//   - EntityTemplates[].Stats[]             (per-slot override)
//   - GameState.Characters[].Stats[]        (per-slot override)
//   - GameState.Entities[].Stats[]          (per-slot override)
//
// Purely cosmetic cleanup — the field was already inert (nothing reads it),
// this just keeps saved data from carrying dead keys forward.
//
// NO domain type imports — access everything via `(data as any).field`.

import type { Migration } from "./types";

export const removeStatOverflowV290Migration: Migration = {
	version: "2.9.0",
	migrate: (data: unknown) => {
		const campaign = data as any;
		if (!campaign || typeof campaign !== "object") return campaign;

		// Strip OverflowTarget from each entry of a StatSlot/StatDefinition array.
		const stripFromList = (list: any) => {
			if (!Array.isArray(list)) return;
			for (const entry of list) {
				if (entry && typeof entry === "object") {
					delete entry.OverflowTarget;
				}
			}
		};

		// Strip from the Stats array of each actor in an actor list.
		const stripFromActors = (actors: any) => {
			if (!Array.isArray(actors)) return;
			for (const actor of actors) {
				if (actor && typeof actor === "object") stripFromList(actor.Stats);
			}
		};

		const settings = campaign.Settings;
		if (settings && typeof settings === "object") {
			stripFromList(settings.StatDefinitions);
			if (Array.isArray(settings.SharedInventories)) {
				for (const inv of settings.SharedInventories) {
					if (inv && typeof inv === "object") stripFromList(inv.Stats);
				}
			}
		}

		stripFromActors(campaign.CharacterRoster);
		stripFromActors(campaign.EntityTemplates);
		stripFromActors(campaign.GameState?.Characters);
		stripFromActors(campaign.GameState?.Entities);

		return campaign;
	},
};
