// Wood material (palette index 244).
//
// Uses a world-projected texture so the geometry worker does not need to emit
// UV attributes. The material renders in its own bucket but shares the "solid"
// occlusion group with default terrain, so hidden default/wood boundary faces
// are culled.

import * as THREE from 'three';
import { THREE_D_TERRAIN_MATERIAL } from '../../threeDMapConstants';
import type {
	MaterialFactory,
	MaterialFactoryParams,
	MaterialFactoryResult,
	MovementHighlightTexture,
	TerrainMaterial,
} from './materialTypes';
import {
	applyVoxelAoUniforms,
	getVoxelAoFragmentHeader,
	VOXEL_AO_CALL,
	VOXEL_AO_VERTEX_BEGIN,
	VOXEL_AO_VERTEX_HEADER,
	type VoxelAoTexture,
} from '../shaders/voxelAoShader';
import {
	applyMovementHighlightUniforms,
	MOVEMENT_HIGHLIGHT_DITHERING,
	MOVEMENT_HIGHLIGHT_FRAGMENT_HEADER,
	MOVEMENT_HIGHLIGHT_VERTEX_BEGIN,
	MOVEMENT_HIGHLIGHT_VERTEX_HEADER,
} from '../shaders/movementHighlightShader';

const WOOD_TEXTURE_URL = '/materials/wood_244/wood_256x256.png';
const WOOD_SWATCH = '#8b5a2b';
const WOOD_TEXTURE_REPEAT = 1.0;
const WOOD_ANISOTROPY = 8;
const WOOD_PERFORMANCE_ANISOTROPY = 1;

let cachedTexture: THREE.Texture | null = null;
let cachedPerformanceTexture: THREE.Texture | null = null;

function configureWoodTexture(
	texture: THREE.Texture,
	performanceMode: boolean
): THREE.Texture {
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = performanceMode
		? THREE.LinearFilter
		: THREE.LinearMipmapLinearFilter;
	texture.anisotropy = performanceMode
		? WOOD_PERFORMANCE_ANISOTROPY
		: WOOD_ANISOTROPY;
	texture.generateMipmaps = !performanceMode;
	return texture;
}

function getWoodTexture(performanceMode: boolean): THREE.Texture {
	if (performanceMode) {
		if (!cachedPerformanceTexture) {
			cachedPerformanceTexture = configureWoodTexture(
				new THREE.TextureLoader().load(WOOD_TEXTURE_URL),
				true
			);
		}
		return cachedPerformanceTexture;
	}

	if (!cachedTexture) {
		cachedTexture = configureWoodTexture(
			new THREE.TextureLoader().load(WOOD_TEXTURE_URL),
			false
		);
	}
	return cachedTexture;
}

function woodShaderHeader(): string[] {
	return [
		...VOXEL_AO_VERTEX_HEADER,
	];
}

function woodBeginVertex(): string[] {
	return [
		...VOXEL_AO_VERTEX_BEGIN,
	];
}

function woodFragmentHeader(performanceMode: boolean): string[] {
	return [
		...getVoxelAoFragmentHeader(performanceMode),
		'uniform sampler2D woodMap;',
		'vec2 getWoodUv(vec3 worldPosition, vec3 worldNormal) {',
		'	vec3 n = abs(normalize(worldNormal));',
		'	if (n.y >= n.x && n.y >= n.z) return worldPosition.xz;',
		'	if (n.x >= n.z) return worldPosition.zy;',
		'	return worldPosition.xy;',
		'}',
	];
}

function woodColorFragment(): string[] {
	return [
		'#include <color_fragment>',
		`vec2 woodUv = getWoodUv(vVoxelAoWorldPosition, vVoxelAoWorldNormal) * ${WOOD_TEXTURE_REPEAT.toFixed(1)};`,
		'vec4 woodTexel = texture2D(woodMap, woodUv);',
		'diffuseColor.rgb *= woodTexel.rgb;',
		'diffuseColor.a *= woodTexel.a;',
		`diffuseColor.rgb *= ${VOXEL_AO_CALL};`,
	];
}

function installWood244Shader(
	material: THREE.MeshStandardMaterial,
	texture: THREE.Texture,
	voxelAo: VoxelAoTexture,
	movementHighlight: MovementHighlightTexture | undefined,
	performanceMode: boolean
): void {
	material.onBeforeCompile = (shader) => {
		applyVoxelAoUniforms(shader, voxelAo);
		shader.uniforms.woodMap = { value: texture };
		applyMovementHighlightUniforms(shader, movementHighlight);

		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			['#include <common>', ...woodShaderHeader(), ...MOVEMENT_HIGHLIGHT_VERTEX_HEADER].join('\n')
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			['#include <begin_vertex>', ...woodBeginVertex(), ...MOVEMENT_HIGHLIGHT_VERTEX_BEGIN].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			['#include <common>', ...woodFragmentHeader(performanceMode), ...MOVEMENT_HIGHLIGHT_FRAGMENT_HEADER].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			woodColorFragment().join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <dithering_fragment>',
			MOVEMENT_HIGHLIGHT_DITHERING.join('\n')
		);
	};
}

export const createWood244Material: MaterialFactory = (
	params: MaterialFactoryParams
): MaterialFactoryResult => {
	const { movementHighlight, voxelAo, performanceMode = false } = params;
	const texture = getWoodTexture(performanceMode);
	const material = new THREE.MeshStandardMaterial({
		roughness: THREE_D_TERRAIN_MATERIAL.ROUGHNESS,
		metalness: THREE_D_TERRAIN_MATERIAL.METALNESS,
		vertexColors: false,
	});

	installWood244Shader(material, texture, voxelAo, movementHighlight, performanceMode);

	return { material, castShadow: true, receiveShadow: true };
};

const wood244Material: TerrainMaterial = {
	bucketKey: 'wood_244',
	occlusionGroup: 'solid',
	shaderVersion: 2,
	geometry: {
		vertexColors: false,
	},
	factory: createWood244Material,
	special: {
		paletteIndex: 244,
		label: 'Wood',
		swatchColor: WOOD_SWATCH,
		category: 'nature',
	},
};

export default wood244Material;
