// Terrain materials -- single source of truth.
//
// Each material lives in its own file under this folder (defaultMaterial.ts,
// waterMaterial.ts, ...) and default-exports a TerrainMaterial record. This
// index collects them and derives everything the rest of the app needs:
//
//   - TERRAIN_MATERIAL_REGISTRY:  bucketKey -> wrapped MaterialFactory (used by
//                                 3DMap and FirstPerson terrain renderers and
//                                 by the scene-init pre-warm step).
//   - SPECIAL_MATERIAL_SWATCHES:  palette swatches for the voxel editor's
//                                 "Materials" section (grouped into category
//                                 rows by groupSpecialMaterialSwatches()).
//   - getMaterialBucket(idx):     palette index -> bucket key, used by the
//                                 geometry worker for render bucket assignment.
//   - getMaterialOcclusionGroup:  palette index -> culling group, used by the
//                                 geometry worker to decide shared-face culling.
//
// Adding a new material:
//   1. Create `<name>Material.ts` next to this file, exporting a TerrainMaterial
//      as default.
//   2. Add one import + one entry to TERRAIN_MATERIALS below.
//   That is all. Editor swatch, bucket dispatch, occlusion dispatch, registry,
//   and shader pre-warm coverage are derived automatically.
//
// The registry wraps each factory and stamps a customProgramCacheKey of the
// form `terrain-<bucketKey>-v<shaderVersion>-<hl|nh>`. Materials should NOT set
// their own cache key. Bumping shaderVersion in the material file is the way
// to invalidate cached programs after editing shader source.

import * as THREE from 'three';

import type {
	MaterialCategory,
	MaterialFactory,
	MaterialFactoryParams,
	MaterialFactoryResult,
	TerrainMaterial,
} from './materialTypes';

import defaultMaterial from './defaultMaterial';
import flesh250Material from './flesh250Material';
import fog251Material from './fog251Material';
import glass246Material from './glass246Material';
import gold247Material from './gold247Material';
import grass242Material from './grass242Material';
import ironBars249Material from './ironBars249Material';
import lava245Material from './lava245Material';
import light243Material from './light243Material';
import silver248Material from './silver248Material';
import stoneBricks240Material from './stoneBricks240Material';
import water241Material from './water241Material';
import wood244Material from './wood244Material';

// ---------------------------------------------------------------------------
// Catalogue
//
// Order matters only for human readers; lookups below build maps keyed by
// bucketKey / paletteIndex. The default material is listed first by
// convention -- it is also the fallback for any palette index not claimed by a
// special material.
// ---------------------------------------------------------------------------

export const TERRAIN_MATERIALS: readonly TerrainMaterial[] = [
	defaultMaterial,
	stoneBricks240Material,
	water241Material,
	grass242Material,
	light243Material,
	wood244Material,
	lava245Material,
	glass246Material,
	gold247Material,
	silver248Material,
	ironBars249Material,
	flesh250Material,
	fog251Material,
];

// ---------------------------------------------------------------------------
// Re-exported types (so consumers can import everything from one place)
// ---------------------------------------------------------------------------

export type {
	MaterialCategory,
	MaterialFactory,
	MaterialFactoryParams,
	MaterialFactoryResult,
	MovementHighlightTexture,
	TerrainMaterialGeometry,
	TerrainMaterial,
} from './materialTypes';
export {
	createPlaceholderVoxelAoTexture,
	createVoxelAoTexture,
	type VoxelAoTexture,
} from '../shaders/voxelAoShader';

// ---------------------------------------------------------------------------
// Editor swatch list (special materials only)
// ---------------------------------------------------------------------------

export interface SpecialMaterialSwatch {
	/** Palette index (240-255). */
	index: number;
	/** Human-readable name shown as a tooltip in the editor. */
	label: string;
	/** Hex color used for the editor swatch and the in-game material tint. */
	color: string;
	/** Editor grouping; materials without a category resolve to "miscellaneous". */
	category: MaterialCategory;
}

export const SPECIAL_MATERIAL_SWATCHES: readonly SpecialMaterialSwatch[] =
	TERRAIN_MATERIALS
		.filter((m): m is TerrainMaterial & { special: NonNullable<TerrainMaterial['special']> } => m.special !== undefined)
		.map((m) => ({
			index: m.special.paletteIndex,
			label: m.special.label,
			color: m.special.swatchColor,
			category: m.special.category ?? 'miscellaneous',
		}));

