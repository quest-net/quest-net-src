// Silver material (palette index 248).
//
// Stylized silver using the same domain-warped FBM pattern as gold but with a
// cool blue-grey palette. The double domain warp (q then r) creates swirling
// liquid-metal veins that break the flatness convincingly without requiring
// PBR metalness or an environment map.
//
// The noise is sin-based: deterministic, fast, and perfectly tileable.
// No animation -- t = 0.0 hardcoded. The pattern varies by world position only.
//
// UV projection per face:
//   - Top (Y dominant):   world XZ
//   - X-facing side:      world ZY
//   - Z-facing side:      world XY
//   - Bottom:             flat dark silver
//
// Color scheme: near-white cool silver (col1) over deep slate-blue (col2).
// The domain warp produces dark blue veins through the bright silver body --
// reads as the grain boundaries / tarnish lines in cast or polished silver.
//
// Uses a slightly different UV scale and slightly different seed offsets than
// gold so the two materials look visually distinct despite sharing the same
// underlying technique.

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
import {
	applyMovementHighlightUniforms,
	MOVEMENT_HIGHLIGHT_DITHERING,
	MOVEMENT_HIGHLIGHT_FRAGMENT_HEADER,
	MOVEMENT_HIGHLIGHT_VERTEX_BEGIN,
	MOVEMENT_HIGHLIGHT_VERTEX_HEADER,
} from '../shaders/movementHighlightShader';

// ---------------------------------------------------------------------------
// Tuning knobs
// ---------------------------------------------------------------------------

const SILVER_SWATCH = '#A8B8C8';

/**
 * World-to-UV scale. Slightly higher than gold gives silver finer, denser
 * veining -- consistent with real silver's more delicate grain structure.
 */
const SILVER_UV_SCALE = 0.5;

// col1: cool bright silver (the polished body of the metal).
// col2: deep slate-blue (the shadow / grain boundary accent).
const SILVER_COL1: readonly [number, number, number] = [0.80, 0.82, 0.86];
const SILVER_COL2: readonly [number, number, number] = [0.22, 0.30, 0.45];

const SILVER_ROUGHNESS = 0.35;
const SILVER_METALNESS = 0.0;

// ---------------------------------------------------------------------------
// GLSL -- domain-warped FBM (static, t = 0)
// ---------------------------------------------------------------------------
//
// Same structure as gold but:
//   - Function names prefixed "silver" to keep shaders self-contained.
//   - q.y seed offset changed to vec2(3.1, 4.8) -- gives a different pattern.
//   - r.y seed offset changed to vec2(6.1, 1.4) -- further differentiation.
//   - t=0 constant substitutions identical to gold.

const SILVER_PATTERN_GLSL: string = [
	'mat2 silverRot(float a) { return mat2(sin(a), cos(a), -cos(a), sin(a)); }',
	'float silverNoise(in vec2 x) { return smoothstep(0.,1.,sin(1.5*x.x)*sin(1.5*x.y)); }',
	'float silverFbm(vec2 p) {',
	'	mat2 m = silverRot(0.4);',
	'	float f = 0.0;',
	'	f += 0.500000*(0.5+0.5*silverNoise(p)); p = m*p*2.02;',
	'	f += 0.250000*(0.5+0.5*silverNoise(p)); p = m*p*2.03;',
	'	f += 0.125000*(0.5+0.5*silverNoise(p)); p = m*p*2.01;',
	'	f += 0.015625*(0.5+0.5*silverNoise(p));',
	'	return f/0.96875;',
	'}',
	'float silverFbmLow(vec2 p) {',
	'	mat2 m = silverRot(0.4);',
	'	float f = 0.0;',
	'	f += 0.500000*(0.5+0.5*silverNoise(p)); p = m*p*2.02;',
	'	f += 0.250000*(0.5+0.5*silverNoise(p));',
	'	return f/0.75;',
	'}',
	// Different seed offsets from gold to produce a visually distinct pattern.
	// t=0 substitutions: cos(0)=1 absorbed into vec2 constants.
	'float silverPattern(in vec2 p, out vec2 q, out vec2 r) {',
	'	q.x = silverFbm( 2.0*p );',
	'	q.y = silverFbm( 1.5*p + vec2(3.1, 4.8) );',
	'	r.x = silverFbm( p + 4.*q + vec2(1.7, 9.2) + 0.9*sin(30.*length(q)) );',
	'	r.y = silverFbm( p + 8.*q + vec2(7.1, 1.4) + 0.9*sin(20.*length(q)) );',
	'	return silverFbm( p + 7.*r*silverRot(0.0) );',
	'}',
	'float silverPatternLow(in vec2 p, out vec2 q, out vec2 r) {',
	'	q.x = silverFbmLow( 2.0*p );',
	'	q.y = silverFbmLow( 1.5*p + vec2(3.1, 4.8) );',
	'	r.x = silverFbmLow( p + 4.*q + vec2(1.7, 9.2) );',
	'	r.y = silverFbmLow( p + 8.*q + vec2(7.1, 1.4) );',
	'	return silverFbmLow( p + 7.*r*silverRot(0.0) );',
	'}',
].join('\n');

function silverCommonVertexHeader(): string[] {
	return [
		...VOXEL_AO_VERTEX_HEADER,
		'varying vec3 vSilverWorldPosition;',
		'varying vec3 vSilverWorldNormal;',
	];
}

