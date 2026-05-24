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
//                                 "Materials" row.
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
	MaterialFactory,
	MaterialFactoryParams,
	MaterialFactoryResult,
	TerrainMaterial,
} from './materialTypes';

import defaultMaterial from './defaultMaterial';
import stoneBricks240Material from './stoneBricks240Material';

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
];

// ---------------------------------------------------------------------------
// Re-exported types (so consumers can import everything from one place)
// ---------------------------------------------------------------------------

export type {
	MaterialFactory,
	MaterialFactoryParams,
	MaterialFactoryResult,
	MovementHighlightTexture,
	TerrainMaterial,
} from './materialTypes';

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
}

export const SPECIAL_MATERIAL_SWATCHES: readonly SpecialMaterialSwatch[] =
	TERRAIN_MATERIALS
		.filter((m): m is TerrainMaterial & { special: NonNullable<TerrainMaterial['special']> } => m.special !== undefined)
		.map((m) => ({
			index: m.special.paletteIndex,
			label: m.special.label,
			color: m.special.swatchColor,
		}));

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

export function getMaterialBucket(colorIndex: number): string {
	return BUCKET_BY_PALETTE_INDEX.get(colorIndex) ?? 'default';
}

export function getMaterialOcclusionGroup(colorIndex: number): string {
	return OCCLUSION_GROUP_BY_PALETTE_INDEX.get(colorIndex) ?? DEFAULT_OCCLUSION_GROUP;
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
	const keyHighlight  = `terrain-${bucketKey}-v${shaderVersion}-hl`;
	const keyNoHighlight = `terrain-${bucketKey}-v${shaderVersion}-nh`;
	return (params: MaterialFactoryParams): MaterialFactoryResult => {
		const result = factory(params);
		const key = params.acceptsMovementHighlight ? keyHighlight : keyNoHighlight;
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
	geo.setAttribute('aoStrength',        new THREE.BufferAttribute(new Float32Array(v), 1));
	geo.setAttribute('tileCoord',         new THREE.BufferAttribute(new Float32Array(v * 2), 2));
	geo.setAttribute('tileHeight',        new THREE.BufferAttribute(new Float32Array(v), 1));
	geo.setAttribute('highlightStrength', new THREE.BufferAttribute(new Float32Array(v), 1));
	geo.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2, 0, 2, 3]), 1));
	return geo;
}
