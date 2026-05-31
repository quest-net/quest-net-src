// Gold material (palette index 247).
//
// Stylized gold using a domain-warped FBM pattern adapted from the Shadertoy
// "Domain Warping" technique. The core idea: run FBM twice to get offset
// vectors q and r, then use r to warp the final FBM sample. The result is a
// swirling, liquid-metal texture that reads convincingly as cast or poured gold
// without requiring an environment map or PBR metalness.
//
// The noise function is sin-based rather than hash-based, making it fast and
// perfectly deterministic. No animation -- t = 0.0 is hardcoded so the pattern
// is static and purely position-driven.
//
// UV projection per face (world-space, so the pattern wraps around block corners):
//   - Top (Y dominant):   world XZ
//   - X-facing side:      world ZY
//   - Z-facing side:      world XY
//   - Bottom:             flat dark gold (rarely inspected)
//
// Color scheme: warm gold (col1) over deep amber (col2). The domain warp
// creates veined dark seams through the bright gold body -- the "tasteful
// flaw" that breaks the flatness and reads as hammered/cast metal.
//
// Reference: Shadertoy domain-warping pattern by Inigo Quilez / variants.

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

const GOLD_SWATCH = '#CFB53B';

/**
 * World-to-UV scale. Larger = smaller / finer pattern per tile.
 * 1.8 gives primary swirl features roughly 2-3 tiles wide, with finer veining
 * from the FBM octaves and domain warping.
 */
const GOLD_UV_SCALE = 0.6;

// col1: bright warm gold (the lit body of the metal).
// col2: deep amber / orange (the glowing accent in the domain-warp hollows).
const GOLD_COL1: readonly [number, number, number] = [0.90, 0.72, 0.12];
const GOLD_COL2: readonly [number, number, number] = [0.60, 0.32, 0.04];

const GOLD_ROUGHNESS = 0.50;
const GOLD_METALNESS = 0.0;

/** Subtle warm emissive so the gold reads in deep shadow. */
const GOLD_EMISSIVE_COLOR = '#aa4400';
const GOLD_EMISSIVE_INTENSITY = 0.25;

// ---------------------------------------------------------------------------
// GLSL -- domain-warped FBM (static, t = 0)
// ---------------------------------------------------------------------------
//
// Adapted from the Shadertoy pattern. t = 0.0 is hardcoded so the pattern
// never animates; all time-dependent terms collapse to their t=0 values:
//   + 2.*t  -> + 0.0
//   + 1.*t  -> + 0.0
//   + sin(t) -> + 0.0
//   + cos(t) -> + 1.0   (absorbed into the vec2 constant offset below)
//   rot(t)  -> rot(0.0)
//
// The sin-based goldNoise is deterministic, perfectly tileable, and costs
// only 2 sin() calls per evaluation -- much cheaper than hash Voronoi.

