// src/migrations/campaignMigrations.ts
import type { Migration } from "./types";
import { terrainPaletteV190Migration } from "./v1_9_0_terrainPalette";
import { actorColorsV200Migration } from "./v2_0_0_actorColors";
import { initiativeRenameV210Migration } from "./v2_1_0_initiativeRename";
import { terrainEnvironmentV220Migration } from "./v2_2_0_terrainEnvironment";
import { voxelSVOV230Migration } from "./v2_3_0_voxelSVO";
import { terrainEnvironmentPresetsV240Migration } from "./v2_4_0_terrainEnvironmentPresets";
import { scenarioPlacementsV250Migration } from "./v2_5_0_scenarioPlacements";
import { perActorTerrainV260Migration } from "./v2_6_0_perActorTerrain";
import { terrainContentHashV270Migration } from "./v2_7_0_terrainContentHash";
import { terrainLinksV280Migration } from "./v2_8_0_terrainLinks";
import { defaultInitiativeV290Migration } from "./v2_9_0_defaultInitiative";
import { removeStatOverflowV290Migration } from "./v2_9_0_removeStatOverflow";
import { voxelBytesV2100Migration } from "./v2_10_0_voxelBytes";
import { terrainOpfsV2110Migration } from "./v2_11_0_terrainOpfs";

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
	voxelSVOV230Migration,
	terrainEnvironmentPresetsV240Migration,
	scenarioPlacementsV250Migration,
	perActorTerrainV260Migration,
	terrainContentHashV270Migration,
	terrainLinksV280Migration,
	defaultInitiativeV290Migration,
	removeStatOverflowV290Migration,
	voxelBytesV2100Migration,
	terrainOpfsV2110Migration,
];
