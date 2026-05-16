// src/migrations/v2_0_0_actorColors.ts
//
// Adds persisted actor token colors. Existing characters keep the old party
// blue default, and existing entities keep the old enemy red/orange default.

import type { Migration } from "./types";

const DEFAULT_CHARACTER_COLOR = "#2563eb";
const DEFAULT_ENTITY_COLOR = "#b45309";

function setMissingActorColor(actor: any, color: string): void {
	if (!actor || typeof actor !== "object") return;
	if (typeof actor.Color !== "string" || actor.Color.trim() === "") {
		actor.Color = color;
	}
}

export const actorColorsV200Migration: Migration = {
	version: "2.0.0",
	migrate: (data: unknown) => {
		const campaign = data as any;

		for (const character of campaign.CharacterRoster ?? []) {
			setMissingActorColor(character, DEFAULT_CHARACTER_COLOR);
		}
		for (const character of campaign.GameState?.Characters ?? []) {
			setMissingActorColor(character, DEFAULT_CHARACTER_COLOR);
		}
		for (const entity of campaign.EntityTemplates ?? []) {
			setMissingActorColor(entity, DEFAULT_ENTITY_COLOR);
		}
		for (const entity of campaign.GameState?.Entities ?? []) {
			setMissingActorColor(entity, DEFAULT_ENTITY_COLOR);
		}

		return campaign;
	},
};
