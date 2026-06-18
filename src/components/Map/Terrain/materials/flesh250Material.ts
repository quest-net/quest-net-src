// Flesh material (palette index 250).
//
// Animated organic flesh surface adapted from a Shadertoy by @TheMirzaBeig
// (https://twitter.com/TheMirzaBeig/status/1644437603263868933).
//
// The original uses an aperiodic FBM (fractal Brownian motion) driven by
// iTime to produce pulsing, glistening flesh. We adapt it to Three.js's
// MeshStandardMaterial via onBeforeCompile, replacing Shadertoy globals:
//
//   iTime       -> uFleshTime uniform (seconds, driven by onAnimationFrame)
//   iChannel0   -> uFleshNoise sampler2D (64x64 greyscale smooth noise)
//   fragCoord/iResolution UV -> world-projected UV (per-tile fract, so the
//                               pattern tiles across voxel faces seamlessly)
//   iMouse      -> removed (no interactivity needed in a terrain material)
//
// Shader split across two hooks:
//   color_fragment:     FBM noise + fluid detail -> sets diffuseColor (base
//                       flesh red), AO applied here. fleshNoise local variable
//                       stays in scope for the next hook.
//   dithering_fragment: screen-space normals from dFdx/dFdy(fleshNoise),
//                       diffuse highlight + specular + Fresnel + ambient
//                       added ADDITIVELY on top of Three.js PBR output, then
//                       movement-highlight overlay applied.
//
// This lets Three.js handle scene shadows/AO/lighting while the Shadertoy's
// own per-fragment lighting contributes the glistening, subsurface-scatter-like
// highlights that make the flesh look alive.

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

const FLESH_NOISE_URL = '/materials/flesh_250/flesh_noise_64x64.png';
const FLESH_SWATCH = '#cc2244';

// World units per UV unit for the FBM. Controls how "zoomed in" the pattern
// is on each voxel face. 0.45 gives roughly one full pattern per voxel.
const FLESH_UV_SCALE = 0.45;

// PBR: flesh is matte (low metalness), moderately rough.
const FLESH_ROUGHNESS = 0.70;
const FLESH_METALNESS = 0.0;

// ---------------------------------------------------------------------------
// Animation speed knobs
//
// All four values scale uFleshTime before it reaches the shader math.
// Set any of them to 0 to freeze that layer entirely.
//
// FLESH_SPEED            -- how fast the main FBM pattern travels across the
//                           surface. The original Shadertoy used 2.0; 0.4
//                           gives a slow, unsettling pulse.
// FLESH_LURCH_SPEED      -- rate of the low-frequency "lurching" oscillation
//                           that makes the movement feel biological rather
//                           than mechanical. Original: 1.5. Lower values make
//                           the motion smoother/less jerky.
// FLESH_FLUID_ANGLE_SPEED -- how quickly the fluid-noise lookup angle rotates.
//                           Controls the swirling character of the dark veins.
//                           Original: 0.78.
// FLESH_FLUID_SCROLL_SPEED -- raw V-scroll speed of the fluid noise texture
//                           sample. Original: 5.5 (quite fast). Reduce to
//                           make the vein texture linger longer in one place.
// ---------------------------------------------------------------------------
const FLESH_SPEED              = 0.4;
const FLESH_LURCH_SPEED        = 0.5;
const FLESH_FLUID_ANGLE_SPEED  = 0.25;
const FLESH_FLUID_SCROLL_SPEED = 1.2;

// ---------------------------------------------------------------------------
// Texture cache
// ---------------------------------------------------------------------------

let cachedNoiseTexture: THREE.Texture | null = null;

function getFleshNoiseTexture(): THREE.Texture {
	if (!cachedNoiseTexture) {
		const tex = new THREE.TextureLoader().load(FLESH_NOISE_URL);
		tex.colorSpace = THREE.LinearSRGBColorSpace;
		tex.wrapS = THREE.RepeatWrapping;
		tex.wrapT = THREE.RepeatWrapping;
		tex.magFilter = THREE.LinearFilter;
		tex.minFilter = THREE.LinearFilter;
		tex.generateMipmaps = false;
		cachedNoiseTexture = tex;
	}
	return cachedNoiseTexture;
}

// ---------------------------------------------------------------------------
// GLSL -- FBM and lighting functions (adapted from @TheMirzaBeig's Shadertoy)
// ---------------------------------------------------------------------------
//
// Changes vs original:
//   - iTime         -> uFleshTime
//   - #define constants inlined as GLSL constants for shader cache stability
//   - UV input to FBM is per-tile fract (see color_fragment), not screen UV
//   - centeredDot uses fract-centered u so it stays in [0,0.5] per tile
//   - CalculateSpecularLight currentPosition uses per-tile uv, not screen pos

