// "Sea of clouds" material -- SURROUNDINGS-ONLY, not a terrain bucket.
//
// Fog voxels (palette 251) render volumetrically inside the terrain, but the
// surroundings plane is a single flat sheet far outside the fog volume, so the
// raymarch pass cannot draw it. Instead, picking the Fog swatch as the
// surroundings material renders this stylized cloud-top shader.
//
// Technique notes (adapted from Inigo Quilez's "dynamic 2D clouds" article and
// the stylized-puffy-clouds vertex-displacement approach):
//   - BILLOW noise: each FBM octave is 1 - abs(2n - 1), which folds value
//     noise into rounded, cauliflower-shaped puffs instead of smooth dunes.
//   - PER-OCTAVE DRIFT: every octave accumulates extra drift relative to the
//     previous one, so the turbulence is re-composed each frame -- the field
//     boils and morphs ("bubbles shifting across the plane") instead of
//     sliding past as one rigid texture.
//   - VERTEX DISPLACEMENT: tessellated surroundings vertices (see
//     useSurroundingsPlane's detail band) rise by a low-octave evaluation of
//     the SAME field, gated by surfaceDeformStrength, so mounds have a real
//     silhouette and shifting shapes at the horizon line of the sheet.
//   - GRADIENT NORMALS: the fragment shader finite-differences the displaced
//     heightfield and feeds the resulting world normal into the standard
//     lighting chain (same slot normal maps use), so the scene's directional
//     light shades each mound -- lit flank, shadowed flank -- which is what
//     actually sells "fluffy" on a flat sheet.
//   - THRESHOLD REMAP + TWO-COLOR RAMP: a (low, high) smoothstep controls the
//     cloud/valley balance and edge sharpness; color lerps shadowed valleys
//     to sunlit tops; thin gaps go slightly translucent so terrain far below
//     ghosts through as broken cover.
//
// Not registered in TERRAIN_MATERIALS: it has no palette index, no bucket, and
// must never be greedy-meshed. Because it bypasses the registry's cache-key
// wrapper, it stamps its own customProgramCacheKey -- the surroundings mesh is
// rebuilt (new material instance) on every voxel edit, and the stable key is
// what keeps three.js from recompiling the program each time.
//
// Shares the voxel-AO shader scaffolding with the real terrain materials so the
// factory contract (MaterialFactoryParams) stays uniform; the surroundings
// plane always supplies the placeholder "fully empty" AO texture, making the
// AO term a no-op there.

import * as THREE from 'three';
import type {
	MaterialFactory,
	MaterialFactoryParams,
	MaterialFactoryResult,
} from './materialTypes';
import {
	applyVoxelAoUniforms,
	getVoxelAoFragmentHeader,
	VOXEL_AO_CALL,
	VOXEL_AO_VERTEX_BEGIN,
	VOXEL_AO_VERTEX_HEADER,
} from '../shaders/voxelAoShader';

// Bump when the shader source below changes (drives the program cache key).
const CLOUDS_SHADER_VERSION = 2;

// ---------------------------------------------------------------------------
// Tuning knobs
// ---------------------------------------------------------------------------

/** World units per noise unit -- larger = broader, lazier cloud mounds. */
const CLOUD_CELL_SIZE = 16.0;
/** Base drift in noise units per second (deliberately slow). */
const CLOUD_DRIFT: readonly [number, number] = [0.020, 0.009];
/**
 * Extra drift accumulated per FBM octave (relative to the base drift). This
 * is the "boiling" knob: 0 slides the whole pattern rigidly; higher values
 * make octaves shear past each other so mounds form and dissolve in place.
 */
const CLOUD_OCTAVE_DRIFT = 0.7;
/** Domain-warp strength in noise units; gives mounds their billowy outline. */
const CLOUD_WARP = 0.60;

/**
 * Threshold remap of the billow-FBM field: below LOW reads as valley/gap,
 * above HIGH as full cloud top. Narrower = sharper cloud edges.
 */
const CLOUD_THRESHOLD_LOW = 0.34;
const CLOUD_THRESHOLD_HIGH = 0.88;