// ---------------------------------------------------------------------------
// Category grouping for the editor's "Materials" section
//
// Categories render in this fixed order; a category with no swatches is omitted
// by groupSpecialMaterialSwatches() so the editor never draws an empty row.
// ---------------------------------------------------------------------------

export const MATERIAL_CATEGORY_ORDER: readonly MaterialCategory[] = [
	'buildings',
	'liquids',
	'nature',
	'metals',
	'miscellaneous',
];

export const MATERIAL_CATEGORY_LABELS: Readonly<Record<MaterialCategory, string>> = {
	buildings: 'Buildings',
	liquids: 'Liquids',
	nature: 'Nature',
	metals: 'Metals',
	miscellaneous: 'Miscellaneous',
};

export interface SpecialMaterialSwatchGroup {
	category: MaterialCategory;
	label: string;
	swatches: SpecialMaterialSwatch[];
}

/**
 * Special-material swatches bucketed by category, in MATERIAL_CATEGORY_ORDER.
 * Empty categories are dropped so the editor only renders rows that have at
 * least one swatch.
 */
export function groupSpecialMaterialSwatches(): SpecialMaterialSwatchGroup[] {
	return MATERIAL_CATEGORY_ORDER
		.map((category) => ({
			category,
			label: MATERIAL_CATEGORY_LABELS[category],
			swatches: SPECIAL_MATERIAL_SWATCHES.filter((s) => s.category === category),
		}))
		.filter((group) => group.swatches.length > 0);
}

// ---------------------------------------------------------------------------
// Palette index -> render bucket / occlusion group dispatch
//
// Render buckets control draw calls and shader selection. Occlusion groups
// control whether neighboring voxels hide their shared face. Those are
// intentionally separate: opaque textured solids can render differently while
// sharing the same culling group; deformed or transparent materials can opt
// into their own group so hidden faces are still emitted.
// ---------------------------------------------------------------------------

const BUCKET_BY_PALETTE_INDEX: ReadonlyMap<number, string> = new Map(
	TERRAIN_MATERIALS
		.filter((m): m is TerrainMaterial & { special: NonNullable<TerrainMaterial['special']> } => m.special !== undefined)
		.map((m) => [m.special.paletteIndex, m.bucketKey] as const)
);

const DEFAULT_OCCLUSION_GROUP = defaultMaterial.occlusionGroup ?? defaultMaterial.bucketKey;

const OCCLUSION_GROUP_BY_PALETTE_INDEX: ReadonlyMap<number, string> = new Map(
	TERRAIN_MATERIALS
		.filter((m): m is TerrainMaterial & { special: NonNullable<TerrainMaterial['special']> } => m.special !== undefined)
		.map((m) => [m.special.paletteIndex, m.occlusionGroup ?? m.bucketKey] as const)
);

const GEOMETRY_BY_PALETTE_INDEX: ReadonlyMap<number, TerrainMaterial['geometry']> = new Map(
	TERRAIN_MATERIALS
		.filter((m): m is TerrainMaterial & { special: NonNullable<TerrainMaterial['special']> } => m.special !== undefined)
		.map((m) => [m.special.paletteIndex, m.geometry] as const)
);

const DEFAULT_GEOMETRY = defaultMaterial.geometry;

// Palette indices whose material is flagged `passable`. Treated as empty by
// collision / movement / raycast (but still rendered). Built once at module
// load; lookups are constant-time.
const PASSABLE_PALETTE_INDICES: ReadonlySet<number> = new Set(
	TERRAIN_MATERIALS
		.filter((m): m is TerrainMaterial & { special: NonNullable<TerrainMaterial['special']> } => m.special !== undefined)
		.filter((m) => m.passable === true)
		.map((m) => m.special.paletteIndex)
);

/**
 * True when voxels of this palette index should be treated as empty for
 * collision, walkable-surface detection, and raycasting -- while still being
 * rendered. Consumed by VoxelTerrainIndex.
 */
export function isPassableMaterial(colorIndex: number): boolean {
	return PASSABLE_PALETTE_INDICES.has(colorIndex);
}

