// Hero-occlusion cutout shader helpers, shared by every terrain material.
//
// On enclosed / indoor terrains it's hard to see the focused actor when walls,
// roofs, or cliffs sit between the camera and the token. This effect dither-
// discards terrain fragments that lie (a) BETWEEN the camera and the focused
// actor and (b) inside a cone around the camera->actor sightline, opening a soft
// "keyhole" onto the actor. It touches only rendering -- no camera, DoF, fog, or
// raycast is affected, so tile-picking / actor-picking are unchanged.
//
// It mirrors the movement-highlight overlay (movementHighlightShader.ts): a
// fragment-stage effect that is ALWAYS compiled in and gated at runtime by a
// single uniform (`uHeroEnabled`), so one program per material serves the world
// view, first-person (disabled), and the surroundings skirt. When disabled the
// branch is skipped coherently, so the cost is a single comparison.
//
// Unlike the movement highlight (which reuses the AO world-position varyings),
// this module is SELF-CONTAINED: it declares and computes its own
// `vHeroWorldPos` varying. That lets it apply uniformly to materials that carry
// the AO patch AND to glass / light, which deliberately have no AO shader.

import * as THREE from 'three';
import { THREE_D_HERO_OCCLUSION } from '../../threeDMapConstants';
import type { HeroOcclusionUniforms } from '../materials/materialTypes';

// Re-exported so material files splice in the chunks AND type the install-function
// param from a single import, without also reaching into materialTypes.
export type { HeroOcclusionUniforms } from '../materials/materialTypes';

// ---------------------------------------------------------------------------
// Uniform holder
// ---------------------------------------------------------------------------

/**
 * Build a fresh hero-occlusion uniform holder, disabled by default. One holder
 * is created per terrain build and shared (by reference) across every bucket
 * material, so the per-frame driver mutates a single object to update them all.
 */
export function createHeroOcclusionUniforms(): HeroOcclusionUniforms {
	return {
		enabled: { value: 0 },
		actorPos: { value: new THREE.Vector3() },
		camPos: { value: new THREE.Vector3() },
		radius: { value: THREE_D_HERO_OCCLUSION.RADIUS },
		coneScale: { value: THREE_D_HERO_OCCLUSION.CONE_SCALE },
		feather: { value: THREE_D_HERO_OCCLUSION.FEATHER },
		cutY: { value: 0 },
		cutSign: { value: 1 },
	};
}

// ---------------------------------------------------------------------------
// TypeScript mirror of the cutout test
//
// `isHeroOccludedPoint` is the CPU twin of the GLSL `heroOccluded` below: it
// answers "is this world point inside the cutout keyhole?" so gameplay pointer
// picking can raycast THROUGH the same voxels the shader visually discards (see
// makeHeroOcclusionVoxelSkip in movement3DHelpers). The two are two views of one
// algorithm -- if the cone / height-plane math changes in one, change it in the
// other.
//
// Deliberate difference from the shader: picking uses the SOLID cone
// (`radial <= coneR`) and drops the feather band + interleaved-gradient dither.
// Picking must be deterministic, not per-pixel noisy; the thin feathered ring
// reads as see-through but is not click-through, which is acceptable.
// ---------------------------------------------------------------------------

/** Scalar snapshot of the hero-occlusion uniforms for the CPU-side test. */
export interface HeroOcclusionTestParams {
	camX: number;
	camY: number;
	camZ: number;
	actorX: number;
	actorY: number;
	actorZ: number;
	radius: number;
	coneScale: number;
	cutY: number;
	cutSign: number;
}

export function isHeroOccludedPoint(
	px: number,
	py: number,
	pz: number,
	p: HeroOcclusionTestParams
): boolean {
	// Height plane: only cut on the camera's side of the actor's feet/head.
	if ((py - p.cutY) * p.cutSign < 0) return false;

	const tx = p.actorX - p.camX;
	const ty = p.actorY - p.camY;
	const tz = p.actorZ - p.camZ;
	const distAct = Math.hypot(tx, ty, tz);
	if (distAct < 0.0001) return false;

	const ax = tx / distAct;
	const ay = ty / distAct;
	const az = tz / distAct;

	const rx = px - p.camX;
	const ry = py - p.camY;
	const rz = pz - p.camZ;
	const t = rx * ax + ry * ay + rz * az; // depth along the sightline
	if (t <= 0 || t >= distAct - THREE_D_HERO_OCCLUSION.ACTOR_MARGIN) return false;

	const perpX = rx - ax * t;
	const perpY = ry - ay * t;
	const perpZ = rz - az * t;
	const radial = Math.hypot(perpX, perpY, perpZ);
	// mix(1, coneScale, 1 - t/distAct): flares toward the camera.
	const coneR = p.radius * (1 + (p.coneScale - 1) * (1 - t / distAct));
	return radial <= coneR;
}

// Shared disabled placeholder for pre-warm / any material compiled without a
// real holder. Never mutated (enabled stays 0), lives for the renderer lifetime.
let placeholder: HeroOcclusionUniforms | null = null;

function getPlaceholderHeroOcclusion(): HeroOcclusionUniforms {
	if (!placeholder) placeholder = createHeroOcclusionUniforms();
	return placeholder;
}

// ---------------------------------------------------------------------------
// Shader chunks
//
// Each material appends these to its own #include replacements (String.replace
// only replaces the first occurrence, so the includes appear once). The discard
// targets a distinct early include so occluded fragments bail before lighting.
// ---------------------------------------------------------------------------

