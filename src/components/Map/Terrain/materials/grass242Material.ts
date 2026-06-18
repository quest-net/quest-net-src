// Grass material (palette index 242).
//
// Uses base color, OpenGL normal, roughness, and micro-AO maps. The source set
// also included height and DirectX-normal maps, but voxel terrain already has
// per-fragment voxel AO and no UVs. These textures are sampled through the same
// world projection used by stone bricks instead of Three's UV-based map slots.

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

const GRASS_TEXTURE_URL = '/materials/grass_242/grass_02_base_1k.png';
const GRASS_NORMAL_TEXTURE_URL = '/materials/grass_242/grass_02_normal_gl_1k.png';
const GRASS_ROUGHNESS_TEXTURE_URL = '/materials/grass_242/grass_02_roughness_1k.png';
const GRASS_AO_TEXTURE_URL = '/materials/grass_242/grass_02_amibent_occlusion_1k.png';
const GRASS_SWATCH = '#4f8f37';
const GRASS_TEXTURE_REPEAT = 0.75;
const GRASS_NORMAL_STRENGTH = 1.45;
const GRASS_AO_STRENGTH = 0.45;
const GRASS_ROUGHNESS_MIN = 0.86;
const GRASS_ROUGHNESS_MAX = 1.0;
const GRASS_ANISOTROPY = 8;
const GRASS_PERFORMANCE_ANISOTROPY = 1;

let cachedTexture: THREE.Texture | null = null;
let cachedPerformanceTexture: THREE.Texture | null = null;
let cachedNormalTexture: THREE.Texture | null = null;
let cachedRoughnessTexture: THREE.Texture | null = null;
let cachedAoTexture: THREE.Texture | null = null;

function configureGrassTexture(
	texture: THREE.Texture,
	performanceMode = false
): THREE.Texture {
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = performanceMode
		? THREE.LinearFilter
		: THREE.LinearMipmapLinearFilter;
	texture.anisotropy = performanceMode
		? GRASS_PERFORMANCE_ANISOTROPY
		: GRASS_ANISOTROPY;
	texture.generateMipmaps = !performanceMode;
	return texture;
}

function getGrassTexture(performanceMode: boolean): THREE.Texture {
	if (performanceMode) {
		if (!cachedPerformanceTexture) {
			const texture = configureGrassTexture(
				new THREE.TextureLoader().load(GRASS_TEXTURE_URL),
				true
			);
			texture.colorSpace = THREE.SRGBColorSpace;
			cachedPerformanceTexture = texture;
		}
		return cachedPerformanceTexture;
	}

	if (cachedTexture) return cachedTexture;

	const texture = configureGrassTexture(new THREE.TextureLoader().load(GRASS_TEXTURE_URL), false);
	texture.colorSpace = THREE.SRGBColorSpace;
	cachedTexture = texture;
	return texture;
}

function getGrassNormalTexture(): THREE.Texture {
	if (cachedNormalTexture) return cachedNormalTexture;

	const texture = configureGrassTexture(new THREE.TextureLoader().load(GRASS_NORMAL_TEXTURE_URL), false);
	cachedNormalTexture = texture;
	return texture;
}

function getGrassRoughnessTexture(): THREE.Texture {
	if (cachedRoughnessTexture) return cachedRoughnessTexture;

	const texture = configureGrassTexture(new THREE.TextureLoader().load(GRASS_ROUGHNESS_TEXTURE_URL), false);
	cachedRoughnessTexture = texture;
	return texture;
}

function getGrassAoTexture(): THREE.Texture {
	if (cachedAoTexture) return cachedAoTexture;

	const texture = configureGrassTexture(new THREE.TextureLoader().load(GRASS_AO_TEXTURE_URL), false);
	cachedAoTexture = texture;
	return texture;
}

function grassShaderHeader(): string[] {
	return [
		...VOXEL_AO_VERTEX_HEADER,
	];
}

