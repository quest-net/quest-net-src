// src/migrations/v2_4_0_terrainEnvironmentPresets.ts
//
// Moves terrain environment presets into campaign settings.

import type { Migration } from "./types";

const DEFAULT_TERRAIN_ENVIRONMENT_PRESETS = [
	{
		Id: "neutral",
		Name: "Neutral",
		Lighting: {
			Color: "#ffffff",
			Intensity: 1.15,
			Rotation: 321,
			Elevation: 51,
		},
		Background: {},
	},
	{
		Id: "nighttime",
		Name: "Nighttime",
		Lighting: {
			Color: "#7aa7ff",
			Intensity: 0.58,
			Rotation: 35,
			Elevation: 30,
		},
		Background: { Color: "#07111f" },
	},
	{
		Id: "daytime",
		Name: "Daytime",
		Lighting: {
			Color: "#fff4d6",
			Intensity: 1.35,
			Rotation: 300,
			Elevation: 62,
		},
		Background: { Color: "#9bd8ff" },
	},
	{
		Id: "sunset",
		Name: "Sunset",
		Lighting: {
			Color: "#ff7a3d",
			Intensity: 1.15,
			Rotation: 252,
			Elevation: 18,
		},
		Background: { Color: "#7c2d6f" },
	},
];

function clonePreset(preset: any): any {
	return {
		Id: preset.Id,
		Name: preset.Name,
		Lighting: { ...preset.Lighting },
		Background: { ...preset.Background },
	};
}

function hasPresetId(presets: any[], id: string): boolean {
	return presets.some(
		(preset) => preset && typeof preset === "object" && preset.Id === id
	);
}

export const terrainEnvironmentPresetsV240Migration: Migration = {
	version: "2.4.0",
	migrate: (data: unknown) => {
		const campaign = data as any;

		if (!campaign.Settings || typeof campaign.Settings !== "object") {
			campaign.Settings = {};
		}

		if (!Array.isArray(campaign.Settings.TerrainEnvironmentPresets)) {
			campaign.Settings.TerrainEnvironmentPresets =
				DEFAULT_TERRAIN_ENVIRONMENT_PRESETS.map(clonePreset);
			return campaign;
		}

		for (const preset of DEFAULT_TERRAIN_ENVIRONMENT_PRESETS) {
			if (!hasPresetId(campaign.Settings.TerrainEnvironmentPresets, preset.Id)) {
				campaign.Settings.TerrainEnvironmentPresets.push(clonePreset(preset));
			}
		}

		return campaign;
	},
};
