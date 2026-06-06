// src/migrations/v2_6_0_perActorTerrain.ts
//
// Multi-terrain worlds: terrain becomes a per-actor property of Position rather
// than a single GameState pointer.
//
// - Every Position (Characters, Entities, and their TurnStartPosition snapshots)
//   is stamped with terrainId = old GameState.VoxelTerrainId.
// - Each scenario's ActorPlacement.Position is stamped from scenario.TerrainId,
//   then scenario.TerrainId is dropped (redundant once placements carry it).
// - GameState.VoxelTerrainId is removed.

import type { Migration } from "./types";

function stampPosition(position: any, terrainId: string): void {
	if (position && typeof position === "object" && typeof position.terrainId !== "string") {
		position.terrainId = terrainId;
	}
}

function stampActor(actor: any, terrainId: string): void {
	if (!actor || typeof actor !== "object") return;
	stampPosition(actor.Position, terrainId);
	stampPosition(actor.TurnStartPosition, terrainId);
}

export const perActorTerrainV260Migration: Migration = {
	version: "2.6.0",
	migrate: (data: unknown) => {
		const campaign = data as any;
		if (!campaign || typeof campaign !== "object") return campaign;

		const gameState = campaign.GameState;

		// The terrain every existing on-field actor currently lives in. Fall back
		// to the first terrain in the list if the old pointer is somehow missing.
		const fallbackTerrainId: string =
			gameState?.VoxelTerrainId ??
			(Array.isArray(campaign.VoxelTerrains) ? campaign.VoxelTerrains[0]?.Id : undefined) ??
			"";

		if (gameState && typeof gameState === "object") {
			for (const actor of Array.isArray(gameState.Characters) ? gameState.Characters : []) {
				stampActor(actor, fallbackTerrainId);
			}
			for (const actor of Array.isArray(gameState.Entities) ? gameState.Entities : []) {
				stampActor(actor, fallbackTerrainId);
			}
			delete gameState.VoxelTerrainId;
		}

		for (const scenario of Array.isArray(campaign.Scenarios) ? campaign.Scenarios : []) {
			if (!scenario || typeof scenario !== "object") continue;
			const scenarioTerrainId: string = scenario.TerrainId ?? fallbackTerrainId;
			for (const placement of Array.isArray(scenario.ActorPlacements)
				? scenario.ActorPlacements
				: []) {
				stampPosition(placement?.Position, scenarioTerrainId);
			}
			delete scenario.TerrainId;
		}

		return campaign;
	},
};
