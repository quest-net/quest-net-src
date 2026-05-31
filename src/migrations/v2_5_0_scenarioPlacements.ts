// src/migrations/v2_5_0_scenarioPlacements.ts
//
// Unifies the three legacy scenario placement fields (EntityPlacements,
// ItemPlacements, SpawnPositions) into a single identity-based ActorPlacements
// list.
//
// - EntityPlacements / ItemPlacements convert faithfully (template ref + a
//   freshly generated instance Id).
// - SpawnPositions were stored by index with no character identity, so they are
//   best-effort mapped onto the campaign's characters in the same order capture
//   originally read them (GameState.Characters first, then CharacterRoster).
//   This is inherently lossy; re-capturing important scenarios after upgrading
//   is recommended.

import type { Migration } from "./types";

function newId(): string {
	// crypto.randomUUID is available in all supported runtimes; fall back just
	// in case a migration runs in an exotic environment.
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clonePosition(pos: any): any {
	return {
		x: pos?.x ?? 0,
		y: pos?.y ?? 0,
		h: pos?.h ?? 0,
	};
}

export const scenarioPlacementsV250Migration: Migration = {
	version: "2.5.0",
	migrate: (data: unknown) => {
		const campaign = data as any;

		if (!Array.isArray(campaign?.Scenarios)) return campaign;

		// Character identity order used by capture at the time these scenarios
		// were saved: on-field characters first, then the roster.
		const characterIds: string[] = [
			...(Array.isArray(campaign.GameState?.Characters)
				? campaign.GameState.Characters
				: []),
			...(Array.isArray(campaign.CharacterRoster)
				? campaign.CharacterRoster
				: []),
		].map((c: any) => c?.Id);

		for (const scenario of campaign.Scenarios) {
			if (!scenario || typeof scenario !== "object") continue;

			// Already migrated — leave it alone.
			if (Array.isArray(scenario.ActorPlacements)) {
				delete scenario.EntityPlacements;
				delete scenario.ItemPlacements;
				delete scenario.SpawnPositions;
				continue;
			}

			const placements: any[] = [];

			for (const ep of scenario.EntityPlacements ?? []) {
				if (!ep) continue;
				placements.push({
					Type: "entity",
					ActorId: newId(),
					TemplateId: ep.EntityTemplateId,
					Position: clonePosition(ep.Position),
				});
			}

			for (const ip of scenario.ItemPlacements ?? []) {
				if (!ip) continue;
				placements.push({
					Type: "item",
					ActorId: newId(),
					TemplateId: ip.ItemTemplateId,
					UsesLeft: ip.UsesLeft,
					Position: clonePosition(ip.Position),
				});
			}

			const spawnPositions: any[] = Array.isArray(scenario.SpawnPositions)
				? scenario.SpawnPositions
				: [];
			spawnPositions.forEach((pos: any, i: number) => {
				const actorId = characterIds[i];
				// Drop positions we cannot tie to a character identity.
				if (!actorId) return;
				placements.push({
					Type: "character",
					ActorId: actorId,
					Position: clonePosition(pos),
				});
			});

			scenario.ActorPlacements = placements;
			delete scenario.EntityPlacements;
			delete scenario.ItemPlacements;
			delete scenario.SpawnPositions;
		}

		return campaign;
	},
};
