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
	VOXEL_AO_CALL,
	VOXEL_AO_FRAGMENT_HEADER,
	VOXEL_AO_VERTEX_BEGIN,
	VOXEL_AO_VERTEX_HEADER,
	type VoxelAoTexture,
} from '../shaders/voxelAoShader';

const STONE_BRICKS_TEXTURE_URL = '/materials/bricks_240/bricks_256x256.png';
const STONE_BRICKS_SWATCH = '#8f8f8f';
const STONE_BRICKS_TEXTURE_REPEAT = 1.0;
const STONE_BRICKS_ANISOTROPY = 8;

let cachedTexture: THREE.Texture | null = null;

function getStoneBricksTexture(): THREE.Texture {
	if (cachedTexture) return cachedTexture;

	const texture = new THREE.TextureLoader().load(STONE_BRICKS_TEXTURE_URL);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.anisotropy = STONE_BRICKS_ANISOTROPY;
	texture.generateMipmaps = true;
	cachedTexture = texture;
	return texture;
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

function stoneBricksFragmentHeader(): string[] {
	return [
		...VOXEL_AO_FRAGMENT_HEADER,
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

function installStoneBricksAoShader(
	material: THREE.MeshStandardMaterial,
	texture: THREE.Texture,
	voxelAo: VoxelAoTexture
): void {
	material.onBeforeCompile = (shader) => {
		applyVoxelAoUniforms(shader, voxelAo);
		shader.uniforms.stoneBricksMap = { value: texture };
		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			['#include <common>', ...stoneBricksShaderHeader()].join('\n')
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			['#include <begin_vertex>', ...stoneBricksBeginVertex()].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			['#include <common>', ...stoneBricksFragmentHeader()].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			stoneBricksColorFragment().join('\n')
		);
	};
}

function installStoneBricksHighlightShader(
	material: THREE.MeshStandardMaterial,
	texture: THREE.Texture,
	highlight: MovementHighlightTexture,
	voxelAo: VoxelAoTexture
): void {
	const highlightSize = new THREE.Vector2(highlight.width, highlight.length);
	const heightLevels = highlight.heightLevels;

	material.onBeforeCompile = (shader) => {
		applyVoxelAoUniforms(shader, voxelAo);
		shader.uniforms.stoneBricksMap = { value: texture };
		shader.uniforms.movementHighlightMap = { value: highlight.texture };
		shader.uniforms.movementHighlightSize = { value: highlightSize };
		shader.uniforms.movementHighlightHeightLevels = { value: heightLevels };

		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			[
				'#include <common>',
				...stoneBricksShaderHeader(),
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
				...stoneBricksBeginVertex(),
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
				...stoneBricksFragmentHeader(),
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
			stoneBricksColorFragment().join('\n')
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

export const createStoneBricks240Material: MaterialFactory = (
	params: MaterialFactoryParams
): MaterialFactoryResult => {
	const { acceptsMovementHighlight, movementHighlight, voxelAo } = params;
	const texture = getStoneBricksTexture();
	const material = new THREE.MeshStandardMaterial({
		roughness: THREE_D_TERRAIN_MATERIAL.ROUGHNESS,
		metalness: THREE_D_TERRAIN_MATERIAL.METALNESS,
		vertexColors: false,
	});

	if (acceptsMovementHighlight && movementHighlight) {
		installStoneBricksHighlightShader(material, texture, movementHighlight, voxelAo);
	} else {
		installStoneBricksAoShader(material, texture, voxelAo);
	}

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
	},
};

export default stoneBricks240Material;
