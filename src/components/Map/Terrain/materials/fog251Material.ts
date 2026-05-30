// Fog material (palette index 251).
//
// One material that reads as fog, smoke, or clouds depending purely on how the
// DM paints the voxels: a thin flat layer reads as ground fog, a high flat
// sheet as clouds, a tall column as a smoke plume. The look comes from animated
// fractal noise driving the OPACITY (and a little of the color), not a uniform
// transparency -- so you get billowing blotches of dense and thin rather than a
// flat glassy pane.
//
// Technique (surface-shaded, NOT volumetric raymarching -- far cheaper and it
// plugs straight into MeshStandardMaterial like water/lava):
//   - Value-noise fBm: sum several octaves of 3D noise (each 2x frequency, 1/2
//     amplitude) for cloudy density variation. (iquilezles.org/articles/fbm)
//   - Domain warp: feed an fBm offset back into the fBm sample position
//     (f(p + f(p))). This is what turns flat noise into wispy, billowing
//     structure instead of TV static. (iquilezles.org/articles/warp)
//   - Animate by slowly drifting + churning the sample position with uFogTime.
//   - Map the warped density through smoothstep to carve soft holes (fully
//     transparent) and dense cores (near opaque); tint thin->dense between a
//     dim grey and near-white, then apply voxel AO and let scene lighting shade
//     it so fog tints with the environment (bright in daylight, dim in caves).
//
// Fog is passable (see `passable` below): actors and raycasts pass straight
// through. Like glass it ignores the movement-highlight overlay (you never path
// onto fog), so there is a single AO+noise shader variant -- no highlight path.
//
// Performance mode drops octave count and skips the domain warp.

