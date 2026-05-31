import type * as THREE from 'three';
import type { VoxelAoTexture } from '../shaders/voxelAoShader';

// ---------------------------------------------------------------------------
// MovementHighlight resource
// ---------------------------------------------------------------------------

export interface MovementHighlightTexture {
	texture: THREE.Data3DTexture;
	data: Uint8Array;
	width: number;
	heightLevels: number;
	length: number;
}

// ---------------------------------------------------------------------------
// Material factory contract
// ---------------------------------------------------------------------------

export interface MaterialFactoryParams {
	/**
	 * True for world-view meshes (movement highlight overlay applied).
	 * False for first-person-view meshes (AO only, no highlight).
	 * Must match the acceptsMovementHighlight flag used in customProgramCacheKey.
	 */
	acceptsMovementHighlight: boolean;
	/** Enables lower-cost shader variants while preserving material semantics. */
	performanceMode?: boolean;
	/** Required when acceptsMovementHighlight is true. */
	movementHighlight?: MovementHighlightTexture;
	/**
	 * Voxel-occupancy sampler used by every material's per-fragment AO shader.
	 * Required (even for pre-warm) -- the placeholder texture returned by
	 * `createPlaceholderVoxelAoTexture()` is fine when no terrain is loaded.
	 */
	voxelAo: VoxelAoTexture;
}

export interface MaterialFactoryResult {
	material: THREE.MeshStandardMaterial;
	/** Registered into scene animationCallbacks for time-based effects (e.g. water). */
	onAnimationFrame?: (timeMs: number) => void;
	castShadow: boolean;
	receiveShadow: boolean;
	/**
	 * Three.js renderOrder for the mesh. Transparent meshes (e.g. water) use
	 * renderOrder > 0 so they draw after all opaque terrain meshes.
	 * Defaults to 0 when not set.
	 */
	renderOrder?: number;
}

export type MaterialFactory = (params: MaterialFactoryParams) => MaterialFactoryResult;

export interface TerrainMaterialGeometry {
	/**
	 * Emits the vertex color attribute. Defaults to true for palette-colored
	 * terrain; special materials that fully shade themselves can disable it.
	 */
	vertexColors?: boolean;
	/**
	 * Emit one quad per exposed voxel face instead of greedy-merging adjacent
	 * faces. Use when a material's shader relies on voxel-resolution edges.
	 */
	preserveVoxelFaces?: boolean;
	/**
	 * Emits the surfaceDeformStrength attribute. Top faces receive 1.0; exposed
	 * side top edges also receive 1.0 so animated surfaces stay sealed to sides.
	 */
	deformSurface?: boolean;
}

// ---------------------------------------------------------------------------
// Per-material definition
//
// Each material file (defaultMaterial.ts, waterMaterial.ts, ...) default-exports
// one of these. materials/index.ts collects them and derives every lookup the
// rest of the app needs (bucket dispatch, editor swatches, factory registry,
// pre-warm coverage).
//
// Factories MUST NOT set customProgramCacheKey themselves -- the registry
// wraps the factory and sets a stable key derived from bucketKey, shaderVersion,
// and the highlight flag. Bumping shaderVersion is how a designer invalidates
// the program cache after editing a material's shader source.
// ---------------------------------------------------------------------------

/**
 * Editor grouping for special-material swatches. Materials that omit a category
 * (or any future value not listed here) fall into "miscellaneous". The order of
 * this union is also the order categories are rendered in the editor.
 */
export type MaterialCategory =
	| "buildings"
	| "liquids"
	| "nature"
	| "metals"
	| "miscellaneous";

export interface TerrainMaterial {
	/** Bucket key. Must be unique across all materials. */
	bucketKey: string;
	/**
	 * Shared-face culling group. Neighboring voxels with the same occlusion
	 * group hide their shared face even when they render in different buckets.
	 * Defaults to bucketKey when omitted.
	 */
	occlusionGroup?: string;
	/** Bump when the material's shader source changes (drives the program cache key). */
	shaderVersion: number;
	/** Optional geometry-builder hints for materials that need extra vertices. */
	geometry?: TerrainMaterialGeometry;
	/**
	 * When true, voxels of this material do not participate in collision: they
	 * are invisible to hasVoxel (so raycasts and the first-person capsule pass
	 * through them), never form a walkable surface, and never count as occupying
	 * a tile for movement / flight / placement clearance. They still render
	 * normally -- geometry reads the palette color directly, not hasVoxel.
	 * Defaults to false.
	 */
	passable?: boolean;
	/**
	 * When true, this material is NOT rendered as a surface mesh. Its voxels are
	 * excluded from the greedy-meshed render buckets and from the AO occupancy
	 * snapshot, and instead feed a fog-density 3D volume consumed by the
	 * screen-space volumetric fog pass (see mapVolumetricFog). The `factory`
	 * below is therefore only exercised by the shader pre-warm; it is never used
	 * to draw real terrain. Such materials should also be `passable`.
	 * Defaults to false.
	 */
	volumetric?: boolean;
	/** Factory that builds the THREE.MeshStandardMaterial for this bucket. */
	factory: MaterialFactory;
	/**
	 * Present iff this material is a special palette entry (240-255). The default
	 * material has no palette index. Special materials show as a swatch in the
	 * voxel editor and dispatch via getMaterialBucket(paletteIndex).
	 */
	special?: {
		/** Palette index 240-255. Must be unique across all special materials. */
		paletteIndex: number;
		/** Human-readable name shown as a tooltip in the editor. */
		label: string;
		/** Hex color used for the editor swatch and the in-game material tint. */
		swatchColor: string;
		/**
		 * Editor swatch grouping. Omit to fall into the "miscellaneous" row.
		 */
		category?: MaterialCategory;
	};
}