function silverCommonVertexBegin(): string[] {
	return [
		'vSilverWorldNormal = normalize(mat3(modelMatrix) * normal);',
		'vSilverWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
		...VOXEL_AO_VERTEX_BEGIN,
	];
}

function silverCommonFragmentHeader(performanceMode: boolean): string[] {
	return [
		...getVoxelAoFragmentHeader(performanceMode),
		'varying vec3 vSilverWorldPosition;',
		'varying vec3 vSilverWorldNormal;',
		SILVER_PATTERN_GLSL,
		`const vec3 S_COL1 = vec3(${SILVER_COL1[0].toFixed(3)}, ${SILVER_COL1[1].toFixed(3)}, ${SILVER_COL1[2].toFixed(3)});`,
		`const vec3 S_COL2 = vec3(${SILVER_COL2[0].toFixed(3)}, ${SILVER_COL2[1].toFixed(3)}, ${SILVER_COL2[2].toFixed(3)});`,
	];
}

function silverColorFragment(performanceMode: boolean): string[] {
	const uvSetup = [
		'vec3 sNrm = normalize(vSilverWorldNormal);',
		'bool sIsBottom = sNrm.y < -0.5;',
		'vec2 sUv = vec2(0.0);',
		'if (!sIsBottom) {',
		'	if (abs(sNrm.x) > abs(sNrm.z) && abs(sNrm.x) > abs(sNrm.y)) {',
		`		sUv = vSilverWorldPosition.zy * ${SILVER_UV_SCALE.toFixed(3)};`,
		'	} else if (abs(sNrm.z) > abs(sNrm.y)) {',
		`		sUv = vSilverWorldPosition.xy * ${SILVER_UV_SCALE.toFixed(3)};`,
		'	} else {',
		`		sUv = vSilverWorldPosition.xz * ${SILVER_UV_SCALE.toFixed(3)};`,
		'	}',
		'}',
	];

	const patternCall = performanceMode
		? 'float sF = silverPatternLow(sUv, sQ, sR);'
		: 'float sF = silverPattern(sUv, sQ, sR);';

	// Same color formula as gold, just different palette constants.
	const colorCompute = [
		'	vec2 sQ = vec2(0.0), sR = vec2(0.0);',
		`	${patternCall}`,
		'	vec3 sC = mix(S_COL1, vec3(0.0), pow(smoothstep(0., 0.9, sF), 2.));',
		'	sC += S_COL2 * pow(smoothstep(0., 0.8, dot(sQ, sR)*0.6), 3.) * 1.5;',
		'	sC *= pow(dot(sQ, sR) + 0.3, 3.);',
		'	sC *= sF * 1.5;',
		`	sC *= ${VOXEL_AO_CALL};`,
		'	diffuseColor = vec4(sC, 1.0);',
	];

	return [
		...uvSetup,
		'if (sIsBottom) {',
		`	diffuseColor = vec4(S_COL2 * 0.3 * ${VOXEL_AO_CALL}, 1.0);`,
		'} else {',
		...colorCompute,
		'}',
	];
}

// ---------------------------------------------------------------------------
// Shader installation
// ---------------------------------------------------------------------------

function installSilver248Shader(
	material: THREE.MeshStandardMaterial,
	voxelAo: VoxelAoTexture,
	movementHighlight: MovementHighlightTexture | undefined,
	performanceMode: boolean
): void {
	material.onBeforeCompile = (shader) => {
		applyVoxelAoUniforms(shader, voxelAo);
		applyMovementHighlightUniforms(shader, movementHighlight);

		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			['#include <common>', ...silverCommonVertexHeader(), ...MOVEMENT_HIGHLIGHT_VERTEX_HEADER].join('\n')
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			['#include <begin_vertex>', ...silverCommonVertexBegin(), ...MOVEMENT_HIGHLIGHT_VERTEX_BEGIN].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			['#include <common>', ...silverCommonFragmentHeader(performanceMode), ...MOVEMENT_HIGHLIGHT_FRAGMENT_HEADER].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			silverColorFragment(performanceMode).join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <dithering_fragment>',
			MOVEMENT_HIGHLIGHT_DITHERING.join('\n')
		);
	};
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSilver248Material: MaterialFactory = (
	params: MaterialFactoryParams
): MaterialFactoryResult => {
	const { movementHighlight, voxelAo, performanceMode = false } = params;

	const material = new THREE.MeshStandardMaterial({
		color: SILVER_SWATCH,
		// No emissive -- silver is a cold neutral and reads fine under lighting.
		roughness: SILVER_ROUGHNESS,
		metalness: SILVER_METALNESS,
		vertexColors: false,
		transparent: false,
		depthWrite: true,
	});

	installSilver248Shader(material, voxelAo, movementHighlight, performanceMode);

	// No onAnimationFrame -- static pattern, no time uniform.
	return {
		material,
		castShadow: true,
		receiveShadow: true,
		renderOrder: 0,
	};
};

// ---------------------------------------------------------------------------
// Material definition (collected by materials/index.ts)
// ---------------------------------------------------------------------------

const silver248Material: TerrainMaterial = {
	bucketKey: 'silver_248',
	occlusionGroup: 'solid',
	shaderVersion: 2,
	geometry: {
		vertexColors: false,
		preserveVoxelFaces: false,
		deformSurface: false,
	},
	factory: createSilver248Material,
	special: {
		paletteIndex: 248,
		label: 'Silver',
		swatchColor: SILVER_SWATCH,
		category: 'metals',
	},
};

export default silver248Material;
