import { Context } from "../domains/Context/Context";
import { VersionedMigration } from "./types";

type TerrainType =
    | "green"
    | "white"
    | "blue"
    | "yellow"
    | "brown"
    | "red"
    | "grey"
    | "black"
    | "orange"
    | "purple"
    | "cyan"
    | "pink";

const TERRAIN_TYPES: readonly TerrainType[] = [
    "green",
    "white",
    "blue",
    "yellow",
    "brown",
    "red",
    "grey",
    "black",
    "orange",
    "purple",
    "cyan",
    "pink",
] as const;

// Legacy terrain type with string-based ColorMap (pre-1.0.6)
interface LegacyTerrain {
    Id: string;
    Name: string;
    Width: number;
    Length: number;
    HeightMap: number[][];
    ColorMap: TerrainType[][]; // Old string-based format
    Tags?: string[];
}

// Convert TerrainType string to index
function terrainTypeToIndex(type: TerrainType | string): number {
    const idx = TERRAIN_TYPES.indexOf(type as TerrainType);
    return idx >= 0 ? idx : 6; // Default to grey (index 6)
}

// Convert index to TerrainType string
function indexToTerrainType(index: number): TerrainType {
    return TERRAIN_TYPES[index] ?? "grey";
}

export const migration_1_0_6: VersionedMigration = {
    version: "1.0.6",
    update: (context: Context): Context => {
        // Migrate all terrains in all campaigns from string ColorMap to number ColorMap
        const updatedCampaigns = context.Campaigns.map(campaign => ({
            ...campaign,
            Terrains: campaign.Terrains.map(terrain => {
                const legacyTerrain = terrain as unknown as LegacyTerrain;

                // Check if already migrated (ColorMap contains numbers)
                if (
                    legacyTerrain.ColorMap?.[0]?.[0] !== undefined &&
                    typeof legacyTerrain.ColorMap[0][0] === "number"
                ) {
                    return terrain; // Already migrated
                }

                // Convert string ColorMap to numeric indices
                const newColorMap: number[][] = legacyTerrain.ColorMap?.map(row =>
                    row.map(cell => terrainTypeToIndex(cell))
                ) ?? [];

                return {
                    ...terrain,
                    ColorMap: newColorMap,
                };
            }),
        }));

        return {
            ...context,
            Campaigns: updatedCampaigns,
            version: "1.0.6",
        };
    },
    reset: (context: Context): Context => {
        // Downgrade: convert numeric ColorMap back to string ColorMap
        const downgradedCampaigns = context.Campaigns.map(campaign => ({
            ...campaign,
            Terrains: campaign.Terrains.map(terrain => {
                const numericTerrain = terrain;

                // Check if already downgraded (ColorMap contains strings)
                if (
                    numericTerrain.ColorMap?.[0]?.[0] !== undefined &&
                    typeof numericTerrain.ColorMap[0][0] === "string"
                ) {
                    return terrain; // Already downgraded
                }

                // Convert numeric ColorMap back to string
                const legacyColorMap: TerrainType[][] = numericTerrain.ColorMap?.map(row =>
                    row.map(cell => indexToTerrainType(cell as number))
                ) ?? [];

                return {
                    ...terrain,
                    ColorMap: legacyColorMap as unknown as number[][],
                };
            }),
        }));

        return {
            ...context,
            Campaigns: downgradedCampaigns,
            version: "1.0.5",
        };
    },
};
