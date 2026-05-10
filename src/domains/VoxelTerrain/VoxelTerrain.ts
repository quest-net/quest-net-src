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
	PreviewColor?: string;
	Tags?: string[];
}