const FLESH_GLSL_FUNCTIONS = [
	// Rotation matrix
	'mat2 fleshRM2D(float a) {',
	'    return mat2(cos(a), sin(a), -sin(a), cos(a));',
	'}',
	// Aperiodic sin -- creates non-repeating, organic-looking oscillations
	'float fleshAperiodicSin(float x) {',
	'    float eOver2 = 1.3591409;',
	'    float pi = 3.141592;',
	'    return sin(eOver2 * x + 1.04) * sin(pi * x);',
	'}',
	// FBM adapted to continuous world-projected UV.
	// uv: raw world UV (no fract) so the pattern is seamless across voxel faces.
	// centeredDot is fixed at 0.25 (mid-range of the original [0,0.5] window)
	// so the starting frequency is a stable 13.0 regardless of world position.
	// Letting centeredDot = dot(u,u) with world UVs would let it grow to 100+
	// and blow the frequency into thousands, producing uniform grey.
	'float fleshFBM(vec2 uv, float t, bool highQuality) {',
	'    vec2 n, q, u = uv;',
	'    float centeredDot = 0.25;',  // fixed neutral value: frequency starts at 13.0
	'    float frequency = 15.0 - (0.5 - centeredDot) * 8.0;',
	'    float result = 0.0;',
	'    mat2 matrix = fleshRM2D(5.0);',      // ROTATION = 5.
	'    float iters = highQuality ? 16.0 : 8.0;',
	'    for (float i = 0.0; i < 16.0; i++) {',
	'        if (i >= iters) break;',
	'        u = matrix * u;',
	'        n = matrix * n;',
	`        q = u * frequency + t * ${FLESH_SPEED.toFixed(4)}`,
	`          + fleshAperiodicSin(t * ${FLESH_LURCH_SPEED.toFixed(4)} - centeredDot * 1.2) * 0.4 * ${FLESH_LURCH_SPEED.toFixed(4)}`,
	'          + i + n;',
	'        result += dot(cos(q) / frequency, vec2(2.0, 2.0));',
	'        n -= sin(q);',
	'        frequency *= 1.18;',             // FREQUENCY_MULTIPLIER = 1.18
	'    }',
	'    return result;',
	'}',
	// Diffuse lighting in UV-space (fake 2D bumpmap shading from noise derivatives)
	'float fleshDiffuse(vec3 n, vec3 lightDir) {',
	'    return pow(max(dot(n, lightDir), 0.0), 20.0) * 0.3;',
	'}',
	// Specular lighting in UV-space
	'float fleshSpecular(vec3 n, vec3 lightDir, vec3 pos) {',
	'    vec3 src = vec3(0.9, 0.1, 1.0);',
	'    vec3 refl = reflect(-lightDir, n);',
	'    vec3 viewDir = normalize(src - pos);',
	'    return pow(max(dot(viewDir, refl), 0.0), 50.0);', // SPECULAR_SHININESS = 50
	'}',
].join('\n');

// ---------------------------------------------------------------------------
// Shader helpers -- vertex
// ---------------------------------------------------------------------------

function fleshVertexHeader(): string[] {
	return [
		...VOXEL_AO_VERTEX_HEADER,
		'uniform float uFleshTime;',
	];
}

function fleshBeginVertex(): string[] {
	return [
		...VOXEL_AO_VERTEX_BEGIN,
	];
}

// ---------------------------------------------------------------------------
// Shader helpers -- fragment header
// ---------------------------------------------------------------------------

function fleshFragmentHeader(performanceMode: boolean): string[] {
	return [
		...getVoxelAoFragmentHeader(performanceMode),
		'uniform float uFleshTime;',
		'uniform sampler2D uFleshNoise;',
		'vec2 getFleshUv(vec3 worldPos, vec3 worldNormal) {',
		'    vec3 n = abs(normalize(worldNormal));',
		'    if (n.y >= n.x && n.y >= n.z) return worldPos.xz;',
		'    if (n.x >= n.z) return worldPos.zy;',
		'    return worldPos.xy;',
		'}',
		FLESH_GLSL_FUNCTIONS,
	];
}

// ---------------------------------------------------------------------------
// color_fragment replacement
//
// Computes the FBM noise and fluid texture contribution, sets diffuseColor to
// the base fleshy red, applies AO.
//
// Declares fleshNoise and fleshUvTile as local variables so dithering_fragment
// (same main() scope) can read them for the specular/Fresnel pass.
// ---------------------------------------------------------------------------