import * as THREE from 'three';
import type {
	MaterialFactory,
	MaterialFactoryParams,
	MaterialFactoryResult,
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

const FOG_SWATCH = '#cfd4dc';

/** Color of thin (low-density) fog -- a dim cool grey. */
const FOG_COLOR_THIN:  readonly [number, number, number] = [0.55, 0.58, 0.63];
/** Color of dense (high-density) fog -- near white. */
const FOG_COLOR_DENSE: readonly [number, number, number] = [0.93, 0.95, 0.98];

/** World-space scale of the noise (lower = larger, softer blobs). */
const FOG_NOISE_SCALE = 0.42;

/** Slow drift of the noise field over time (world units/sec-ish, * scale). */
const FOG_DRIFT: readonly [number, number, number] = [0.045, 0.020, 0.032];

/** Domain-warp strength (full quality only). Higher = more billowing. */
const FOG_WARP_STRENGTH = 1.7;

/** fBm octaves. More = finer wisps, more cost. */
const FOG_OCTAVES_FULL = 5;
const FOG_OCTAVES_PERF = 3;

/**
 * Density -> alpha shaping. The shaped density (0..1) is mapped across the
 * MIN_ALPHA..MAX_ALPHA range:
 *   - FOG_MIN_ALPHA is the opacity floor for the thinnest spots. Raise it so
 *     the "holes" stay faintly hazy instead of going fully transparent. Set to
 *     0.0 for see-through gaps.
 *   - FOG_MAX_ALPHA is the opacity of the densest cores. Lower it for an
 *     overall thinner/gauzier fog; raise it (up to 1.0) for thick, near-solid
 *     cores.
 * LOW/HIGH control where along the noise the thin->dense transition happens.
 * The fBm density centers around ~0.5, so:
 *   - LOWER FOG_DENSITY_LOW  => denser fog (fewer fully-invisible gaps).
 *   - LOWER FOG_DENSITY_HIGH => cores reach full opacity sooner (thicker look).
 *   - A narrower LOW..HIGH band => harder-edged blotches.
 */
const FOG_DENSITY_LOW  = 0.24;
const FOG_DENSITY_HIGH = 0.86;
const FOG_MIN_ALPHA    = 0.0;
const FOG_MAX_ALPHA    = 0.82;

/** Matte dielectric: fog is a soft, non-metallic, fully-rough volume. */
const FOG_ROUGHNESS = 1.0;
const FOG_METALNESS = 0.0;

// ---------------------------------------------------------------------------
// GLSL: 3D value-noise fBm + domain warp
// ---------------------------------------------------------------------------

function fogNoiseGlsl(octaves: number, useWarp: boolean): string[] {
	const lines = [
		'float fogHash(vec3 p) {',
		'	return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);',
		'}',
		// Trilinearly-interpolated value noise with a smootherstep fade.
		'float fogValueNoise(vec3 p) {',
		'	vec3 i = floor(p);',
		'	vec3 f = fract(p);',
		'	vec3 u = f * f * (3.0 - 2.0 * f);',
		'	float n000 = fogHash(i + vec3(0.0, 0.0, 0.0));',
		'	float n100 = fogHash(i + vec3(1.0, 0.0, 0.0));',
		'	float n010 = fogHash(i + vec3(0.0, 1.0, 0.0));',
		'	float n110 = fogHash(i + vec3(1.0, 1.0, 0.0));',
		'	float n001 = fogHash(i + vec3(0.0, 0.0, 1.0));',
		'	float n101 = fogHash(i + vec3(1.0, 0.0, 1.0));',
		'	float n011 = fogHash(i + vec3(0.0, 1.0, 1.0));',
		'	float n111 = fogHash(i + vec3(1.0, 1.0, 1.0));',
		'	float nx00 = mix(n000, n100, u.x);',
		'	float nx10 = mix(n010, n110, u.x);',
		'	float nx01 = mix(n001, n101, u.x);',
		'	float nx11 = mix(n011, n111, u.x);',
		'	float nxy0 = mix(nx00, nx10, u.y);',
		'	float nxy1 = mix(nx01, nx11, u.y);',
		'	return mix(nxy0, nxy1, u.z);',
		'}',
		// fBm: octaves of value noise, 2x freq / 0.5 amp each. Normalized so the
		// result spans ~[0,1] regardless of octave count.
		'float fogFbm(vec3 p) {',
		'	float sum = 0.0;',
		'	float amp = 0.5;',
		'	float norm = 0.0;',
		'	for (int i = 0; i < ' + octaves + '; i++) {',
		'		sum += amp * fogValueNoise(p);',
		'		norm += amp;',
		'		p *= 2.02;',
		'		amp *= 0.5;',
		'	}',
		'	return sum / norm;',
		'}',
	];

	if (useWarp) {
		// One level of domain warp: offset the sample by an fBm-valued vector.
		// The decorrelated seed offsets keep the three warp channels independent.
		lines.push(
			'float fogDensity(vec3 p) {',
			'	vec3 q = vec3(',
			'		fogFbm(p + vec3(0.0, 0.0, 0.0)),',
			'		fogFbm(p + vec3(5.2, 1.3, 2.8)),',
			'		fogFbm(p + vec3(1.7, 9.2, 3.5))',
			'	);',
			`	return fogFbm(p + ${FOG_WARP_STRENGTH.toFixed(3)} * q);`,
			'}'
		);
	} else {
		lines.push(
			'float fogDensity(vec3 p) {',
			'	return fogFbm(p);',
			'}'
		);
	}

	return lines;
}

function fogVertexHeader(): string[] {
	return [...VOXEL_AO_VERTEX_HEADER];
}

function fogFragmentHeader(performanceMode: boolean): string[] {
	const octaves = performanceMode ? FOG_OCTAVES_PERF : FOG_OCTAVES_FULL;
	const useWarp = !performanceMode;
	return [
		...getVoxelAoFragmentHeader(performanceMode),
		'uniform float uFogTime;',
		`const vec3 FOG_THIN  = vec3(${FOG_COLOR_THIN[0].toFixed(3)}, ${FOG_COLOR_THIN[1].toFixed(3)}, ${FOG_COLOR_THIN[2].toFixed(3)});`,
		`const vec3 FOG_DENSE = vec3(${FOG_COLOR_DENSE[0].toFixed(3)}, ${FOG_COLOR_DENSE[1].toFixed(3)}, ${FOG_COLOR_DENSE[2].toFixed(3)});`,
		...fogNoiseGlsl(octaves, useWarp),
	];
}

// Replaces #include <color_fragment>. We sample the warped fBm at this
// fragment's world position (reusing the AO world-position varying), drift it
// over time, shape it into alpha, and tint + AO-shade the color.
function fogColorFragment(): string[] {
	const drift = `vec3(${FOG_DRIFT[0].toFixed(4)}, ${FOG_DRIFT[1].toFixed(4)}, ${FOG_DRIFT[2].toFixed(4)})`;
	return [
		`vec3 fogSamplePos = vVoxelAoWorldPosition * ${FOG_NOISE_SCALE.toFixed(4)} + uFogTime * ${drift};`,
		// A second, slower churn on one axis so the field evolves in place rather
		// than only sliding past -- reads as roiling smoke/cloud.
		'fogSamplePos += vec3(0.0, sin(uFogTime * 0.11) * 0.15, 0.0);',
		'float fogD = fogDensity(fogSamplePos);',
		`float fogShaped = smoothstep(${FOG_DENSITY_LOW.toFixed(3)}, ${FOG_DENSITY_HIGH.toFixed(3)}, fogD);`,
		'vec3 fogColor = mix(FOG_THIN, FOG_DENSE, fogShaped);',
		`fogColor *= ${VOXEL_AO_CALL};`,
		`float fogAlpha = mix(${FOG_MIN_ALPHA.toFixed(3)}, ${FOG_MAX_ALPHA.toFixed(3)}, fogShaped);`,
		'diffuseColor = vec4(fogColor, fogAlpha);',
	];
}

// ---------------------------------------------------------------------------
// Shader installation (AO + animated noise -- no movement-highlight variant)
// ---------------------------------------------------------------------------

function installFogShader(
	material: THREE.MeshStandardMaterial,
	timeUniform: { value: number },
	voxelAo: VoxelAoTexture,
	performanceMode: boolean
): void {
	material.onBeforeCompile = (shader) => {
		applyVoxelAoUniforms(shader, voxelAo);
		shader.uniforms.uFogTime = timeUniform;

		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			['#include <common>', ...fogVertexHeader()].join('\n')
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			['#include <begin_vertex>', ...VOXEL_AO_VERTEX_BEGIN].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			['#include <common>', ...fogFragmentHeader(performanceMode)].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			fogColorFragment().join('\n')
		);
	};
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createFog251Material: MaterialFactory = (
	params: MaterialFactoryParams
): MaterialFactoryResult => {
	const { voxelAo, performanceMode = false } = params;

	// Per-instance time uniform. onAnimationFrame writes into this object; THREE
	// holds the same { value } reference in its uniforms table, so no further
	// bookkeeping is needed.
	const timeUniform = { value: 0 };

	const material = new THREE.MeshStandardMaterial({
		color: FOG_SWATCH,
		roughness: FOG_ROUGHNESS,
		metalness: FOG_METALNESS,
		vertexColors: false,
		transparent: true,
		// depthWrite off: fog is genuinely translucent and must not occlude
		// geometry (or other fog layers) behind it in the depth buffer.
		depthWrite: false,
	});

	installFogShader(material, timeUniform, voxelAo, performanceMode);

	const onAnimationFrame = (timeMs: number) => {
		timeUniform.value = timeMs * 0.001;
	};

	return {
		material,
		onAnimationFrame,
		castShadow: false,    // a translucent volume should not cast hard shadows
		receiveShadow: true,  // but it is lit by the scene, so it tints with it
		renderOrder: 3,       // after opaque (0), water/lava (1), glass (2)
	};
};

// ---------------------------------------------------------------------------
// Material definition (collected by materials/index.ts)
// ---------------------------------------------------------------------------

const fog251Material: TerrainMaterial = {
	bucketKey: 'fog_251',
	// Own occlusion group: fog-to-fog shared faces are culled (a solid fog block
	// is a hollow shell), but fog emits faces against solid terrain so geometry
	// behind it still renders and shows through the translucent noise.
	occlusionGroup: 'fog_251',
	// Bump on shader-source change to invalidate the program cache.
	shaderVersion: 3,
	geometry: {
		vertexColors: false,
		// Greedy-merge is fine (and cheaper): the noise is evaluated in world
		// space, so it stays seamless across merged faces, and we do not deform.
	},
	// Fog is non-colliding: actors and raycasts pass through, it is never a
	// walkable surface. This is what makes it usable as smoke/fog/clouds.
	passable: true,
	factory: createFog251Material,
	special: {
		paletteIndex: 251,
		label: 'Fog',
		swatchColor: FOG_SWATCH,
	},
};

export default fog251Material;
