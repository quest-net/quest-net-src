export interface Terrain {
  Id: string;
  Name: string;
  Width: number;   // number of tiles wide
  Length: number;  // number of tiles long
  HeightMap: number[][];   // elevation values [y][x]
  ColorMap: TerrainType[][]; // terrain type keys [y][x]
  Tags?: string[];
}

// Predefined colors
export type TerrainType = 
  | 'green'
  | 'white' 
  | 'blue'
  | 'yellow'
  | 'brown'
  | 'red'
  | 'grey'
  | 'black';

  /**
 * Color constants for terrain types
 * These colors are chosen to be readable in both light and dark themes
 */
export const TERRAIN_COLORS: Record<TerrainType, string> = {
  green: '#22c55e',   // Emerald-500 - grass, forest
  white: '#f5f5f5',   // Neutral-100 - snow, clouds
  blue: '#3b82f6',    // Blue-500 - water, ice
  yellow: '#eab308',  // Yellow-500 - sand, light
  brown: '#92400e',   // Amber-800 - dirt, wood
  red: '#ef4444',     // Red-500 - lava, danger
  grey: '#6b7280',    // Gray-500 - stone, rock
  black: '#1f2937'    // Gray-800 - void, shadow
};