const GOLD_PATTERN_GLSL: string = [
	// Rotation matrix (same convention as the source Shadertoy).
	'mat2 goldRot(float a) { return mat2(sin(a), cos(a), -cos(a), sin(a)); }',
	// Smooth sin-product noise: always in [0,1], no random hash needed.
	'float goldNoise(in vec2 x) { return smoothstep(0.,1.,sin(1.5*x.x)*sin(1.5*x.y)); }',
	// FBM: 4 octaves, each rotated slightly so the pattern does not axis-align.
	// Performance mode uses 2 octaves (halved cost) -- see goldFbmLow below.
	'float goldFbm(vec2 p) {',
	'	mat2 m = goldRot(0.4);',
	'	float f = 0.0;',
	'	f += 0.500000*(0.5+0.5*goldNoise(p)); p = m*p*2.02;',
	'	f += 0.250000*(0.5+0.5*goldNoise(p)); p = m*p*2.03;',
	'	f += 0.125000*(0.5+0.5*goldNoise(p)); p = m*p*2.01;',
	'	f += 0.015625*(0.5+0.5*goldNoise(p));',
	'	return f/0.96875;',
	'}',
	// Reduced 2-octave FBM for the performance path.
	'float goldFbmLow(vec2 p) {',
	'	mat2 m = goldRot(0.4);',
	'	float f = 0.0;',
	'	f += 0.500000*(0.5+0.5*goldNoise(p)); p = m*p*2.02;',
	'	f += 0.250000*(0.5+0.5*goldNoise(p));',
	'	return f/0.75;',
	'}',
	// Domain-warped pattern. q warps the domain once; r warps it again using q.
	// Static version: all t-dependent offsets replaced with their t=0 values.
	//   cos(0) = 1.0  ->  vec2(8.3,2.8) + 1.0  =  vec2(9.3,2.8)
	//   rot(0) produces a 90-degree rotation matrix
	'float goldPattern(in vec2 p, out vec2 q, out vec2 r) {',
	'	q.x = goldFbm( 2.0*p );',
	'	q.y = goldFbm( 1.5*p + vec2(5.2, 1.3) );',
	'	r.x = goldFbm( p + 4.*q + vec2(1.7, 9.2) + 0.9*sin(30.*length(q)) );',
	'	r.y = goldFbm( p + 8.*q + vec2(9.3, 2.8) + 0.9*sin(20.*length(q)) );',
	'	return goldFbm( p + 7.*r*goldRot(0.0) );',
	'}',
	// Performance variant: 2-octave FBM, one less warp layer.
	'float goldPatternLow(in vec2 p, out vec2 q, out vec2 r) {',
	'	q.x = goldFbmLow( 2.0*p );',
	'	q.y = goldFbmLow( 1.5*p + vec2(5.2, 1.3) );',
	'	r.x = goldFbmLow( p + 4.*q + vec2(1.7, 9.2) );',
	'	r.y = goldFbmLow( p + 8.*q + vec2(9.3, 2.8) );',
	'	return goldFbmLow( p + 7.*r*goldRot(0.0) );',
	'}',
].join('\n');

function goldCommonVertexHeader(): string[] {
	return [
		...VOXEL_AO_VERTEX_HEADER,
		'varying vec3 vGoldWorldPosition;',
		'varying vec3 vGoldWorldNormal;',
	];
}

function goldCommonVertexBegin(): string[] {
	return [
		'vGoldWorldNormal = normalize(mat3(modelMatrix) * normal);',
		'vGoldWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
		...VOXEL_AO_VERTEX_BEGIN,
	];
}

function goldCommonFragmentHeader(performanceMode: boolean): string[] {
	return [
		...getVoxelAoFragmentHeader(performanceMode),
		'varying vec3 vGoldWorldPosition;',
		'varying vec3 vGoldWorldNormal;',
		GOLD_PATTERN_GLSL,
		`const vec3 G_COL1 = vec3(${GOLD_COL1[0].toFixed(3)}, ${GOLD_COL1[1].toFixed(3)}, ${GOLD_COL1[2].toFixed(3)});`,
		`const vec3 G_COL2 = vec3(${GOLD_COL2[0].toFixed(3)}, ${GOLD_COL2[1].toFixed(3)}, ${GOLD_COL2[2].toFixed(3)});`,
	];
}

function goldColorFragment(performanceMode: boolean): string[] {
	// UV projection: choose the two most planar world axes per face normal so
	// the pattern wraps around block corners without stretching.
	const uvSetup = [
		'vec3 gNrm = normalize(vGoldWorldNormal);',
		'bool gIsBottom = gNrm.y < -0.5;',
		'vec2 gUv = vec2(0.0);',
		'if (!gIsBottom) {',
		'	if (abs(gNrm.x) > abs(gNrm.z) && abs(gNrm.x) > abs(gNrm.y)) {',
		`		gUv = vGoldWorldPosition.zy * ${GOLD_UV_SCALE.toFixed(3)};`,
		'	} else if (abs(gNrm.z) > abs(gNrm.y)) {',
		`		gUv = vGoldWorldPosition.xy * ${GOLD_UV_SCALE.toFixed(3)};`,
		'	} else {',
		`		gUv = vGoldWorldPosition.xz * ${GOLD_UV_SCALE.toFixed(3)};`,
		'	}',
		'}',
	];

	const patternCall = performanceMode
		? 'float gF = goldPatternLow(gUv, gQ, gR);'
		: 'float gF = goldPattern(gUv, gQ, gR);';

	// Color formula verbatim from the Shadertoy, applied to our palette.
	// mix(col1, black, ...) creates the dark veins. col2 adds warm accent where
	// dot(q,r) is high. The two power-multiplies add strong contrast. f*1.5
	// scales overall brightness so the pattern has deep darks and bright peaks.
	const colorCompute = [
		'	vec2 gQ = vec2(0.0), gR = vec2(0.0);',
		`	${patternCall}`,
		'	vec3 gC = mix(G_COL1, vec3(0.0), pow(smoothstep(0., 0.9, gF), 2.));',
		'	gC += G_COL2 * pow(smoothstep(0., 0.8, dot(gQ, gR)*0.6), 3.) * 1.5;',
		'	gC *= pow(dot(gQ, gR) + 0.3, 3.);',
		'	gC *= gF * 1.5;',
		`	gC *= ${VOXEL_AO_CALL};`,
		'	diffuseColor = vec4(gC, 1.0);',
	];

	return [
		...uvSetup,
		'if (gIsBottom) {',
		`	diffuseColor = vec4(G_COL2 * 0.3 * ${VOXEL_AO_CALL}, 1.0);`,
		'} else {',
		...colorCompute,
		'}',
	];
}