// Palette indices whose material is flagged `volumetric`. Excluded from the
// greedy-meshed render buckets and the AO occupancy snapshot; routed instead
// into the fog-density volume the volumetric pass raymarches.
const VOLUMETRIC_PALETTE_INDICES: ReadonlySet<number> = new Set(
	TERRAIN_MATERIALS
		.filter((m): m is TerrainMaterial & { special: NonNullable<TerrainMaterial['special']> } => m.special !== undefined)
		.filter((m) => m.volumetric === true)
		.map((m) => m.special.paletteIndex)
);

/**
 * True when voxels of this palette index are rendered volumetrically rather
 * than as surface meshes. Consumed by the geometry builder to route them into
 * the fog-density volume instead of the render buckets / AO occupancy.
 */
export function isVolumetricMaterial(colorIndex: number): boolean {
	return VOLUMETRIC_PALETTE_INDICES.has(colorIndex);
}

export function getMaterialBucket(colorIndex: number): string {
	return BUCKET_BY_PALETTE_INDEX.get(colorIndex) ?? 'default';
}

export function getMaterialOcclusionGroup(colorIndex: number): string {
	return OCCLUSION_GROUP_BY_PALETTE_INDEX.get(colorIndex) ?? DEFAULT_OCCLUSION_GROUP;
}

export function getMaterialDeformsSurface(colorIndex: number): boolean {
	const geometry = GEOMETRY_BY_PALETTE_INDEX.get(colorIndex) ?? DEFAULT_GEOMETRY;
	return geometry?.deformSurface === true;
}

export function getMaterialUsesVertexColors(colorIndex: number): boolean {
	const geometry = GEOMETRY_BY_PALETTE_INDEX.get(colorIndex) ?? DEFAULT_GEOMETRY;
	return geometry?.vertexColors !== false;
}

export function getMaterialPreservesVoxelFaces(colorIndex: number): boolean {
	const geometry = GEOMETRY_BY_PALETTE_INDEX.get(colorIndex) ?? DEFAULT_GEOMETRY;
	return geometry?.preserveVoxelFaces === true;
}

// ---------------------------------------------------------------------------
// Editor-side helpers
//
// The terrain editor uses a separate, lighter renderer than the game view
// (a single vertex-coloured MeshStandardMaterial, no per-bucket meshes, no
// animated shaders). These helpers let it (a) show special materials in their
// swatch color rather than the palette's default grey, and (b) flag those
// vertices for a subtle "specialness" pattern injected by the editor's own
// shader patch. Both are constant-time map lookups; the editor's per-frame
// cost is unaffected.
// ---------------------------------------------------------------------------

const EDITOR_COLOR_BY_PALETTE_INDEX: ReadonlyMap<number, number> = new Map(
	TERRAIN_MATERIALS
		.filter((m): m is TerrainMaterial & { special: NonNullable<TerrainMaterial['special']> } => m.special !== undefined)
		.map((m) => [m.special.paletteIndex, parseInt(m.special.swatchColor.slice(1), 16)] as const)
);

/**
 * Editor render color for a special palette index, as a 0xRRGGBB number, or
 * undefined if the index is not claimed by any registered special material.
 * Callers should fall back to the standard palette table when undefined.
 */
export function getSpecialMaterialEditorColor(paletteIndex: number): number | undefined {
	return EDITOR_COLOR_BY_PALETTE_INDEX.get(paletteIndex);
}

/** True iff some registered TerrainMaterial claims this palette index. */
export function isSpecialPaletteIndex(paletteIndex: number): boolean {
	return EDITOR_COLOR_BY_PALETTE_INDEX.has(paletteIndex);
}

// ---------------------------------------------------------------------------
// Factory registry with auto-generated customProgramCacheKey
//
// Each material's factory is wrapped so that the THREE.MeshStandardMaterial it
// produces gets a stable customProgramCacheKey derived from:
//   - bucketKey       (one program per material)
//   - shaderVersion   (bump in the material file to force a recompile)
//   - highlight flag  (world view vs FP view share neither program nor key)
//
// This is the load-bearing detail for the edit-time-hitch fix in the refactor:
// three.js's program cache hits across material instances that share a key, so
// rebuilding the terrain (which allocates a new material every time) no longer
// triggers shader compilation.
// ---------------------------------------------------------------------------

