// Stone bricks material (palette index 240).
//
// Uses a world-projected texture so the geometry worker does not need to emit
// UV attributes. The material renders in its own bucket but shares the "solid"
// occlusion group with default terrain, so hidden default/brick boundary faces
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

const STONE_BRICKS_TEXTURE_URL = '/materials/bricks_240/bricks_256x256.png';
const STONE_BRICKS_SWATCH = '#8f8f8f';
const STONE_BRICKS_TEXTURE_REPEAT = 1.0;
const STONE_BRICKS_ANISOTROPY = 8;
const STONE_BRICKS_PERFORMANCE_ANISOTROPY = 1;

let cachedTexture: THREE.Texture | null = null;
let cachedPerformanceTexture: THREE.Texture | null = null;

function configureStoneBricksTexture(
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
		? STONE_BRICKS_PERFORMANCE_ANISOTROPY
		: STONE_BRICKS_ANISOTROPY;
	texture.generateMipmaps = !performanceMode;
	return texture;
}

function getStoneBricksTexture(performanceMode: boolean): THREE.Texture {
	if (performanceMode) {
		if (!cachedPerformanceTexture) {
			cachedPerformanceTexture = configureStoneBricksTexture(
				new THREE.TextureLoader().load(STONE_BRICKS_TEXTURE_URL),
				true
			);
		}
		return cachedPerformanceTexture;
	}

	if (!cachedTexture) {
		cachedTexture = configureStoneBricksTexture(
			new THREE.TextureLoader().load(STONE_BRICKS_TEXTURE_URL),
			false
		);
	}
	return cachedTexture;
}

function stoneBricksShaderHeader(): string[] {
	return [
		...VOXEL_AO_VERTEX_HEADER,
		'varying vec3 vStoneBricksWorldPosition;',
		'varying vec3 vStoneBricksWorldNormal;',
	];
}

function stoneBricksBeginVertex(): string[] {
	return [
		...VOXEL_AO_VERTEX_BEGIN,
		'vStoneBricksWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
		'vStoneBricksWorldNormal = normalize(mat3(modelMatrix) * normal);',
	];
}

function stoneBricksFragmentHeader(performanceMode: boolean): string[] {
	return [
		...getVoxelAoFragmentHeader(performanceMode),
		'varying vec3 vStoneBricksWorldPosition;',
		'varying vec3 vStoneBricksWorldNormal;',
		'uniform sampler2D stoneBricksMap;',
		'vec2 getStoneBricksUv(vec3 worldPosition, vec3 worldNormal) {',
		'	vec3 n = abs(normalize(worldNormal));',
		'	if (n.y >= n.x && n.y >= n.z) return worldPosition.xz;',
		'	if (n.x >= n.z) return worldPosition.zy;',
		'	return worldPosition.xy;',
		'}',
	];
}

function stoneBricksColorFragment(): string[] {
	return [
		'#include <color_fragment>',
		`vec2 stoneBricksUv = getStoneBricksUv(vStoneBricksWorldPosition, vStoneBricksWorldNormal) * ${STONE_BRICKS_TEXTURE_REPEAT.toFixed(1)};`,
		'vec4 stoneBricksTexel = texture2D(stoneBricksMap, stoneBricksUv);',
		'diffuseColor.rgb *= stoneBricksTexel.rgb;',
		'diffuseColor.a *= stoneBricksTexel.a;',
		`diffuseColor.rgb *= ${VOXEL_AO_CALL};`,
	];
}

function installStoneBricks240Shader(
	material: THREE.MeshStandardMaterial,
	texture: THREE.Texture,
	voxelAo: VoxelAoTexture,
	movementHighlight: MovementHighlightTexture | undefined,
	performanceMode: boolean
): void {
	material.onBeforeCompile = (shader) => {
		applyVoxelAoUniforms(shader, voxelAo);
		shader.uniforms.stoneBricksMap = { value: texture };
		applyMovementHighlightUniforms(shader, movementHighlight);

		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			['#include <common>', ...stoneBricksShaderHeader(), ...MOVEMENT_HIGHLIGHT_VERTEX_HEADER].join('\n')
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			['#include <begin_vertex>', ...stoneBricksBeginVertex(), ...MOVEMENT_HIGHLIGHT_VERTEX_BEGIN].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			['#include <common>', ...stoneBricksFragmentHeader(performanceMode), ...MOVEMENT_HIGHLIGHT_FRAGMENT_HEADER].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			stoneBricksColorFragment().join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <dithering_fragment>',
			MOVEMENT_HIGHLIGHT_DITHERING.join('\n')
		);
	};
}

export const createStoneBricks240Material: MaterialFactory = (
	params: MaterialFactoryParams
): MaterialFactoryResult => {
	const { movementHighlight, voxelAo, performanceMode = false } = params;
	const texture = getStoneBricksTexture(performanceMode);
	const material = new THREE.MeshStandardMaterial({
		roughness: THREE_D_TERRAIN_MATERIAL.ROUGHNESS,
		metalness: THREE_D_TERRAIN_MATERIAL.METALNESS,
		vertexColors: false,
	});

	installStoneBricks240Shader(material, texture, voxelAo, movementHighlight, performanceMode);

	return { material, castShadow: true, receiveShadow: true };
};

const stoneBricks240Material: TerrainMaterial = {
	bucketKey: 'stonebricks_240',
	occlusionGroup: 'solid',
	shaderVersion: 2,
	geometry: {
		vertexColors: false,
	},
	factory: createStoneBricks240Material,
	special: {
		paletteIndex: 240,
		label: 'Stone Bricks',
		swatchColor: STONE_BRICKS_SWATCH,
		category: 'buildings',
	},
};

export default stoneBricks240Material;
