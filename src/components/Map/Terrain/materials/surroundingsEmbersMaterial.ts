// "Smoldering ground" material -- SURROUNDINGS-ONLY, not a terrain bucket.
//
// Fire voxels (palette 253) have an invisible surface material (the Fire3D
// layer draws their flames), so the surroundings plane cannot reuse it. Picking
// the Fire swatch as the surroundings material renders this instead: charred
// ground with glowing ember cracks -- land that is burning or just burned,
// distinct from a lava sea.
//
// Technique notes:
//   - CHAR: two octaves of value noise mix soot black with grey ash patches;
//     the surface is lit normally (matte), so the sun and fire lights shade it.
//   - CRACKS: Voronoi cell borders (F2 - F1 near 0), slightly domain-warped,
//     trace an angular network like dried, split earth. Two scales are
//     combined so there are wide fissures and fine plate cracks. Performance
//     mode uses one ridged-noise layer instead.
//   - HEAT: a slow, drifting low-frequency field decides where the ground is
//     still hot. Cracks glow only there, so the burn reads as patchy, and the
//     drift makes hot zones creep across the plain over time.
//   - FLICKER + EMBERS: the glow breathes with time, and sparse hashed cells
//     twinkle as individual coals. The glow is written as emissive radiance
//     (HDR), so the bloom pass picks it up.
//
// Not registered as a terrain material: it is reached through
// fire253Material.surroundingsFactory. Because it bypasses the registry's
// cache-key wrapper, it stamps its own customProgramCacheKey (same reason as
// surroundingsCloudsMaterial).

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
const EMBERS_SHADER_VERSION = 1;

// ---------------------------------------------------------------------------
// Tuning knobs
// ---------------------------------------------------------------------------

/** World units per char-variation noise unit. */
const EMBERS_CHAR_CELL_SIZE = 5.0;
/** World units per crack cell (fine plates and wide fissures). */
const EMBERS_CRACK_CELL_SIZE = 1.6;
const EMBERS_WIDE_CRACK_CELL_SIZE = 5.5;
/** Crack width in cell units (Voronoi F2 - F1). */
const EMBERS_CRACK_WIDTH = 0.07;
/** World units per heat-field noise unit, and its drift (units per second). */
const EMBERS_HEAT_CELL_SIZE = 14.0;
const EMBERS_HEAT_DRIFT: readonly [number, number] = [0.010, -0.006];
/** Heat field threshold: below LOW the ground is cold char. */
const EMBERS_HEAT_LOW = 0.52;
const EMBERS_HEAT_HIGH = 0.78;

const EMBERS_SOOT_COLOR: readonly [number, number, number] = [0.035, 0.030, 0.028];
const EMBERS_ASH_COLOR:  readonly [number, number, number] = [0.13, 0.12, 0.115];
/** HDR glow colors: cooler crack edge, hotter crack core. */
const EMBERS_GLOW_EDGE:  readonly [number, number, number] = [0.9, 0.14, 0.01];
const EMBERS_GLOW_CORE:  readonly [number, number, number] = [2.2, 0.85, 0.16];

/** Fraction of coal cells that twinkle, and their cell size (world units). */
const EMBERS_COAL_DENSITY = 0.02;
const EMBERS_COAL_CELL_SIZE = 0.45;

const EMBERS_ROUGHNESS = 1.0;
const EMBERS_METALNESS = 0.0;

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