function grassBeginVertex(): string[] {
	return [
		...VOXEL_AO_VERTEX_BEGIN,
	];
}

function grassFragmentHeader(performanceMode: boolean): string[] {
	const header = [
		...getVoxelAoFragmentHeader(false),
		'uniform sampler2D grassMap;',
	];
	if (performanceMode) {
		return [
			...getVoxelAoFragmentHeader(true),
			'uniform sampler2D grassMap;',
			'vec2 getGrassUv(vec3 worldPosition, vec3 worldNormal) {',
			'	vec3 n = abs(normalize(worldNormal));',
			'	if (n.y >= n.x && n.y >= n.z) return worldPosition.xz;',
			'	if (n.x >= n.z) return worldPosition.zy;',
			'	return worldPosition.xy;',
			'}',
		];
	}

	return [
		...header,
		'uniform sampler2D grassNormalMap;',
		'uniform sampler2D grassRoughnessMap;',
		'uniform sampler2D grassAoMap;',
		'vec2 getGrassUv(vec3 worldPosition, vec3 worldNormal) {',
		'	vec3 n = abs(normalize(worldNormal));',
		'	if (n.y >= n.x && n.y >= n.z) return worldPosition.xz;',
		'	if (n.x >= n.z) return worldPosition.zy;',
		'	return worldPosition.xy;',
		'}',
		'mat3 grassGetTangentFrame(vec3 eyePosition, vec3 surfaceNormal, vec2 uv) {',
		'	vec3 q0 = dFdx(eyePosition.xyz);',
		'	vec3 q1 = dFdy(eyePosition.xyz);',
		'	vec2 st0 = dFdx(uv.st);',
		'	vec2 st1 = dFdy(uv.st);',
		'	vec3 q1perp = cross(q1, surfaceNormal);',
		'	vec3 q0perp = cross(surfaceNormal, q0);',
		'	vec3 tangent = q1perp * st0.x + q0perp * st1.x;',
		'	vec3 bitangent = q1perp * st0.y + q0perp * st1.y;',
		'	float determinant = max(dot(tangent, tangent), dot(bitangent, bitangent));',
		'	float scale = determinant == 0.0 ? 0.0 : inversesqrt(determinant);',
		'	return mat3(tangent * scale, bitangent * scale, surfaceNormal);',
		'}',
	];
}

function grassColorFragment(performanceMode: boolean): string[] {
	const lines = [
		'#include <color_fragment>',
		`vec2 grassUv = getGrassUv(vVoxelAoWorldPosition, vVoxelAoWorldNormal) * ${GRASS_TEXTURE_REPEAT.toFixed(2)};`,
		'vec4 grassTexel = texture2D(grassMap, grassUv);',
		'diffuseColor.rgb *= grassTexel.rgb;',
		'diffuseColor.a *= grassTexel.a;',
		`diffuseColor.rgb *= ${VOXEL_AO_CALL};`,
	];
	if (performanceMode) return lines;

	lines.splice(
		3,
		0,
		'float grassMicroAo = mix(1.0, texture2D(grassAoMap, grassUv).r, ' + GRASS_AO_STRENGTH.toFixed(2) + ');',
		'diffuseColor.rgb *= grassMicroAo;'
	);
	return lines;
}

function grassRoughnessFragment(): string[] {
	return [
		'#include <roughnessmap_fragment>',
		`vec2 grassRoughnessUv = getGrassUv(vVoxelAoWorldPosition, vVoxelAoWorldNormal) * ${GRASS_TEXTURE_REPEAT.toFixed(2)};`,
		'float grassRoughnessSample = texture2D(grassRoughnessMap, grassRoughnessUv).g;',
		`roughnessFactor = clamp(mix(${GRASS_ROUGHNESS_MIN.toFixed(2)}, ${GRASS_ROUGHNESS_MAX.toFixed(2)}, grassRoughnessSample), ${GRASS_ROUGHNESS_MIN.toFixed(2)}, ${GRASS_ROUGHNESS_MAX.toFixed(2)});`,
	];
}

