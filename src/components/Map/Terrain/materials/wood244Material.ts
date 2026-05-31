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
		'varying vec3 vWoodWorldPosition;',
		'varying vec3 vWoodWorldNormal;',
	];
}

function woodBeginVertex(): string[] {
	return [
		...VOXEL_AO_VERTEX_BEGIN,
		'vWoodWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
		'vWoodWorldNormal = normalize(mat3(modelMatrix) * normal);',
	];
}

function woodFragmentHeader(performanceMode: boolean): string[] {
	return [
		...getVoxelAoFragmentHeader(performanceMode),
		'varying vec3 vWoodWorldPosition;',
		'varying vec3 vWoodWorldNormal;',
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
		`vec2 woodUv = getWoodUv(vWoodWorldPosition, vWoodWorldNormal) * ${WOOD_TEXTURE_REPEAT.toFixed(1)};`,
		'vec4 woodTexel = texture2D(woodMap, woodUv);',
		'diffuseColor.rgb *= woodTexel.rgb;',
		'diffuseColor.a *= woodTexel.a;',
		`diffuseColor.rgb *= ${VOXEL_AO_CALL};`,
	];
}

function installWoodAoShader(
	material: THREE.MeshStandardMaterial,
	texture: THREE.Texture,
	voxelAo: VoxelAoTexture,
	performanceMode: boolean
): void {
	material.onBeforeCompile = (shader) => {
		applyVoxelAoUniforms(shader, voxelAo);
		shader.uniforms.woodMap = { value: texture };
		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			['#include <common>', ...woodShaderHeader()].join('\n')
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			['#include <begin_vertex>', ...woodBeginVertex()].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			['#include <common>', ...woodFragmentHeader(performanceMode)].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			woodColorFragment().join('\n')
		);
	};
}

function installWoodHighlightShader(
	material: THREE.MeshStandardMaterial,
	texture: THREE.Texture,
	highlight: MovementHighlightTexture,
	voxelAo: VoxelAoTexture,
	performanceMode: boolean
): void {
	const highlightSize = new THREE.Vector2(highlight.width, highlight.length);
	const heightLevels = highlight.heightLevels;

	material.onBeforeCompile = (shader) => {
		applyVoxelAoUniforms(shader, voxelAo);
		shader.uniforms.woodMap = { value: texture };
		shader.uniforms.movementHighlightMap = { value: highlight.texture };
		shader.uniforms.movementHighlightSize = { value: highlightSize };
		shader.uniforms.movementHighlightHeightLevels = { value: heightLevels };

		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			[
				'#include <common>',
				...woodShaderHeader(),
				'uniform vec2 movementHighlightSize;',
				'attribute float tileHeight;',
				'attribute float highlightStrength;',
				'varying float vMovementHighlightHeight;',
				'varying float vMovementHighlightStrength;',
				'varying vec3 vMovementWorldPosition;',
				'varying vec3 vMovementWorldNormal;',
			].join('\n')
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			[
				'#include <begin_vertex>',
				...woodBeginVertex(),
				'vMovementHighlightHeight = tileHeight;',
				'vMovementHighlightStrength = highlightStrength;',
				'vMovementWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
				'vMovementWorldNormal = normalize(mat3(modelMatrix) * normal);',
			].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			[
				'#include <common>',
				...woodFragmentHeader(performanceMode),
				'uniform highp sampler3D movementHighlightMap;',
				'uniform vec2 movementHighlightSize;',
				'uniform float movementHighlightHeightLevels;',
				'varying float vMovementHighlightHeight;',
				'varying float vMovementHighlightStrength;',
				'varying vec3 vMovementWorldPosition;',
				'varying vec3 vMovementWorldNormal;',
			].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			woodColorFragment().join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <dithering_fragment>',
			[
				'vec3 movementOwnerPosition = vMovementWorldPosition - vMovementWorldNormal * 0.002;',
				'vec2 movementTileCoord = clamp(',
				'	floor(movementOwnerPosition.xz + movementHighlightSize * 0.5),',
				'	vec2(0.0),',
				'	movementHighlightSize - vec2(1.0)',
				');',
				'float movementTileHeight = clamp(vMovementHighlightHeight, 0.0, movementHighlightHeightLevels - 1.0);',
				'vec3 movementHighlightUvw = vec3(',
				'	(movementTileCoord.x + 0.5) / movementHighlightSize.x,',
				'	(movementTileHeight + 0.5) / movementHighlightHeightLevels,',
				'	(movementTileCoord.y + 0.5) / movementHighlightSize.y',
				');',
				'vec4 movementHighlight = texture(movementHighlightMap, movementHighlightUvw);',
				'if (movementHighlight.a > 0.0 && vMovementHighlightStrength > 0.0) {',
				'	vec3 baseColor = gl_FragColor.rgb;',
				'	float baseLuma = dot(baseColor, vec3(0.2126, 0.7152, 0.0722));',
				'	vec2 tileLocal = fract(movementOwnerPosition.xz + movementHighlightSize * 0.5);',
				'	float edgeDistance = min(min(tileLocal.x, 1.0 - tileLocal.x), min(tileLocal.y, 1.0 - tileLocal.y));',
				'	float edgeBand = 1.0 - smoothstep(0.025, 0.11, edgeDistance);',
				'	float markAlpha = clamp(movementHighlight.a * (1.35 + edgeBand * 0.75) * vMovementHighlightStrength, 0.0, 0.92);',
				'	vec3 screened = 1.0 - (1.0 - baseColor) * (1.0 - movementHighlight.rgb * 0.85);',
				'	vec3 marked = mix(baseColor, screened, markAlpha);',
				'	marked = max(marked, movementHighlight.rgb * movementHighlight.a * (0.65 + 0.55 * vMovementHighlightStrength));',
				'	vec3 contrastEdge = mix(vec3(1.0), vec3(0.035), step(0.58, baseLuma));',
				'	vec3 edgeColor = mix(movementHighlight.rgb, contrastEdge, 0.45);',
				'	gl_FragColor.rgb = mix(marked, edgeColor, edgeBand * movementHighlight.a * 0.7 * vMovementHighlightStrength);',
				'}',
				'#include <dithering_fragment>',
			].join('\n')
		);
	};
}

export const createWood244Material: MaterialFactory = (
	params: MaterialFactoryParams
): MaterialFactoryResult => {
	const { acceptsMovementHighlight, movementHighlight, voxelAo, performanceMode = false } = params;
	const texture = getWoodTexture(performanceMode);
	const material = new THREE.MeshStandardMaterial({
		roughness: THREE_D_TERRAIN_MATERIAL.ROUGHNESS,
		metalness: THREE_D_TERRAIN_MATERIAL.METALNESS,
		vertexColors: false,
	});

	if (acceptsMovementHighlight && movementHighlight) {
		installWoodHighlightShader(material, texture, movementHighlight, voxelAo, performanceMode);
	} else {
		installWoodAoShader(material, texture, voxelAo, performanceMode);
	}

	return { material, castShadow: true, receiveShadow: true };
};

const wood244Material: TerrainMaterial = {
	bucketKey: 'wood_244',
	occlusionGroup: 'solid',
	shaderVersion: 1,
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