function fleshColorFragment(performanceMode: boolean): string[] {
	const uvScale = FLESH_UV_SCALE.toFixed(4);
	return [
		'#include <color_fragment>',

		// World-projected UV scaled to a reasonable FBM input range.
		// No fract() here -- passing continuous world UV keeps the FBM seamless
		// across voxel face boundaries. fract() was the source of hard seams.
		`vec2 fleshUvWorld = getFleshUv(vVoxelAoWorldPosition, vVoxelAoWorldNormal) * ${uvScale};`,

		// FBM: originalNoise may be outside [0,1]
		`float fleshOriginalNoise = fleshFBM(fleshUvWorld, uFleshTime, ${performanceMode ? 'false' : 'true'});`,
		'float fleshNoise = clamp(fleshOriginalNoise, 0.0, 1.0);',

		// Fluid detail: samples the low-frequency noise texture with a time-driven
		// offset. Adds subtle writhing texture to the dark areas (smoothstep gate).
		// Mirrors the original USE_FLUID block. fluidViscosity = 681.72.
		`float fleshFluidNoiseAngle = fleshOriginalNoise * 13.05 + uFleshTime * ${FLESH_FLUID_ANGLE_SPEED.toFixed(4)};`,
		'vec2 fleshFluidOffset = vec2(',
		'    cos(fleshFluidNoiseAngle) + fleshOriginalNoise * 14.0,',
		`    sin(fleshFluidNoiseAngle) + uFleshTime * ${FLESH_FLUID_SCROLL_SPEED.toFixed(4)}`,
		') / 681.72;',
		'float fleshFluidSample = texture2D(uFleshNoise, fleshUvWorld * 0.12 + fleshFluidOffset).x;',
		'float fleshFluidNoise = pow(fleshFluidSample, 5.5 * 0.5) * 0.27;', // FLUID_STRENGTH = 0.5
		'fleshNoise += fleshFluidNoise * smoothstep(0.4, 0.0, fleshNoise);',

		// Diffuse brightness contribution to the noise value (USE_DIFFUSE = true).
		// Computed here so the base color bakes it in (same as original).
		'vec3 fleshLightSrc = vec3(0.76, 0.7, 0.0);',
		'vec3 fleshPos3 = vec3(fract(fleshUvWorld) - 0.5, 1.0);',
		'vec3 fleshLightDir = normalize(fleshPos3 - fleshLightSrc);',
		'vec3 fleshNormalVec = normalize(vec3(dFdx(fleshNoise), dFdy(fleshNoise), clamp(fleshOriginalNoise * 0.01, 0.0, 1.0)));',
		'float fleshBrightness = fleshDiffuse(fleshNormalVec, fleshLightDir);',
		'fleshNoise += fleshBrightness;',

		// Base color: DIFFUSE_COLOR = vec3(1., 0.0, 0.2)
		'vec3 fleshBaseColor = vec3(fleshNoise * 1.0, 0.0, fleshNoise * 0.2);',

		// Apply AO on the base color, then write diffuseColor.
		`fleshBaseColor *= ${VOXEL_AO_CALL};`,
		'diffuseColor = vec4(clamp(fleshBaseColor, 0.0, 1.0), 1.0);',
	];
}

// ---------------------------------------------------------------------------
// dithering_fragment replacement
//
// Reads the fleshNoise / fleshNormalVec / fleshBrightness / fleshPos3 /
// fleshLightDir locals from color_fragment (same main() scope) and adds the
// shader's remaining lighting terms additively on top of Three.js's PBR output.
// ---------------------------------------------------------------------------