const EMBERS_NOISE_GLSL: string = [
	'float embersHash(vec2 p) {',
	'	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);',
	'}',
	'float embersNoise(vec2 p) {',
	'	vec2 i = floor(p);',
	'	vec2 f = fract(p);',
	'	vec2 u = f * f * (3.0 - 2.0 * f);',
	'	return mix(',
	'		mix(embersHash(i), embersHash(i + vec2(1.0, 0.0)), u.x),',
	'		mix(embersHash(i + vec2(0.0, 1.0)), embersHash(i + vec2(1.0, 1.0)), u.x),',
	'		u.y);',
	'}',
	// Crack network: Voronoi F2 - F1 is ~0 on the borders between cells, so
	// 1 - smoothstep over a small width traces straight-ish, angular cracks
	// (dried-mud plates) rather than the rounded contours of plain noise.
	'float embersCrack(vec2 p) {',
	'	p += vec2(embersNoise(p * 0.7), embersNoise(p * 0.7 + 5.3)) * 0.35;',
	'	vec2 i = floor(p);',
	'	vec2 f = fract(p);',
	'	float d1 = 8.0;',
	'	float d2 = 8.0;',
	'	for (int y = -1; y <= 1; y++) {',
	'		for (int x = -1; x <= 1; x++) {',
	'			vec2 g = vec2(float(x), float(y));',
	'			vec2 o = vec2(embersHash(i + g), embersHash(i + g + 19.19));',
	'			float d = length(g + o - f);',
	'			d2 = d < d1 ? d1 : min(d2, d);',
	'			d1 = min(d1, d);',
	'		}',
	'	}',
	`	return 1.0 - smoothstep(0.0, ${EMBERS_CRACK_WIDTH.toFixed(3)}, d2 - d1);`,
	'}',
	// Cheap stand-in for performance mode: ridged noise lines.
	'float embersRidge(vec2 p) {',
	'	float n = embersNoise(p);',
	'	return pow(1.0 - abs(2.0 * n - 1.0), 18.0);',
	'}',
].join('\n');

function vec3Literal(c: readonly [number, number, number]): string {
	return `vec3(${c[0].toFixed(3)}, ${c[1].toFixed(3)}, ${c[2].toFixed(3)})`;
}

function embersVertexHeader(): string[] {
	return [
		...VOXEL_AO_VERTEX_HEADER,
		'varying vec3 vEmbersWorldPosition;',
	];
}

function embersVertexBegin(): string[] {
	return [
		'vEmbersWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
		...VOXEL_AO_VERTEX_BEGIN,
	];
}

function embersFragmentHeader(performanceMode: boolean): string[] {
	return [
		...getVoxelAoFragmentHeader(performanceMode),
		'varying vec3 vEmbersWorldPosition;',
		'uniform float uEmbersTime;',
		`const vec3 E_SOOT = ${vec3Literal(EMBERS_SOOT_COLOR)};`,
		`const vec3 E_ASH = ${vec3Literal(EMBERS_ASH_COLOR)};`,
		`const vec3 E_GLOW_EDGE = ${vec3Literal(EMBERS_GLOW_EDGE)};`,
		`const vec3 E_GLOW_CORE = ${vec3Literal(EMBERS_GLOW_CORE)};`,
		// Written by the color block, consumed by the emissive block (which runs
		// later in the standard chunk order).
		'vec3 eEmberGlow = vec3(0.0);',
		EMBERS_NOISE_GLSL,
	];
}

