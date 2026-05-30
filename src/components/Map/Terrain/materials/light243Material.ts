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

const LIGHT_SWATCH = '#ffd166';
const LIGHT_ROUGHNESS = 0.35;
const LIGHT_METALNESS = 0.0;
const LIGHT_EMISSIVE_INTENSITY = 3.5;

export const createLight243Material: MaterialFactory = (
	_params: MaterialFactoryParams
): MaterialFactoryResult => {
	const material = new THREE.MeshStandardMaterial({
		color: LIGHT_SWATCH,
		emissive: LIGHT_SWATCH,
		emissiveIntensity: LIGHT_EMISSIVE_INTENSITY,
		roughness: LIGHT_ROUGHNESS,
		metalness: LIGHT_METALNESS,
		vertexColors: false,
	});

	return {
		material,
		castShadow: false,
		receiveShadow: false,
	};
};

const light243Material: TerrainMaterial = {
	bucketKey: 'light_243',
	occlusionGroup: 'solid',
	shaderVersion: 1,
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
