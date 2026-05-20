// src/migrations/campaignMigrations.ts
import type { Migration } from "./types";
import { terrainPaletteV190Migration } from "./v1_9_0_terrainPalette";
import { actorColorsV200Migration } from "./v2_0_0_actorColors";
import { initiativeRenameV210Migration } from "./v2_1_0_initiativeRename";
import { terrainEnvironmentV220Migration } from "./v2_2_0_terrainEnvironment";

/**
 * Ordered list of campaign-level migrations, sorted ascending by version.
 * Each entry runs when a stored campaign's version is older than the migration's
 * target version. Add new entries in ascending version order.
 */
export const campaignMigrations: Migration[] = [
	terrainPaletteV190Migration,
	actorColorsV200Migration,
	initiativeRenameV210Migration,
	terrainEnvironmentV220Migration,
];