/** Sunlit cloud tops. */
const CLOUD_TOP_COLOR:    readonly [number, number, number] = [0.97, 0.97, 1.00];
/** Shadowed valleys between mounds. */
const CLOUD_SHADOW_COLOR: readonly [number, number, number] = [0.58, 0.63, 0.76];

/** Alpha over dense cloud (near opaque). */
const CLOUD_BODY_ALPHA = 0.80;
/** Alpha in the thin gaps between mounds -- lets far-below terrain ghost through. */
const CLOUD_GAP_ALPHA = 0.72;
/** Density band that fades gap alpha up to body alpha. */
const CLOUD_ALPHA_LOW = 0.30;
const CLOUD_ALPHA_HIGH = 0.52;

/** Vertex puff amplitude in world units (gated by surfaceDeformStrength). */
const CLOUD_PUFF_AMPLITUDE = 1.25;
/** Exaggeration of the heightfield gradient fed into the lighting normal. */
const CLOUD_NORMAL_BOOST = 1.6;
/** Finite-difference step for the gradient, in noise units. */
const CLOUD_GRADIENT_EPSILON = 0.06;

/** Clouds are matte. */
const CLOUD_ROUGHNESS = 1.0;
const CLOUD_METALNESS = 0.0;

const CLOUD_FRAGMENT_OCTAVES = 5;
const CLOUD_FRAGMENT_PERFORMANCE_OCTAVES = 3;
/** Vertex displacement octaves -- the first octaves of the fragment field, so
 *  the silhouette tracks the shading. */
const CLOUD_VERTEX_OCTAVES = 3;

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

/**
 * Billow-FBM with per-octave drift. The same source is injected into both
 * stages (separate compilation units), differing only in octave count; the
 * octave recurrence is identical, so a low-octave vertex evaluation is a
 * smoothed version of the fragment field, not a different field.
 */
function cloudFbmGlsl(octaves: number): string {
	return [
		'float cloudHash(vec2 p) {',
		'	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);',
		'}',
		'float cloudNoise(vec2 p) {',
		'	vec2 i = floor(p);',
		'	vec2 f = fract(p);',
		'	vec2 u = f * f * (3.0 - 2.0 * f);',
		'	float a = cloudHash(i);',
		'	float b = cloudHash(i + vec2(1.0, 0.0));',
		'	float c = cloudHash(i + vec2(0.0, 1.0));',
		'	float d = cloudHash(i + vec2(1.0, 1.0));',
		'	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
		'}',
		'float cloudBillow(vec2 p) {',
		'	return 1.0 - abs(2.0 * cloudNoise(p) - 1.0);',
		'}',
		'float cloudFbm(vec2 p, vec2 drift) {',
		'	float v = 0.0;',
		'	float amp = 0.5;',
		'	vec2 q = p + drift;',
		`	for (int i = 0; i < ${octaves}; i++) {`,
		'		v += amp * cloudBillow(q);',
		`		q = q * 2.03 + vec2(17.3, 9.1) + drift * ${CLOUD_OCTAVE_DRIFT.toFixed(3)};`,
		'		amp *= 0.5;',
		'	}',
		'	return v;',
		'}',
	].join('\n');
}

/**
 * Shared uv/drift derivation -- vertex and fragment both divide world XZ by
 * the same cell size and use the same drift velocities, keeping the two
 * stages' fields in lockstep.
 */
function cloudUvLines(worldExpr: string, prefix: string): string[] {
	return [
		`vec2 ${prefix}Uv = ${worldExpr}.xz / ${CLOUD_CELL_SIZE.toFixed(3)};`,
		`vec2 ${prefix}Drift = vec2(uCloudTime * ${CLOUD_DRIFT[0].toFixed(4)}, uCloudTime * ${CLOUD_DRIFT[1].toFixed(4)});`,
	];
}

function cloudsVertexHeader(): string[] {
	return [
		'attribute float surfaceDeformStrength;',
		...VOXEL_AO_VERTEX_HEADER,
		'varying vec3 vCloudWorldPosition;',
		'varying vec3 vCloudWorldNormal;',
		'uniform float uCloudTime;',
		cloudFbmGlsl(CLOUD_VERTEX_OCTAVES),
	];
}

