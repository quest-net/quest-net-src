// domains/VoxelTerrain/VoxelTerrain.ts

/**
 * A single cube in the terrain-local voxel grid.
 * Coordinates are integer subcell indices: x/z are the horizontal plane,
 * y is elevation (0 = lowest terrain subcell, stacks upward).
 *
 * VoxelTerrain.Resolution controls how many voxels fit inside one tactical
 * map unit. A resolution of 3 means each voxel is 1/3 x 1/3 x 1/3 of an
 * actor/grid cell.
 */
export interface Voxel {
	x: number;     // voxel column
	y: number;     // voxel elevation
	z: number;     // voxel row
	color: number; // terrain palette index (0-255)
}

export interface VoxelTerrainLighting {
	Color: string;      // CSS hex color for the directional light
	Intensity: number;  // renderer intensity multiplier
	Rotation: number;   // degrees around the map; user-facing azimuth
	Elevation: number;  // degrees above the horizon
}

export interface VoxelTerrainBackground {
	Color?: string; // unset means transparent
}

/**
 * A voxel-based terrain stored as a compact base64-encoded Uint32Array.
 * See VoxelDataUtils for encoding details.
 *
 * Width/Length/Height remain tactical map units so actor coordinates and
 * gameplay rules don't need to scale when terrain resolution rises.
 * Voxel coordinates are stored in subcells under Resolution.
 */
/**
 * The maximum height (in tactical units) the movement cost system accounts for.
 * Matches MAX_VOXEL_TERRAIN_HEIGHT in VoxelTerrainEditorUtils. Used for
 * height-cost formula validation and UI previews.
 */
export const MAX_HEIGHT = 64;

export const DEFAULT_VOXEL_TERRAIN_LIGHTING: VoxelTerrainLighting = {
	Color: "#ffffff",
	Intensity: 1.15,
	Rotation: 321,
	Elevation: 51,
};

export const DEFAULT_VOXEL_TERRAIN_BACKGROUND: VoxelTerrainBackground = {};
export const DEFAULT_VOXEL_TERRAIN_BACKGROUND_COLOR = "#0f172a";

export function createDefaultVoxelTerrainLighting(): VoxelTerrainLighting {
	return { ...DEFAULT_VOXEL_TERRAIN_LIGHTING };
}

export function createDefaultVoxelTerrainBackground(): VoxelTerrainBackground {
	return { ...DEFAULT_VOXEL_TERRAIN_BACKGROUND };
}

export interface VoxelTerrain {
	Id: string;
	Name: string;
	Width: number;       // X extent in tactical units
	Length: number;      // Z extent in tactical units
	Height: number;      // Y extent in tactical units
	Resolution?: number; // voxels per tactical unit; defaults to 1 for older saves
	Voxels: string;      // base64-encoded sorted Uint32Array when loaded (see VoxelDataUtils)
	VoxelsLoaded?: boolean;
	VoxelStorageKey?: string;
	VoxelCount?: number;
	Lighting: VoxelTerrainLighting;
	Background: VoxelTerrainBackground;
	PreviewColor?: string;
	Tags?: string[];
}
