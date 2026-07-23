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
import {
	applyHeroOcclusionUniforms,
	HERO_OCCLUSION_DISCARD,
	HERO_OCCLUSION_FRAGMENT_HEADER,
	HERO_OCCLUSION_VERTEX_BEGIN,
	HERO_OCCLUSION_VERTEX_HEADER,
	type HeroOcclusionUniforms,
} from '../shaders/heroOcclusionShader';

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

// Glass carries no AO / movement-highlight patch, so this installs ONLY the
// hero-occlusion cutout (its own self-contained world-position varying). Without
// it a glass pane -- though see-through -- would still tint/refract over an actor
// behind it and defeat the cutout on adjacent solid walls seen through the glass.
function installGlass246HeroShader(
	material: THREE.MeshStandardMaterial,
	heroOcclusion: HeroOcclusionUniforms | undefined
): void {
	material.onBeforeCompile = (shader) => {
		applyHeroOcclusionUniforms(shader, heroOcclusion);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			['#include <common>', ...HERO_OCCLUSION_VERTEX_HEADER].join('\n')
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			['#include <begin_vertex>', ...HERO_OCCLUSION_VERTEX_BEGIN].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			['#include <common>', ...HERO_OCCLUSION_FRAGMENT_HEADER].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <clipping_planes_fragment>',
			HERO_OCCLUSION_DISCARD.join('\n')
		);
	};
}

export const createGlass246Material: MaterialFactory = (
	params: MaterialFactoryParams
): MaterialFactoryResult => {
	const { heroOcclusion } = params;
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

	installGlass246HeroShader(material, heroOcclusion);

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
	shaderVersion: 3,
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