function cloudsVertexBegin(): string[] {
	// Puff displacement: brightness of the (low-octave) field raises the
	// vertex, gated by surfaceDeformStrength so walls/seams stay pinned.
	// Upward only -- the sheet's rest height is the cloud floor.
	return [
		'vCloudWorldNormal = normalize(mat3(modelMatrix) * normal);',
		'vec3 cloudWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
		...cloudUvLines('cloudWorld', 'cv'),
		'float cvWarp = cloudFbm(cvUv * 0.5, cvDrift * 0.6);',
		`vec2 cvUvW = cvUv + vec2(cvWarp, -cvWarp) * ${CLOUD_WARP.toFixed(3)};`,
		'float cvDensity = cloudFbm(cvUvW, cvDrift);',
		`float cvPuff = smoothstep(${CLOUD_THRESHOLD_LOW.toFixed(3)}, ${CLOUD_THRESHOLD_HIGH.toFixed(3)}, cvDensity);`,
		`transformed.y += cvPuff * ${CLOUD_PUFF_AMPLITUDE.toFixed(3)} * surfaceDeformStrength;`,
		'vCloudWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
		...VOXEL_AO_VERTEX_BEGIN,
	];
}

function cloudsFragmentHeader(performanceMode: boolean): string[] {
	const octaves = performanceMode
		? CLOUD_FRAGMENT_PERFORMANCE_OCTAVES
		: CLOUD_FRAGMENT_OCTAVES;
	return [
		...getVoxelAoFragmentHeader(performanceMode),
		'varying vec3 vCloudWorldPosition;',
		'varying vec3 vCloudWorldNormal;',
		'uniform float uCloudTime;',
		`const vec3 C_TOP = vec3(${CLOUD_TOP_COLOR[0].toFixed(3)}, ${CLOUD_TOP_COLOR[1].toFixed(3)}, ${CLOUD_TOP_COLOR[2].toFixed(3)});`,
		`const vec3 C_SHADOW = vec3(${CLOUD_SHADOW_COLOR[0].toFixed(3)}, ${CLOUD_SHADOW_COLOR[1].toFixed(3)}, ${CLOUD_SHADOW_COLOR[2].toFixed(3)});`,
		// World-space heightfield gradient, written by the color block (which
		// runs before normal_fragment_begin in the standard chunk order) and
		// consumed by the normal override below.
		'vec2 cCloudGrad = vec2(0.0);',
		cloudFbmGlsl(octaves),
	];
}

function cloudsColorFragment(performanceMode: boolean): string[] {
	const thresholdLo = CLOUD_THRESHOLD_LOW.toFixed(3);
	const thresholdHi = CLOUD_THRESHOLD_HIGH.toFixed(3);
	const alphaLine =
		`float cAlpha = mix(${CLOUD_GAP_ALPHA.toFixed(3)}, ${CLOUD_BODY_ALPHA.toFixed(3)}, ` +
		`smoothstep(${CLOUD_ALPHA_LOW.toFixed(3)}, ${CLOUD_ALPHA_HIGH.toFixed(3)}, cDensity));`;

	if (performanceMode) {
		// No domain warp, no gradient normals -- one FBM evaluation.
		return [
			...cloudUvLines('vCloudWorldPosition', 'c'),
			'float cDensity = cloudFbm(cUv, cDrift);',
			`float cTops = smoothstep(${thresholdLo}, ${thresholdHi}, cDensity);`,
			'vec3 cColor = mix(C_SHADOW, C_TOP, cTops);',
			`cColor *= ${VOXEL_AO_CALL};`,
			alphaLine,
			'diffuseColor = vec4(cColor, cAlpha);',
		];
	}

	// Full quality. The gradient is the analytic slope of the DISPLACED
	// surface h = amplitude * smoothstep(lo, hi, density): finite-difference
	// the density field, then scale by the smoothstep derivative at this
	// fragment so shading matches the silhouette the vertex stage built.
	const gradientEpsilon = CLOUD_GRADIENT_EPSILON.toFixed(4);
	const slopeToWorld = (
		(CLOUD_PUFF_AMPLITUDE * CLOUD_NORMAL_BOOST) /
		(CLOUD_GRADIENT_EPSILON * CLOUD_CELL_SIZE)
	).toFixed(4);
	const smoothstepGain = (6.0 / (CLOUD_THRESHOLD_HIGH - CLOUD_THRESHOLD_LOW)).toFixed(4);
	return [
		...cloudUvLines('vCloudWorldPosition', 'c'),
		'float cWarp = cloudFbm(cUv * 0.5, cDrift * 0.6);',
		`vec2 cUvW = cUv + vec2(cWarp, -cWarp) * ${CLOUD_WARP.toFixed(3)};`,
		'float cDensity = cloudFbm(cUvW, cDrift);',
		`float cTops = smoothstep(${thresholdLo}, ${thresholdHi}, cDensity);`,
		`float cDx = cloudFbm(cUvW + vec2(${gradientEpsilon}, 0.0), cDrift);`,
		`float cDz = cloudFbm(cUvW + vec2(0.0, ${gradientEpsilon}), cDrift);`,
		`float cT = clamp((cDensity - ${thresholdLo}) / (${thresholdHi} - ${thresholdLo}), 0.0, 1.0);`,
		`float cSlopeGain = ${smoothstepGain} * cT * (1.0 - cT);`,
		`cCloudGrad = vec2(cDx - cDensity, cDz - cDensity) * (${slopeToWorld} * cSlopeGain);`,
		'vec3 cColor = mix(C_SHADOW, C_TOP, cTops);',
		`cColor *= ${VOXEL_AO_CALL};`,
		alphaLine,
		'diffuseColor = vec4(cColor, cAlpha);',
	];
}

