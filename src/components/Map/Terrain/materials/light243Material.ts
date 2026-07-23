// Light material (palette index 243).
//
// This is a fake light voxel for windows, lamps, and glowing map details. It
// does not add a THREE.Light and does not cast shadows; it only renders as an
// emissive surface bright enough for the map bloom pass to pick up.

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

const LIGHT_SWATCH = '#ffd166';
const LIGHT_ROUGHNESS = 0.35;
const LIGHT_METALNESS = 0.0;
const LIGHT_EMISSIVE_INTENSITY = 3.5;

// Light blocks carry no AO / movement-highlight patch, so this installs ONLY the
// hero-occlusion cutout. Light voxels are `passable` (raycasts already ignore
// them) but they still RENDER as emissive surfaces, so a glowing lamp/window wall
// in front of the focused actor would otherwise hide it.
function installLight243HeroShader(
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

export const createLight243Material: MaterialFactory = (
	params: MaterialFactoryParams
): MaterialFactoryResult => {
	const { heroOcclusion } = params;
	const material = new THREE.MeshStandardMaterial({
		color: LIGHT_SWATCH,
		emissive: LIGHT_SWATCH,
		emissiveIntensity: LIGHT_EMISSIVE_INTENSITY,
		roughness: LIGHT_ROUGHNESS,
		metalness: LIGHT_METALNESS,
		vertexColors: false,
	});

	installLight243HeroShader(material, heroOcclusion);

	return {
		material,
		castShadow: false,
		receiveShadow: false,
	};
};

const light243Material: TerrainMaterial = {
	bucketKey: 'light_243',
	occlusionGroup: 'solid',
	shaderVersion: 3,
	geometry: {
		vertexColors: false,
	},
	// Light is a glow volume, not a solid object: actors walk through it, it is
	// never a walkable surface, and raycasts pass through it. It still renders.
	passable: true,
	factory: createLight243Material,
	special: {
		paletteIndex: 243,
		label: 'Light',
		swatchColor: LIGHT_SWATCH,
	},
};

export default light243Material;
