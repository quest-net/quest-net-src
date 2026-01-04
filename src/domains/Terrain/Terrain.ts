export interface Terrain {
	Id: string;
	Name: string;
	Width: number; // number of tiles wide
	Length: number; // number of tiles long
	HeightMap: number[][]; // elevation values [y][x]
	ColorMap: number[][]; // terrain type indices [y][x] - index into TERRAIN_TYPES
	Tags?: string[];
}

export const MAX_HEIGHT = 16;

// Predefined terrain types (order matters - indices are stored in ColorMap)
export type TerrainType =
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

/**
 * Ordered array of terrain types - indices used in ColorMap
 * DO NOT reorder this array as it would break existing terrains
 */
export const TERRAIN_TYPES: readonly TerrainType[] = [
	"green",  // 0
	"white",  // 1
	"blue",   // 2
	"yellow", // 3
	"brown",  // 4
	"red",    // 5
	"grey",   // 6
	"black",  // 7
	"orange", // 8
	"purple", // 9
	"cyan",   // 10
	"pink",   // 11
] as const;

/**
 * Color constants for terrain types
 * These colors are chosen to be readable in both light and dark themes
 */
export const TERRAIN_COLORS: Record<TerrainType, string> = {
	green: "#22c55e", // Emerald-500 - grass, forest
	white: "#f5f5f5", // Neutral-100 - snow, clouds
	blue: "#3b82f6", // Blue-500 - water, ice
	yellow: "#eab308", // Yellow-500 - sand, light
	brown: "#92400e", // Amber-800 - dirt, wood
	red: "#ef4444", // Red-500 - lava, danger
	grey: "#6b7280", // Gray-500 - stone, rock
	black: "#1f2937", // Gray-800 - void, shadow

	// Extended palette
	orange: "#f97316", // Orange-500
	purple: "#a855f7", // Purple-500
	cyan: "#06b6d4", // Cyan-500
	pink: "#ec4899", // Pink-500
};

/** Get TerrainType from index (defaults to "grey" for invalid indices) */
export function getTerrainType(index: number): TerrainType {
	return TERRAIN_TYPES[index] ?? "grey";
}

/** Get index from TerrainType (defaults to 6 for "grey" if not found) */
export function getTerrainIndex(type: TerrainType): number {
	const idx = TERRAIN_TYPES.indexOf(type);
	return idx >= 0 ? idx : 6; // Default to grey (index 6)
}

/** Get hex color from index */
export function getTerrainColorByIndex(index: number): string {
	return TERRAIN_COLORS[getTerrainType(index)];
}
