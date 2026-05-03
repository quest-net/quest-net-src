// updates/update-1.8.0.ts
//
// Converts legacy Terrain objects (HeightMap/ColorMap heightmap grids) into
// VoxelTerrain objects stored as compact base64-encoded Uint32Arrays.
//
// Conversion rules:
//   Resolution = 2  (each legacy tile -> 2x2 voxel columns)
//   Y:   1 legacy height unit = 1 voxel  (1:1), with legacy 0 treated as 1
//   X/Z: 1 legacy tile       = 2 voxels (1:2)
//   VoxelTerrain.Height = MAX_LEGACY_HEIGHT / Resolution = 16 / 2 = 8 tactical units

import { type Context } from "../domains/Context/Context";
import { type VersionedMigration } from "./types";
import { type Voxel } from "../domains/VoxelTerrain/VoxelTerrain";
import { encodeVoxels } from "../utils/VoxelDataUtils";
import { normalizeVoxelPaletteIndex } from "../utils/VoxelTerrainEditorUtils";

const RESOLUTION = 2;
const VOXEL_HEIGHT = 8; // tactical units = legacy MAX_HEIGHT / RESOLUTION
const HEIGHT_SCALE = 1 / RESOLUTION;
const MIN_LEGACY_TERRAIN_HEIGHT = 1;

function looksLikeFullCampaign(campaign: any): boolean {
	return (
		campaign &&
		typeof campaign === "object" &&
		Array.isArray(campaign.Terrains) &&
		campaign.GameState &&
		typeof campaign.GameState === "object"
	);
}

function legacyTerrainToVoxelTerrain(legacy: any): any {
	const width: number = legacy.Width ?? (legacy.ColorMap?.[0]?.length ?? 0);
	const length: number = legacy.Length ?? (legacy.ColorMap?.length ?? 0);
	const heightMap: number[][] = legacy.HeightMap ?? [];
	const colorMap: number[][] = legacy.ColorMap ?? [];

	const voxels: Voxel[] = [];

	for (let tileZ = 0; tileZ < length; tileZ++) {
		for (let tileX = 0; tileX < width; tileX++) {
			const legacyHeight: number = heightMap[tileZ]?.[tileX] ?? 0;
			const height = Math.max(MIN_LEGACY_TERRAIN_HEIGHT, legacyHeight);
			const color: number = normalizeVoxelPaletteIndex(colorMap[tileZ]?.[tileX] ?? 0);

			for (let subZ = 0; subZ < RESOLUTION; subZ++) {
				for (let subX = 0; subX < RESOLUTION; subX++) {
					for (let y = 0; y < height; y++) {
						voxels.push({
							x: tileX * RESOLUTION + subX,
							y,
							z: tileZ * RESOLUTION + subZ,
							color,
						});
					}
				}
			}
		}
	}

	return {
		Id: legacy.Id,
		Name: legacy.Name,
		Width: width,
		Length: length,
		Height: VOXEL_HEIGHT,
		Resolution: RESOLUTION,
		Voxels: encodeVoxels(voxels),
		Tags: legacy.Tags,
	};
}

function scalePositionHeight(position: any, scale: number): void {
	if (!position || typeof position !== "object") return;
	if (typeof position.h !== "number") return;

	position.h *= scale;
}

function scaleActorHeight(actor: any, scale: number): void {
	if (!actor || typeof actor !== "object") return;

	scalePositionHeight(actor.Position, scale);
	scalePositionHeight(actor.TurnStartPosition, scale);
}

function scaleCampaignPositionHeights(campaign: any, scale: number): void {
	for (const actor of campaign.CharacterRoster ?? []) {
		scaleActorHeight(actor, scale);
	}
	for (const actor of campaign.EntityTemplates ?? []) {
		scaleActorHeight(actor, scale);
	}
	for (const actor of campaign.GameState?.Characters ?? []) {
		scaleActorHeight(actor, scale);
	}
	for (const actor of campaign.GameState?.Entities ?? []) {
		scaleActorHeight(actor, scale);
	}
	for (const scenario of campaign.Scenarios ?? []) {
		for (const position of scenario.SpawnPositions ?? []) {
			scalePositionHeight(position, scale);
		}
		for (const placement of scenario.EntityPlacements ?? []) {
			scalePositionHeight(placement?.Position, scale);
		}
	}
}

function migrateCampaignTerrains(campaign: any): void {
	if (!looksLikeFullCampaign(campaign)) return;

	const legacyTerrains: any[] = campaign.Terrains ?? [];
	scaleCampaignPositionHeights(campaign, HEIGHT_SCALE);

	if (!Array.isArray(campaign.VoxelTerrains)) {
		campaign.VoxelTerrains = [];
	}

	for (const legacy of legacyTerrains) {
		if (!legacy?.Id) continue;
		if (campaign.VoxelTerrains.some((terrain: any) => terrain.Id === legacy.Id)) {
			continue;
		}

		campaign.VoxelTerrains.push(legacyTerrainToVoxelTerrain(legacy));
	}

	if (!campaign.GameState.VoxelTerrainId) {
		const activeLegacyTerrainId = campaign.GameState.TerrainId;
		const matchingTerrain =
			campaign.VoxelTerrains.find(
				(terrain: any) => terrain.Id === activeLegacyTerrainId
			) ?? campaign.VoxelTerrains[0];

		if (matchingTerrain) {
			campaign.GameState.VoxelTerrainId = matchingTerrain.Id;
		}
	}
}

export const migration_1_8_0: VersionedMigration = {
	version: "1.8.0",

	update: (context: Context): Context => {
		for (const campaign of context.Campaigns ?? []) {
			migrateCampaignTerrains(campaign);
		}
		migrateCampaignTerrains((context as any).ActiveCampaign);

		return { ...context, version: "1.8.0" };
	},

	reset: (context: Context): Context => {
		for (const campaign of context.Campaigns ?? []) {
			if (!looksLikeFullCampaign(campaign)) continue;
			delete (campaign as any).VoxelTerrains;
			delete (campaign as any).GameState.VoxelTerrainId;
		}

		if (looksLikeFullCampaign((context as any).ActiveCampaign)) {
			delete (context as any).ActiveCampaign.VoxelTerrains;
			delete (context as any).ActiveCampaign.GameState.VoxelTerrainId;
		}

		return { ...context, version: "1.7.0" };
	},
};