/**
 * Override the lighting normal with the heightfield normal (top sheet only;
 * the skirt keeps its geometric normal). Same injection point normal maps
 * use: after normal_fragment_begin, before the lighting chunks consume it.
 * three.js lights in view space, so the world normal is rotated by viewMatrix.
 */
const CLOUDS_NORMAL_FRAGMENT: readonly string[] = [
	'#include <normal_fragment_begin>',
	'if (vCloudWorldNormal.y > 0.5) {',
	'	vec3 cWorldN = normalize(vec3(-cCloudGrad.x, 1.0, -cCloudGrad.y));',
	'	normal = normalize((viewMatrix * vec4(cWorldN, 0.0)).xyz);',
	'}',
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSurroundingsCloudsMaterial: MaterialFactory = (
	params: MaterialFactoryParams
): MaterialFactoryResult => {
	const { voxelAo, performanceMode = false } = params;

	const timeUniform = { value: 0 };

	const material = new THREE.MeshStandardMaterial({
		roughness: CLOUD_ROUGHNESS,
		metalness: CLOUD_METALNESS,
		vertexColors: false,
		transparent: true,
		// Near-opaque body; writing depth keeps actors/terrain below the sheet
		// from blending through dense cloud (matches the water material).
		depthWrite: true,
	});

	material.onBeforeCompile = (shader) => {
		applyVoxelAoUniforms(shader, voxelAo);
		shader.uniforms.uCloudTime = timeUniform;

		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			['#include <common>', ...cloudsVertexHeader()].join('\n')
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			['#include <begin_vertex>', ...cloudsVertexBegin()].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			['#include <common>', ...cloudsFragmentHeader(performanceMode)].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			cloudsColorFragment(performanceMode).join('\n')
		);
		if (!performanceMode) {
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <normal_fragment_begin>',
				CLOUDS_NORMAL_FRAGMENT.join('\n')
			);
		}
	};

	// Stable program cache key (normally stamped by the registry wrapper, which
	// this factory bypasses). The surroundings mesh allocates a fresh material
	// on every rebuild; this is what makes those rebuilds compile-free.
	const key = [
		'surroundings-clouds',
		`v${CLOUDS_SHADER_VERSION}`,
		'nh',
		performanceMode ? 'perf' : 'full',
	].join('-');
	material.customProgramCacheKey = () => key;
	material.needsUpdate = true;

	const onAnimationFrame = (timeMs: number) => {
		timeUniform.value = timeMs * 0.001;
	};

	return {
		material,
		onAnimationFrame,
		castShadow: false,
		receiveShadow: true, // a floating island shadows the cloud sea below it
		renderOrder: 1,      // transparent: draw after opaque terrain
	};
};
