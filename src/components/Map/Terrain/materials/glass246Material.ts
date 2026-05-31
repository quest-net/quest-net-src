// Glass material (palette index 246).
//
// A simple dielectric glass using only base MeshStandardMaterial properties --
// no shader injection required. The key properties:
//
//   - Very smooth (roughness 0.05) so specular highlights are tight and glassy.
//   - Genuinely transparent (opacity ~0.22) with depthWrite off so geometry
//     behind the glass is not incorrectly occluded in the depth buffer.
//   - Own occlusion group so glass-to-glass shared faces are culled (a solid
//     glass block has a hollow interior) while solid faces adjacent to glass
//     are still emitted and visible through it.
//   - Draws at renderOrder 2 (after opaque terrain at 0 and water/lava at 1).
//   - No shadow casting -- transparent surfaces should not leave hard silhouettes.

import * as THREE from 'three';
import type {
	MaterialFactory,
	MaterialFactoryParams,
	MaterialFactoryResult,
	TerrainMaterial,
} from './materialTypes';

// ---------------------------------------------------------------------------
// Tuning knobs
// ---------------------------------------------------------------------------

const GLASS_SWATCH = '#a8d8f0';

/** Base tint. Very light cool blue -- barely perceptible, mostly clear. */
const GLASS_COLOR = '#cce8ff';

/** Smooth like polished glass -- tight specular highlights. */
const GLASS_ROUGHNESS = 0.05;

/** Glass is a dielectric (non-metal). */
const GLASS_METALNESS = 0.0;

/**
 * Opacity. Low enough to be clearly see-through; high enough that the
 * glass pane reads as a solid surface and not just a tint.
 */
const GLASS_OPACITY = 0.22;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createGlass246Material: MaterialFactory = (
	_params: MaterialFactoryParams
): MaterialFactoryResult => {
	const material = new THREE.MeshStandardMaterial({
		color: GLASS_COLOR,
		roughness: GLASS_ROUGHNESS,
		metalness: GLASS_METALNESS,
		vertexColors: false,
		transparent: true,
		opacity: GLASS_OPACITY,
		// depthWrite off: glass is genuinely transparent and must not occlude
		// geometry behind it in the depth buffer. Unlike near-opaque water, the
		// visual difference here is significant.
		depthWrite: false,
	});

	return {
		material,
		castShadow: false,     // transparent surfaces do not cast hard shadows
		receiveShadow: true,
		renderOrder: 2,        // draw after opaque terrain (0) and water/lava (1)
	};
};

// ---------------------------------------------------------------------------
// Material definition (collected by materials/index.ts)
// ---------------------------------------------------------------------------

const glass246Material: TerrainMaterial = {
	bucketKey: 'glass_246',
	// Own occlusion group: glass-to-glass faces are culled so a solid glass
	// block has a hollow interior. Glass-to-solid faces are NOT culled so the
	// solid geometry behind a glass pane remains visible through it.
	occlusionGroup: 'glass_246',
	shaderVersion: 1,
	geometry: {
		vertexColors: false,
	},
	factory: createGlass246Material,
	special: {
		paletteIndex: 246,
		label: 'Glass',
		swatchColor: GLASS_SWATCH,
		category: 'buildings',
	},
};

export default glass246Material;
