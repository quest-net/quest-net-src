// Iron Bars material (palette index 249).
//
// World-projected texture with alpha cutout transparency -- the same UV
// projection trick as stone bricks, but with alphaTest punching out the
// gaps between bars cleanly.
//
// Key choices versus the glass material:
//   - alphaTest (0.5) instead of opacity blending: the bars are either
//     solid iron or fully absent -- no translucency needed, and alphaTest
//     keeps depthWrite on so the bars correctly occlude geometry behind them.
//   - Own occlusionGroup: neighboring iron-bar voxels should NOT cull their
//     shared face (you want to see through the gaps on both sides of a fence),
//     so we isolate them from the "solid" group.
//   - castShadow false: punched-out transparent materials need special shadow
//     handling to cast bar-shaped shadows; leaving it off avoids hard silhouettes.
//   - renderOrder 2: drawn after opaque terrain to avoid depth-sort artifacts
//     near the alpha edge (same slot as glass).
//   - Metalness slightly elevated, roughness moderate: iron reads as a dull metal.

import * as THREE from 'three';
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

// ---------------------------------------------------------------------------
// Tuning knobs
// ---------------------------------------------------------------------------

const IRON_BARS_TEXTURE_URL = '/materials/iron_bars_249/iron_bars_256x256.png';
const IRON_BARS_SWATCH = '#6b6b6b';
const IRON_BARS_TEXTURE_REPEAT = 1.0;
const IRON_BARS_ANISOTROPY = 8;
const IRON_BARS_PERFORMANCE_ANISOTROPY = 1;

const IRON_BARS_ROUGHNESS = 0.55;
const IRON_BARS_METALNESS = 0.45;

// Alpha threshold for the cutout. Pixels with alpha below this are discarded.
const IRON_BARS_ALPHA_TEST = 0.5;

// ---------------------------------------------------------------------------
// Texture cache
// ---------------------------------------------------------------------------

let cachedTexture: THREE.Texture | null = null;
let cachedPerformanceTexture: THREE.Texture | null = null;

function configureIronBarsTexture(
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
		? IRON_BARS_PERFORMANCE_ANISOTROPY
		: IRON_BARS_ANISOTROPY;
	texture.generateMipmaps = !performanceMode;
	return texture;
}

function getIronBarsTexture(performanceMode: boolean): THREE.Texture {
	if (performanceMode) {
		if (!cachedPerformanceTexture) {
			cachedPerformanceTexture = configureIronBarsTexture(
				new THREE.TextureLoader().load(IRON_BARS_TEXTURE_URL),
				true
			);
		}
		return cachedPerformanceTexture;
	}

	if (!cachedTexture) {
		cachedTexture = configureIronBarsTexture(
			new THREE.TextureLoader().load(IRON_BARS_TEXTURE_URL),
			false
		);
	}
	return cachedTexture;
}

// ---------------------------------------------------------------------------
// Shader helpers
// ---------------------------------------------------------------------------

function ironBarsVertexHeader(): string[] {
	return [
		...VOXEL_AO_VERTEX_HEADER,
		'varying vec3 vIronBarsWorldPosition;',
		'varying vec3 vIronBarsWorldNormal;',
	];
}

function ironBarsBeginVertex(): string[] {
	return [
		...VOXEL_AO_VERTEX_BEGIN,
		'vIronBarsWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
		'vIronBarsWorldNormal = normalize(mat3(modelMatrix) * normal);',
	];
}

function ironBarsFragmentHeader(performanceMode: boolean): string[] {
	return [
		...getVoxelAoFragmentHeader(performanceMode),
		'varying vec3 vIronBarsWorldPosition;',
		'varying vec3 vIronBarsWorldNormal;',
		'uniform sampler2D ironBarsMap;',
		'vec2 getIronBarsUv(vec3 worldPosition, vec3 worldNormal) {',
		'	vec3 n = abs(normalize(worldNormal));',
		'	if (n.y >= n.x && n.y >= n.z) return worldPosition.xz;',
		'	if (n.x >= n.z) return worldPosition.zy;',
		'	return worldPosition.xy;',
		'}',
	];
}