const FLESH_DITHERING_EXTRA = [
	// DIFFUSE_HIGHLIGHT_COLOR = vec3(1., 0.35, 0.2)
	'gl_FragColor.rgb += vec3(1.0, 0.35, 0.2) * fleshBrightness;',

	// Specular highlight -- USE_SPECULAR_HIGHLIGHTS = true
	// Schlick Fresnel for specular (SPECULAR_FRESNEL_BIAS = 4.)
	'float fleshSpecVal = fleshSpecular(fleshNormalVec, fleshLightDir, fleshPos3);',
	'float fleshSpecBase = 1.0 - clamp(dot(normalize(vec3(0.9, 0.1, 1.0) - fleshPos3), reflect(-fleshLightDir, fleshNormalVec)), 0.0, 1.0);',
	'float fleshSpecExp = pow(fleshSpecBase, 0.2);',
	'float fleshSpecR = fleshSpecExp + 4.0 * (1.0 - fleshSpecExp);',
	// SPECULAR_COLOR = vec3(1., 0.8, 0.8) * 0.4
	'gl_FragColor.rgb += vec3(1.0, 0.8, 0.8) * 0.4 * fleshSpecVal * fleshSpecR;',

	// Fresnel rim -- USE_FRESNEL = true
	// FRESNEL_COLOR = vec3(1., 0.05, 0.2), DIFFUSE_FRESNEL_BIAS = 1.
	'vec3 fleshFresnelNrm = normalize(fleshNormalVec);',
	'float fleshFresnelBase = 1.0 - dot(normalize(vec3(0.9, 0.1, 1.0) - fleshPos3), fleshFresnelNrm);',
	'float fleshFresnelExp = pow(fleshFresnelBase, 0.2);',
	'float fleshFresnelR = (fleshFresnelExp + 1.0 * (1.0 - fleshFresnelExp)) * 0.05;',
	'gl_FragColor.rgb += vec3(1.0, 0.05, 0.2) * clamp(fleshFresnelR, 0.04, 1.0);',

	// Ambient -- USE_AMBIENT = true, AMBIENT_COLOR = vec3(1., 0.05, 0.2) * 0.02
	'gl_FragColor.rgb += vec3(1.0, 0.05, 0.2) * 0.02;',
].join('\n');

// Flesh's own additive lighting (specular / Fresnel / ambient) runs first, then
// the shared movement-highlight overlay -- which also emits the real
// #include <dithering_fragment>. The overlay is gated by uHighlightEnabled, so
// the first-person view and surroundings share this one program with it off.
function fleshDitheringFragment(): string {
	return FLESH_DITHERING_EXTRA + '\n' + MOVEMENT_HIGHLIGHT_DITHERING.join('\n');
}

// ---------------------------------------------------------------------------
// Shader installation
// ---------------------------------------------------------------------------

function installFlesh250Shader(
	material: THREE.MeshStandardMaterial,
	texture: THREE.Texture,
	timeUniform: { value: number },
	voxelAo: VoxelAoTexture,
	movementHighlight: MovementHighlightTexture | undefined,
	performanceMode: boolean
): void {
	material.onBeforeCompile = (shader) => {
		applyVoxelAoUniforms(shader, voxelAo);
		shader.uniforms.uFleshTime = timeUniform;
		shader.uniforms.uFleshNoise = { value: texture };
		applyMovementHighlightUniforms(shader, movementHighlight);

		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			['#include <common>', ...fleshVertexHeader(), ...MOVEMENT_HIGHLIGHT_VERTEX_HEADER].join('\n')
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			['#include <begin_vertex>', ...fleshBeginVertex(), ...MOVEMENT_HIGHLIGHT_VERTEX_BEGIN].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			['#include <common>', ...fleshFragmentHeader(performanceMode), ...MOVEMENT_HIGHLIGHT_FRAGMENT_HEADER].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			fleshColorFragment(performanceMode).join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <dithering_fragment>',
			fleshDitheringFragment()
		);
	};
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createFlesh250Material: MaterialFactory = (
	params: MaterialFactoryParams
): MaterialFactoryResult => {
	const { movementHighlight, voxelAo, performanceMode = false } = params;

	const noiseTexture = getFleshNoiseTexture();
	const timeUniform = { value: 0 };

	const material = new THREE.MeshStandardMaterial({
		roughness: FLESH_ROUGHNESS,
		metalness: FLESH_METALNESS,
		vertexColors: false,
		transparent: false,
		depthWrite: true,
	});

	installFlesh250Shader(material, noiseTexture, timeUniform, voxelAo, movementHighlight, performanceMode);

	const onAnimationFrame = (timeMs: number) => {
		timeUniform.value = timeMs * 0.001;
	};

	return {
		material,
		onAnimationFrame,
		castShadow: true,
		receiveShadow: true,
		renderOrder: 0,
	};
};

// ---------------------------------------------------------------------------
// Material definition (collected by materials/index.ts)
// ---------------------------------------------------------------------------

const flesh250Material: TerrainMaterial = {
	bucketKey: 'flesh_250',
	// Flesh-to-flesh shared faces are culled so a solid flesh block is hollow
	// inside. Flesh against solid terrain emits faces normally.
	occlusionGroup: 'flesh_250',
	shaderVersion: 4,
	geometry: {
		vertexColors: false,
	},
	factory: createFlesh250Material,
	special: {
		paletteIndex: 250,
		label: 'Flesh',
		swatchColor: FLESH_SWATCH,
	},
};

export default flesh250Material;
