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
 * Decorative flat plane extending outward from the terrain's footprint.
 * Purely visual -- no hitbox, no movement/raycast participation. Absent on the
 * terrain means disabled (same convention as Background.Color).
 */
export interface VoxelTerrainSurroundings {
	/**
	 * Tactical units above the terrain base (0..Height). May be fractional in
	 * voxel steps (multiples of 1/Resolution) so the plane can sit partway up a
	 * tactical cell -- e.g. a waterline lapping a hull. Stored in tactical
	 * units so the value is resolution-independent; the editor displays and
	 * edits it as whole voxel layers (Height * Resolution), matching the
	 * app-wide height convention.
	 */
	Height: number;
	ColorIndex: number; // terrain palette index (0-255); 240+ picks a special material
}

/**
 * The maximum height (in tactical units) the movement cost system accounts for.
 * Matches MAX_VOXEL_TERRAIN_HEIGHT in VoxelTerrainEditorUtils. Used for
 * height-cost formula validation and UI previews.
 */
export const MAX_HEIGHT = 64;

/**
 * Voxels per tactical unit assumed when a terrain predates the resolution field
 * (and the floor every terrain's resolution is clamped up to).
 */
export const DEFAULT_TERRAIN_RESOLUTION = 1;

/** Tactical units above the surface a flyer spawns at. */
export const FLYING_SPAWN_ELEVATION = 2;

export const DEFAULT_VOXEL_TERRAIN_LIGHTING: VoxelTerrainLighting = {
	Color: "#ffffff",
	Intensity: 1.15,
	Rotation: 321,
	Elevation: 51,
};

export const DEFAULT_VOXEL_TERRAIN_BACKGROUND: VoxelTerrainBackground = {};
export const DEFAULT_VOXEL_TERRAIN_BACKGROUND_COLOR = "#0f172a";

// Starting values when the DM first enables surroundings: grass at terrain base.
export const DEFAULT_VOXEL_TERRAIN_SURROUNDINGS: VoxelTerrainSurroundings = {
	Height: 0,
	ColorIndex: 242,
};

export const VOXEL_TERRAIN_ENVIRONMENT_PRESET_IDS = [
	"neutral",
	"nighttime",
	"daytime",
	"sunset",
] as const;

export type VoxelTerrainEnvironmentPresetId =
	(typeof VOXEL_TERRAIN_ENVIRONMENT_PRESET_IDS)[number];

export interface VoxelTerrainEnvironmentPreset {
	Id: string;
	Name: string;
	Lighting: VoxelTerrainLighting;
	Background: VoxelTerrainBackground;
}

export const VOXEL_TERRAIN_ENVIRONMENT_PRESETS: Record<
	VoxelTerrainEnvironmentPresetId,
	VoxelTerrainEnvironmentPreset
> = {
	neutral: {
		Id: "neutral",
		Name: "Neutral",
		Lighting: { ...DEFAULT_VOXEL_TERRAIN_LIGHTING },
		Background: { ...DEFAULT_VOXEL_TERRAIN_BACKGROUND },
	},
	nighttime: {
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
	daytime: {
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
	sunset: {
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
};

export function createDefaultVoxelTerrainLighting(): VoxelTerrainLighting {
	return { ...DEFAULT_VOXEL_TERRAIN_LIGHTING };
}

export function createDefaultVoxelTerrainBackground(): VoxelTerrainBackground {
	return { ...DEFAULT_VOXEL_TERRAIN_BACKGROUND };
}

export function cloneVoxelTerrainEnvironmentPreset(
	preset: VoxelTerrainEnvironmentPreset
): VoxelTerrainEnvironmentPreset {
	return {
		Id: preset.Id,
		Name: preset.Name,
		Lighting: { ...preset.Lighting },
		Background: { ...preset.Background },
	};
}

export function createDefaultVoxelTerrainEnvironmentPresets(): VoxelTerrainEnvironmentPreset[] {
	return VOXEL_TERRAIN_ENVIRONMENT_PRESET_IDS.map((presetId) =>
		cloneVoxelTerrainEnvironmentPreset(
			VOXEL_TERRAIN_ENVIRONMENT_PRESETS[presetId]
		)
	);
}

export function createVoxelTerrainEnvironmentPreset(
	presetId: VoxelTerrainEnvironmentPresetId
): Pick<VoxelTerrain, "Lighting" | "Background"> {
	const preset = VOXEL_TERRAIN_ENVIRONMENT_PRESETS[presetId];
	return {
		Lighting: { ...preset.Lighting },
		Background: { ...preset.Background },
	};
}

/**
 * A voxel terrain's encoded payload: the raw bytes of a Sparse Voxel Octree.
 * This is the canonical in-memory and at-rest form. base64 survives only at text
 * boundaries (JSON export/import, source-embedded stamp constants, and a
 * back-compat shim for IndexedDB records written by older builds).
 */
export type EncodedVoxelSVO = Uint8Array;

/**
 * A voxel-based terrain stored as a Sparse Voxel Octree (raw SVO bytes).
 *
 * Width/Length/Height remain tactical map units so actor coordinates and
 * gameplay rules don't need to scale when terrain resolution rises.
 * Voxel coordinates are stored in subcells under Resolution.
 */
export interface VoxelTerrain {
	Id: string;
	Name: string;
	Width: number;       // X extent in tactical units
	Length: number;      // Z extent in tactical units
	Height: number;      // Y extent in tactical units
	Resolution?: number; // voxels per tactical unit; defaults to 1 for older saves
	/**
	 * Content-identity token for this terrain's voxel payload (see
	 * `hashVoxels`). The payload itself is NOT a field on the synced campaign
	 * object — it lives per-client in `TerrainPayloadStore` (in-memory) and
	 * IndexedDB. `ContentHash` is what travels through state sync; a client
	 * compares it against its cached payload to decide whether to (re)fetch.
	 * Optional only for older saves prior to the 2.7.0 migration / empty terrains.
	 */
	ContentHash?: string;
	Lighting: VoxelTerrainLighting;
	Background: VoxelTerrainBackground;
	/**
	 * Decorative surroundings plane config; absent = disabled. Deliberately NOT
	 * part of environment presets -- applying a preset leaves this untouched.
	 */
	Surroundings?: VoxelTerrainSurroundings;
	PreviewColor?: string;
	Tags?: string[];
}

/**
 * A VoxelTerrain plus its decoded voxel payload, used only by transient,
 * client-local pipelines that work on *uncommitted* voxels: the terrain editor
 * and stamp sources. The canonical `VoxelTerrain` deliberately omits `Voxels`
 * so the payload can never ride along on the synced/diffed campaign object;
 * code that needs the payload either reads it from `TerrainPayloadStore` (for
 * committed terrains) or carries an `EditableVoxelTerrain` explicitly.
 */
export type EditableVoxelTerrain = VoxelTerrain & { Voxels: EncodedVoxelSVO };