function grassNormalFragment(): string[] {
	return [
		`vec2 grassNormalUv = getGrassUv(vVoxelAoWorldPosition, vVoxelAoWorldNormal) * ${GRASS_TEXTURE_REPEAT.toFixed(2)};`,
		'vec3 grassMapNormal = texture2D(grassNormalMap, grassNormalUv).xyz * 2.0 - 1.0;',
		`grassMapNormal.xy *= ${GRASS_NORMAL_STRENGTH.toFixed(2)};`,
		'normal = normalize(grassGetTangentFrame(-vViewPosition, normal, grassNormalUv) * normalize(grassMapNormal));',
	];
}

function installGrass242Shader(
	material: THREE.MeshStandardMaterial,
	texture: THREE.Texture,
	normalTexture: THREE.Texture | null,
	roughnessTexture: THREE.Texture | null,
	aoTexture: THREE.Texture | null,
	voxelAo: VoxelAoTexture,
	movementHighlight: MovementHighlightTexture | undefined,
	performanceMode: boolean
): void {
	material.onBeforeCompile = (shader) => {
		applyVoxelAoUniforms(shader, voxelAo);
		shader.uniforms.grassMap = { value: texture };
		if (!performanceMode && normalTexture && roughnessTexture && aoTexture) {
			shader.uniforms.grassNormalMap = { value: normalTexture };
			shader.uniforms.grassRoughnessMap = { value: roughnessTexture };
			shader.uniforms.grassAoMap = { value: aoTexture };
		}
		applyMovementHighlightUniforms(shader, movementHighlight);

		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			['#include <common>', ...grassShaderHeader(), ...MOVEMENT_HIGHLIGHT_VERTEX_HEADER].join('\n')
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			['#include <begin_vertex>', ...grassBeginVertex(), ...MOVEMENT_HIGHLIGHT_VERTEX_BEGIN].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			['#include <common>', ...grassFragmentHeader(performanceMode), ...MOVEMENT_HIGHLIGHT_FRAGMENT_HEADER].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			grassColorFragment(performanceMode).join('\n')
		);
		if (!performanceMode) {
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <roughnessmap_fragment>',
				grassRoughnessFragment().join('\n')
			);
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <normal_fragment_maps>',
				grassNormalFragment().join('\n')
			);
		}
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <dithering_fragment>',
			MOVEMENT_HIGHLIGHT_DITHERING.join('\n')
		);
	};
}

export const createGrass242Material: MaterialFactory = (
	params: MaterialFactoryParams
): MaterialFactoryResult => {
	const { movementHighlight, voxelAo, performanceMode = false } = params;
	const texture = getGrassTexture(performanceMode);
	const normalTexture = performanceMode ? null : getGrassNormalTexture();
	const roughnessTexture = performanceMode ? null : getGrassRoughnessTexture();
	const aoTexture = performanceMode ? null : getGrassAoTexture();
	const material = new THREE.MeshStandardMaterial({
		roughness: GRASS_ROUGHNESS_MAX,
		metalness: THREE_D_TERRAIN_MATERIAL.METALNESS,
		vertexColors: false,
	});

	installGrass242Shader(material, texture, normalTexture, roughnessTexture, aoTexture, voxelAo, movementHighlight, performanceMode);

	return { material, castShadow: true, receiveShadow: true };
};

const grass242Material: TerrainMaterial = {
	bucketKey: 'grass_242',
	occlusionGroup: 'solid',
	shaderVersion: 4,
	geometry: {
		vertexColors: false,
	},
	factory: createGrass242Material,
	special: {
		paletteIndex: 242,
		label: 'Grass',
		swatchColor: GRASS_SWATCH,
		category: 'nature',
	},
};

export default grass242Material;