function wrapFactoryWithCacheKey(material: TerrainMaterial): MaterialFactory {
	const { bucketKey, shaderVersion, factory } = material;
	return (params: MaterialFactoryParams): MaterialFactoryResult => {
		const result = factory(params);
		const key = [
			'terrain',
			bucketKey,
			`v${shaderVersion}`,
			params.acceptsMovementHighlight ? 'hl' : 'nh',
			params.performanceMode ? 'perf' : 'full',
		].join('-');
		result.material.customProgramCacheKey = () => key;
		result.material.needsUpdate = true;
		return result;
	};
}

// Module-load-time integrity checks: duplicate bucket keys or palette indices
// would silently cause one material to mask another. Fail loudly instead.
{
	const bucketKeys = new Set<string>();
	const paletteIndices = new Set<number>();
	for (const m of TERRAIN_MATERIALS) {
		if (bucketKeys.has(m.bucketKey)) {
			throw new Error(`Duplicate terrain material bucketKey: "${m.bucketKey}"`);
		}
		bucketKeys.add(m.bucketKey);
		if (m.special) {
			const { paletteIndex } = m.special;
			if (paletteIndex < 240 || paletteIndex > 255) {
				throw new Error(`Special material "${m.bucketKey}" has paletteIndex ${paletteIndex} outside the 240-255 range.`);
			}
			if (paletteIndices.has(paletteIndex)) {
				throw new Error(`Duplicate special material paletteIndex: ${paletteIndex}`);
			}
			paletteIndices.add(paletteIndex);
		}
	}
}

export const TERRAIN_MATERIAL_REGISTRY: ReadonlyMap<string, MaterialFactory> = new Map(
	TERRAIN_MATERIALS.map((m) => [m.bucketKey, wrapFactoryWithCacheKey(m)] as const)
);

// ---------------------------------------------------------------------------
// Movement-highlight 3D texture (shared resource consumed by world-view factories)
//
// Real terrain uses the terrain's actual width/height/length. For a placeholder
// (FP scene resources init, or pre-warm dummy), call with (1, 1, 1).
//
// Layout: data[(tileZ * heightLevels * width + h * width + tileX) * 4]
// Sampled in the shader as texture(sampler3D, vec3(s, t, r)) where
// s = tileX/width, t = h/heightLevels, r = tileZ/length.
// ---------------------------------------------------------------------------

export function createMovementHighlightTexture(
	width: number,
	heightLevels: number,
	length: number
) {
	const data = new Uint8Array(width * heightLevels * length * 4);
	const texture = new THREE.Data3DTexture(data, width, heightLevels, length);
	texture.format = THREE.RGBAFormat;
	texture.type = THREE.UnsignedByteType;
	texture.magFilter = THREE.NearestFilter;
	texture.minFilter = THREE.NearestFilter;
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.wrapR = THREE.ClampToEdgeWrapping;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return { texture, data, width, heightLevels, length };
}

// ---------------------------------------------------------------------------
// Dummy geometry for shader pre-warming
//
// A single 2-triangle quad with every terrain vertex attribute present. The
// content doesn't matter -- three.js only needs the attribute layout to compile
// the shader. Shared across all warm-up meshes (read-only after creation).
//
// If the worker's emitted attribute set ever grows (e.g. UVs for the future
// stone-bricks material), mirror the new attribute here so the pre-warm
// programs see the same vertex layout as the real terrain.
// ---------------------------------------------------------------------------

export function createDummyTerrainGeometry(): THREE.BufferGeometry {
	const geo = new THREE.BufferGeometry();
	const v = 4;
	geo.setAttribute('position',          new THREE.BufferAttribute(new Float32Array(v * 3), 3));
	geo.setAttribute('normal',            new THREE.BufferAttribute(new Float32Array(v * 3), 3));
	geo.setAttribute('color',             new THREE.BufferAttribute(new Float32Array(v * 3), 3));
	geo.setAttribute('surfaceDeformStrength', new THREE.BufferAttribute(new Float32Array(v), 1));
	geo.setAttribute('tileHeight',        new THREE.BufferAttribute(new Float32Array(v), 1));
	geo.setAttribute('highlightStrength', new THREE.BufferAttribute(new Float32Array(v), 1));
	geo.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2, 0, 2, 3]), 1));
	return geo;
}