/** Append after `#include <common>` in the vertex shader. */
export const HERO_OCCLUSION_VERTEX_HEADER: readonly string[] = [
	'varying vec3 vHeroWorldPos;',
];

/**
 * Append after `#include <begin_vertex>` in the vertex shader. Computed from
 * `transformed` so any earlier vertex displacement (e.g. water ripples) flows in.
 */
export const HERO_OCCLUSION_VERTEX_BEGIN: readonly string[] = [
	'vHeroWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
];

/**
 * Append after `#include <common>` in the fragment shader. Declares the uniforms
 * and the cutout test. `heroDither` is interleaved-gradient noise -- a static
 * (no time term) per-pixel threshold, so the feathered edge dissolves cleanly
 * without temporal shimmer.
 */
export const HERO_OCCLUSION_FRAGMENT_HEADER: readonly string[] = [
	'uniform float uHeroEnabled;',
	'uniform vec3 uHeroActorPos;',
	'uniform vec3 uHeroCamPos;',
	'uniform float uHeroRadius;',
	'uniform float uHeroConeScale;',
	'uniform float uHeroFeather;',
	'uniform float uHeroCutY;',
	'uniform float uHeroCutSign;',
	'varying vec3 vHeroWorldPos;',
	'float heroDither(vec2 fc) {',
	'	return fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));',
	'}',
	'bool heroOccluded(vec3 P) {',
	// Only cut geometry on the camera's side of the actor's height plane, so the
	// floor beneath the actor (camera above) / ceiling above it (camera below) stays.
	'	if ((P.y - uHeroCutY) * uHeroCutSign < 0.0) return false;',
	'	vec3 toActor = uHeroActorPos - uHeroCamPos;',
	'	float distAct = length(toActor);',
	'	if (distAct < 0.0001) return false;',
	'	vec3 axis = toActor / distAct;',
	'	float t = dot(P - uHeroCamPos, axis);',           // fragment depth along sightline
	`	if (t <= 0.0 || t >= distAct - ${THREE_D_HERO_OCCLUSION.ACTOR_MARGIN.toFixed(3)}) return false;`,
	'	float radial = length((P - uHeroCamPos) - axis * t);',
	'	float coneR = uHeroRadius * mix(1.0, uHeroConeScale, 1.0 - t / distAct);',
	'	if (radial > coneR + uHeroFeather) return false;',
	'	float edge = smoothstep(coneR + uHeroFeather, coneR, radial);',  // 0 at outer feather -> 1 inside
	'	return edge > heroDither(gl_FragCoord.xy);',
	'}',
];

/**
 * Replaces `#include <clipping_planes_fragment>` (early in main(), so the discard
 * runs before lighting). Guarded by `uHeroEnabled` for a single coherent branch.
 *
 * Perf note: a fragment shader that *contains* `discard` has early depth testing
 * disabled by the driver for the whole program (a compile-time property, not
 * gated by `uHeroEnabled`), so occluded terrain fragments can't be hi-Z rejected.
 * Measured cost on a real scene is negligible, so this is an accepted trade for a
 * single always-compiled program. If it ever matters, the escape hatch is to
 * compile a second discard-free program variant and swap to the discard variant
 * only while an actor is genuinely occluded -- deliberately not done here to
 * avoid the extra program + material-swap machinery.
 */
export const HERO_OCCLUSION_DISCARD: readonly string[] = [
	'#include <clipping_planes_fragment>',
	'if (uHeroEnabled > 0.5 && heroOccluded(vHeroWorldPos)) discard;',
];

/**
 * Bind the hero-occlusion uniforms onto an open shader object. The SAME `{ value }`
 * objects from the holder are assigned into `shader.uniforms` (not cloned), so a
 * single per-frame mutation of the holder updates every material that shares it.
 * Pass `undefined` (pre-warm / no terrain) to bind the disabled placeholder.
 */
export function applyHeroOcclusionUniforms(
	shader: THREE.WebGLProgramParametersWithUniforms,
	heroOcclusion: HeroOcclusionUniforms | undefined
): void {
	const h = heroOcclusion ?? getPlaceholderHeroOcclusion();
	shader.uniforms.uHeroEnabled = h.enabled;
	shader.uniforms.uHeroActorPos = h.actorPos;
	shader.uniforms.uHeroCamPos = h.camPos;
	shader.uniforms.uHeroRadius = h.radius;
	shader.uniforms.uHeroConeScale = h.coneScale;
	shader.uniforms.uHeroFeather = h.feather;
	shader.uniforms.uHeroCutY = h.cutY;
	shader.uniforms.uHeroCutSign = h.cutSign;
}

/** Install hero occlusion as a material's only onBeforeCompile shader patch. */
export function installHeroOcclusionShader(
	material: THREE.Material,
	heroOcclusion: HeroOcclusionUniforms | undefined
): void {
	material.onBeforeCompile = (shader) => {
		applyHeroOcclusionUniforms(shader, heroOcclusion);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			['#include <common>', ...HERO_OCCLUSION_VERTEX_HEADER].join('\n')
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			['#include <begin_vertex>', ...HERO_OCCLUSION_VERTEX_BEGIN].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			['#include <common>', ...HERO_OCCLUSION_FRAGMENT_HEADER].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <clipping_planes_fragment>',
			HERO_OCCLUSION_DISCARD.join('\n')
		);
	};
}