// ---------------------------------------------------------------------------
// Movement-highlight overlay (identical to water / lava)
// ---------------------------------------------------------------------------

const GOLD_MOVEMENT_HIGHLIGHT_FRAGMENT = [
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
].join('\n');

// ---------------------------------------------------------------------------
// Shader installation
// ---------------------------------------------------------------------------

function installGoldAoShader(
	material: THREE.MeshStandardMaterial,
	voxelAo: VoxelAoTexture,
	performanceMode: boolean
): void {
	material.onBeforeCompile = (shader) => {
		applyVoxelAoUniforms(shader, voxelAo);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			['#include <common>', ...goldCommonVertexHeader()].join('\n')
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			['#include <begin_vertex>', ...goldCommonVertexBegin()].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			['#include <common>', ...goldCommonFragmentHeader(performanceMode)].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			goldColorFragment(performanceMode).join('\n')
		);
	};
}

function installGoldHighlightShader(
	material: THREE.MeshStandardMaterial,
	highlight: MovementHighlightTexture,
	voxelAo: VoxelAoTexture,
	performanceMode: boolean
): void {
	const highlightSize = new THREE.Vector2(highlight.width, highlight.length);
	const heightLevels = highlight.heightLevels;

	material.onBeforeCompile = (shader) => {
		applyVoxelAoUniforms(shader, voxelAo);
		shader.uniforms.movementHighlightMap = { value: highlight.texture };
		shader.uniforms.movementHighlightSize = { value: highlightSize };
		shader.uniforms.movementHighlightHeightLevels = { value: heightLevels };

		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			[
				'#include <common>',
				...goldCommonVertexHeader(),
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
				...goldCommonVertexBegin(),
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
				...goldCommonFragmentHeader(performanceMode),
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
			goldColorFragment(performanceMode).join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <dithering_fragment>',
			GOLD_MOVEMENT_HIGHLIGHT_FRAGMENT
		);
	};
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createGold247Material: MaterialFactory = (
	params: MaterialFactoryParams
): MaterialFactoryResult => {
	const { acceptsMovementHighlight, movementHighlight, voxelAo, performanceMode = false } = params;

	const material = new THREE.MeshStandardMaterial({
		color: GOLD_SWATCH,
		emissive: new THREE.Color(GOLD_EMISSIVE_COLOR),
		emissiveIntensity: GOLD_EMISSIVE_INTENSITY,
		roughness: GOLD_ROUGHNESS,
		metalness: GOLD_METALNESS,
		vertexColors: false,
		transparent: false,
		depthWrite: true,
	});

	if (acceptsMovementHighlight && movementHighlight) {
		installGoldHighlightShader(material, movementHighlight, voxelAo, performanceMode);
	} else {
		installGoldAoShader(material, voxelAo, performanceMode);
	}

	// No onAnimationFrame -- static pattern, no time uniform needed.
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

const gold247Material: TerrainMaterial = {
	bucketKey: 'gold_247',
	// Solid group: culls shared faces with default terrain and other solids.
	occlusionGroup: 'solid',
	shaderVersion: 2,
	geometry: {
		vertexColors: false,
		// Greedy merge safe -- UVs are world-projected in the shader.
		preserveVoxelFaces: false,
		deformSurface: false,
	},
	factory: createGold247Material,
	special: {
		paletteIndex: 247,
		label: 'Gold',
		swatchColor: GOLD_SWATCH,
		category: 'metals',
	},
};

export default gold247Material;