function embersColorFragment(performanceMode: boolean): string[] {
	const lines = [
		'vec2 eXz = vEmbersWorldPosition.xz;',
		`float eChar = embersNoise(eXz / ${EMBERS_CHAR_CELL_SIZE.toFixed(3)}) * 0.7 + embersNoise(eXz / ${(EMBERS_CHAR_CELL_SIZE * 0.31).toFixed(3)}) * 0.3;`,
		'vec3 eColor = mix(E_SOOT, E_ASH, smoothstep(0.55, 0.9, eChar));',
		`vec2 eHeatUv = eXz / ${EMBERS_HEAT_CELL_SIZE.toFixed(3)} + uEmbersTime * vec2(${EMBERS_HEAT_DRIFT[0].toFixed(4)}, ${EMBERS_HEAT_DRIFT[1].toFixed(4)});`,
		`float eHeat = smoothstep(${EMBERS_HEAT_LOW.toFixed(3)}, ${EMBERS_HEAT_HIGH.toFixed(3)}, embersNoise(eHeatUv) * 0.7 + embersNoise(eHeatUv * 2.3 + 3.1) * 0.3);`,
	];
	lines.push(
		performanceMode
			? `float eCrack = embersRidge(eXz / ${EMBERS_CRACK_CELL_SIZE.toFixed(3)});`
			// Fine plates glow only where hot; wide fissures stay faintly lit a
			// little further out, so the hot zones have ragged edges.
			: `float eCrack = max(embersCrack(eXz / ${EMBERS_CRACK_CELL_SIZE.toFixed(3)}), embersCrack(eXz / ${EMBERS_WIDE_CRACK_CELL_SIZE.toFixed(3)} + 11.7) * 1.3);`,
	);
	lines.push(
		// Slow breathing plus a faster local shimmer so the cracks never sit still.
		'float eFlicker = 0.7 + 0.2 * sin(uEmbersTime * 1.3 + eChar * 9.0) + 0.1 * sin(uEmbersTime * 4.7 + eXz.x * 0.8);',
		// Vary brightness along the cracks (some sections hot, some gone dark) so
		// the network does not read as an even web; drifts slowly with time.
		'float eAlong = smoothstep(0.25, 0.75, embersNoise(eXz * 0.9 + vec2(uEmbersTime * 0.15, 0.0)));',
		'float eGlow = clamp(eCrack * eHeat * eFlicker * (0.2 + 0.8 * eAlong), 0.0, 1.5);',
		'eEmberGlow = mix(E_GLOW_EDGE, E_GLOW_CORE, smoothstep(0.5, 1.2, eGlow)) * eGlow;',
	);
	if (!performanceMode) {
		lines.push(
			// Twinkling coals: a few hashed cells in hot zones pulse on and off.
			`vec2 eCoalCell = floor(eXz / ${EMBERS_COAL_CELL_SIZE.toFixed(3)});`,
			'float eCoalSeed = embersHash(eCoalCell);',
			`float eCoal = step(1.0 - ${EMBERS_COAL_DENSITY.toFixed(3)}, eCoalSeed) * eHeat;`,
			'eCoal *= 0.5 + 0.5 * sin(uEmbersTime * (2.0 + eCoalSeed * 6.0) + eCoalSeed * 40.0);',
			`vec2 eCoalLocal = fract(eXz / ${EMBERS_COAL_CELL_SIZE.toFixed(3)}) - 0.5;`,
			'eCoal *= 1.0 - smoothstep(0.15, 0.4, length(eCoalLocal));',
			'eEmberGlow += E_GLOW_CORE * eCoal;',
		);
	}
	lines.push(
		// Hot ground is a touch lighter (ash glows faintly orange near cracks).
		'eColor += E_GLOW_EDGE * 0.04 * eHeat;',
		`eColor *= ${VOXEL_AO_CALL};`,
		'diffuseColor = vec4(eColor, 1.0);',
	);
	return lines;
}

const EMBERS_EMISSIVE_FRAGMENT: readonly string[] = [
	'totalEmissiveRadiance = eEmberGlow;',
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSurroundingsEmbersMaterial: MaterialFactory = (
	params: MaterialFactoryParams
): MaterialFactoryResult => {
	const { voxelAo, performanceMode = false } = params;

	const timeUniform = { value: 0 };

	const material = new THREE.MeshStandardMaterial({
		roughness: EMBERS_ROUGHNESS,
		metalness: EMBERS_METALNESS,
		vertexColors: false,
	});

	material.onBeforeCompile = (shader) => {
		applyVoxelAoUniforms(shader, voxelAo);
		shader.uniforms.uEmbersTime = timeUniform;

		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			['#include <common>', ...embersVertexHeader()].join('\n')
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			['#include <begin_vertex>', ...embersVertexBegin()].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			['#include <common>', ...embersFragmentHeader(performanceMode)].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			embersColorFragment(performanceMode).join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <emissivemap_fragment>',
			EMBERS_EMISSIVE_FRAGMENT.join('\n')
		);
	};

	// Stable program cache key (normally stamped by the registry wrapper, which
	// this factory bypasses). The surroundings mesh allocates a fresh material
	// on every rebuild; this is what makes those rebuilds compile-free.
	const key = [
		'surroundings-embers',
		`v${EMBERS_SHADER_VERSION}`,
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
		receiveShadow: true,
	};
};