// Color fragment: sample texture, apply alpha cutout and AO.
// We patch the alpha into diffuseColor so three.js's built-in alphaTest
// (which tests diffuseColor.a) discards the transparent pixels correctly.
function ironBarsColorFragment(): string[] {
	return [
		'#include <color_fragment>',
		`vec2 ironBarsUv = getIronBarsUv(vIronBarsWorldPosition, vIronBarsWorldNormal) * ${IRON_BARS_TEXTURE_REPEAT.toFixed(1)};`,
		'vec4 ironBarsTexel = texture2D(ironBarsMap, ironBarsUv);',
		'diffuseColor.rgb *= ironBarsTexel.rgb;',
		'diffuseColor.a *= ironBarsTexel.a;',
		`diffuseColor.rgb *= ${VOXEL_AO_CALL};`,
	];
}

// ---------------------------------------------------------------------------
// Shader installation (AO-only path)
// ---------------------------------------------------------------------------

function installIronBarsAoShader(
	material: THREE.MeshStandardMaterial,
	texture: THREE.Texture,
	voxelAo: VoxelAoTexture,
	performanceMode: boolean
): void {
	material.onBeforeCompile = (shader) => {
		applyVoxelAoUniforms(shader, voxelAo);
		shader.uniforms.ironBarsMap = { value: texture };
		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			['#include <common>', ...ironBarsVertexHeader()].join('\n')
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			['#include <begin_vertex>', ...ironBarsBeginVertex()].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			['#include <common>', ...ironBarsFragmentHeader(performanceMode)].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			ironBarsColorFragment().join('\n')
		);
	};
}

// ---------------------------------------------------------------------------
// Shader installation (movement-highlight path)
// ---------------------------------------------------------------------------

function installIronBarsHighlightShader(
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
		shader.uniforms.ironBarsMap = { value: texture };
		shader.uniforms.movementHighlightMap = { value: highlight.texture };
		shader.uniforms.movementHighlightSize = { value: highlightSize };
		shader.uniforms.movementHighlightHeightLevels = { value: heightLevels };

		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			[
				'#include <common>',
				...ironBarsVertexHeader(),
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
				...ironBarsBeginVertex(),
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
				...ironBarsFragmentHeader(performanceMode),
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
			ironBarsColorFragment().join('\n')
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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createIronBars249Material: MaterialFactory = (
	params: MaterialFactoryParams
): MaterialFactoryResult => {
	const { acceptsMovementHighlight, movementHighlight, voxelAo, performanceMode = false } = params;
	const texture = getIronBarsTexture(performanceMode);

	const material = new THREE.MeshStandardMaterial({
		roughness: IRON_BARS_ROUGHNESS,
		metalness: IRON_BARS_METALNESS,
		vertexColors: false,
		// alphaTest punches out transparent pixels while keeping depthWrite on.
		// The gaps between bars are fully discarded; the bars themselves write
		// to the depth buffer and occlude geometry behind them correctly.
		alphaTest: IRON_BARS_ALPHA_TEST,
	});

	if (acceptsMovementHighlight && movementHighlight) {
		installIronBarsHighlightShader(material, texture, movementHighlight, voxelAo, performanceMode);
	} else {
		installIronBarsAoShader(material, texture, voxelAo, performanceMode);
	}

	return {
		material,
		castShadow: false,    // transparent cutout materials skip shadow casting
		receiveShadow: true,
		renderOrder: 2,       // draw after opaque terrain (0) and water/lava (1)
	};
};

// ---------------------------------------------------------------------------
// Material definition (collected by materials/index.ts)
// ---------------------------------------------------------------------------

const ironBars249Material: TerrainMaterial = {
	bucketKey: 'ironbars_249',
	// Own occlusion group: neighboring iron-bar voxels do NOT cull their shared
	// face. The gaps in the bars mean you can see through to the other side, so
	// shared faces must be emitted rather than discarded.
	occlusionGroup: 'ironbars_249',
	shaderVersion: 1,
	geometry: {
		vertexColors: false,
	},
	factory: createIronBars249Material,
	special: {
		paletteIndex: 249,
		label: 'Iron Bars',
		swatchColor: IRON_BARS_SWATCH,
	},
};

export default ironBars249Material;
