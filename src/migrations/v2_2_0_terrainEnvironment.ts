// src/migrations/v2_2_0_terrainEnvironment.ts
//
// Adds persisted voxel terrain lighting and background color settings.

import type { Migration } from "./types";

const DEFAULT_LIGHTING = {
	Color: "#ffffff",
	Intensity: 1.15,
	Rotation: 321,
	Elevation: 51,
};

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function normalizeHexColor(value: unknown, fallback: string): string {
	return typeof value === "string" && HEX_COLOR_PATTERN.test(value)
		? value
		: fallback;
}

function normalizeOptionalHexColor(value: unknown): string | undefined {
	return typeof value === "string" && HEX_COLOR_PATTERN.test(value)
		? value
		: undefined;
}

function normalizeNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeTerrainEnvironment(terrain: any): void {
	if (!terrain || typeof terrain !== "object") return;

	const lighting = terrain.Lighting;
	terrain.Lighting = {
		Color: normalizeHexColor(lighting?.Color, DEFAULT_LIGHTING.Color),
		Intensity: normalizeNumber(lighting?.Intensity, DEFAULT_LIGHTING.Intensity),
		Rotation: normalizeNumber(lighting?.Rotation, DEFAULT_LIGHTING.Rotation),
		Elevation: normalizeNumber(lighting?.Elevation, DEFAULT_LIGHTING.Elevation),
	};

	const backgroundColor = normalizeOptionalHexColor(terrain.Background?.Color);
	terrain.Background = backgroundColor ? { Color: backgroundColor } : {};
}

export const terrainEnvironmentV220Migration: Migration = {
	version: "2.2.0",
	migrate: (data: unknown) => {
		const campaign = data as any;

		for (const terrain of campaign.VoxelTerrains ?? []) {
			normalizeTerrainEnvironment(terrain);
		}

		return campaign;
	},
};
