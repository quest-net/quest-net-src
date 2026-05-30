// Water material (palette index 241).
//
// Stylized animated water adapted from the "Voronoi Foam Water" Shadertoy by
// Trinity (https://www.shadertoy.com/view/4Xtcz2). Two Voronoi edge fields at
// different scales drive the look:
//
//   - Top / bottom faces use an omnidirectional world-XZ pattern: blue ripple
//     cells (small scale) with white foam crests (large scale) over the top.
//     The surface itself is displaced by a low-amplitude sin/cos wave.
//   - Side faces (waterfalls, fountains) use a (horizontal, worldY) mapping
//     with stretched cells, scrolled in worldY by uTime so the pattern
//     visibly falls. Foam is suppressed on sides -- only the blue tracery
//     shows, which reads cleanly as flowing water.
//
// Time is driven by an onAnimationFrame callback. The shader runs inside
// MeshStandardMaterial so the water picks up scene lighting, shadows, AO, and
// the movement-highlight overlay -- consistent with the stone bricks material.
// Render order is 1 (draws after opaque terrain, well before the highlight
// overlay at renderOrder 80). Material is transparent with a near-opaque body
// alpha; foam crests are slightly more translucent than the body.

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

const WATER_SWATCH = '#1a6699';

/** World units per Voronoi cell for the foam (large) pattern. */
const WATER_FOAM_CELL_SIZE = 2.0;
/** World units per Voronoi cell for the inner ripple (small) pattern. */
const WATER_RIPPLE_CELL_SIZE = 1.1;

const WATER_FOAM_COLOR: readonly [number, number, number] = [0.9, 0.9, 0.95];
const WATER_MAIN_BLUE:  readonly [number, number, number] = [0.10, 0.40, 0.60];
const WATER_DARK_BLUE:  readonly [number, number, number] = [0.00, 0.20, 0.40];

/** Base alpha applied to body (non-foam) pixels. */
const WATER_BODY_ALPHA = 0.86;
/** Alpha at foam crests (top faces only). Lower than body = foam reads translucent. */
const WATER_FOAM_ALPHA = 0.75;
/** Simple underside alpha. Bottom faces skip detailed foam/ripple work. */
const WATER_BOTTOM_ALPHA = 0.48;

/** Surface ripple amplitude in world units (top-face vertex displacement). */
const WATER_RIPPLE_AMPLITUDE = 0.115;
const WATER_PERFORMANCE_RIPPLE_AMPLITUDE = 0.045;
/** Surface ripple spatial frequency (radians per world unit). */
const WATER_RIPPLE_FREQUENCY = 2.4;
/** Surface ripple temporal frequency (radians per second). */
const WATER_RIPPLE_TIME_SCALE = 1.6;

// -- Side-face (waterfall / fountain) tuning ---------------------------------
//
// Side faces show only the blue ripple tracery (foam is suppressed). The UV
// domain is (horizontal, worldY) with the horizontal axis picked from the
// face's tangent: X-facing sides use world Z, Z-facing sides use world X.
// Cells are stretched -- narrow horizontally, tall vertically -- so cells
// read as streaks, and the V (worldY) axis is scrolled by uTime so streaks
// slide downward.

/** World units per ripple cell horizontally on side faces. */
const WATER_FALL_RIPPLE_WIDTH = 0.80;
/** World units per ripple cell vertically on side faces (taller = longer streaks). */
const WATER_FALL_RIPPLE_HEIGHT = 1.2;
/** Voronoi cells per second the streaks fall. */
const WATER_FALL_RIPPLE_SPEED = 1.4;

/** PBR knobs: water is smooth + dielectric. */
const WATER_ROUGHNESS = 0.20;
const WATER_METALNESS = 0.0;

// ---------------------------------------------------------------------------
// GLSL helpers (shared between the AO-only and movement-highlight variants)
// ---------------------------------------------------------------------------

// Branchless Voronoi (F2 - F1) -- the optimized variant suggested in the
// Shadertoy comments. Cells whose edges fall near the fragment produce a small
// value, so smoothstep(near 0) gives sharp edges; smoothstep(further out) gives
// a soft halo. We run it twice (foam scale and ripple scale) and composite.
const WATER_VORONOI_GLSL: string = [
	'float waterVoronoi(vec2 uv) {',
	'	vec2 i = floor(uv);',
	'	vec2 f = fract(uv);',
	'	float d1 = 1.0;',
	'	float d2 = 1.0;',
	'	for (int y = -1; y <= 1; y++) {',
	'		for (int x = -1; x <= 1; x++) {',
	'			vec2 neighbor = vec2(float(x), float(y));',
	'			vec2 point = vec2(fract(sin(dot(i + neighbor, vec2(127.1, 311.7))) * 43758.5453));',
	'			vec2 diff = neighbor + point - f;',
	'			float dist = length(diff);',
	'			float s1 = 1.0 - step(d1, dist);',
	'			float s2 = 1.0 - step(d2, dist);',
	'			d2 = d1 * s1 + (1.0 - s1) * (s2 * dist) + ((1.0 - s1) * (1.0 - s2)) * d2;',
	'			d1 = dist * s1 + (1.0 - s1) * d1;',
	'		}',
	'	}',
	'	return d2 - d1;',
	'}',
].join('\n');

function waterCommonVertexHeader(): string[] {
	return [
		'attribute float surfaceDeformStrength;',
		...VOXEL_AO_VERTEX_HEADER,
		'varying vec3 vWaterWorldPosition;',
		'varying vec3 vWaterWorldNormal;',
		'uniform float uWaterTime;',
	];
}

function waterCommonVertexBegin(performanceMode: boolean): string[] {
	const rippleAmplitude = performanceMode
		? WATER_PERFORMANCE_RIPPLE_AMPLITUDE
		: WATER_RIPPLE_AMPLITUDE;
	// Ripple displacement is applied on the LOCAL position before the standard
	// modelMatrix is consumed downstream. We perturb only the Y component, and
	// only where the geometry worker said this vertex belongs to a deformable
	// surface (top faces + exposed top edges of side faces). Sides below the
	// rippling top stay rigid so the water never tears off its walls.
	return [
		'vWaterWorldNormal = normalize(mat3(modelMatrix) * normal);',
		'vec3 waterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
		`float waterRippleA = sin(waterWorld.x * ${WATER_RIPPLE_FREQUENCY.toFixed(3)} + uWaterTime * ${WATER_RIPPLE_TIME_SCALE.toFixed(3)});`,
		`float waterRippleB = cos(waterWorld.z * ${WATER_RIPPLE_FREQUENCY.toFixed(3)} * 1.13 + uWaterTime * ${WATER_RIPPLE_TIME_SCALE.toFixed(3)} * 0.87);`,
		`float waterDisplacement = (waterRippleA + waterRippleB) * 0.5 * ${rippleAmplitude.toFixed(4)} * surfaceDeformStrength;`,
		'transformed.y += waterDisplacement;',
		// World position used by the fragment shader for Voronoi UVs: recompute
		// after displacement so the pattern follows the rippling surface.
		'vWaterWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
		...VOXEL_AO_VERTEX_BEGIN,
	];
}

function waterCommonFragmentHeader(performanceMode: boolean): string[] {
	const header = [
		...getVoxelAoFragmentHeader(performanceMode),
		'varying vec3 vWaterWorldPosition;',
		'varying vec3 vWaterWorldNormal;',
		'uniform float uWaterTime;',
		`const vec3 W_FOAM = vec3(${WATER_FOAM_COLOR[0].toFixed(3)}, ${WATER_FOAM_COLOR[1].toFixed(3)}, ${WATER_FOAM_COLOR[2].toFixed(3)});`,
		`const vec3 W_MAIN = vec3(${WATER_MAIN_BLUE[0].toFixed(3)}, ${WATER_MAIN_BLUE[1].toFixed(3)}, ${WATER_MAIN_BLUE[2].toFixed(3)});`,
		`const vec3 W_DARK = vec3(${WATER_DARK_BLUE[0].toFixed(3)}, ${WATER_DARK_BLUE[1].toFixed(3)}, ${WATER_DARK_BLUE[2].toFixed(3)});`,
	];
	if (!performanceMode) header.push(WATER_VORONOI_GLSL);
	return header;
}

function waterColorFragment(performanceMode: boolean): string[] {
	if (performanceMode) {
		return [
			'vec3 wNrm = normalize(vWaterWorldNormal);',
			'bool wIsTopSurface = wNrm.y > 0.5;',
			'bool wIsBottomSurface = wNrm.y < -0.5;',
			'if (wIsBottomSurface) {',
			`	diffuseColor = vec4(W_MAIN * ${VOXEL_AO_CALL}, ${WATER_BOTTOM_ALPHA.toFixed(3)});`,
			'} else {',
			'float wWave = 0.0;',
			'float wFoamMask = 0.0;',
			'if (wIsTopSurface) {',
			'	vec2 wUv = vWaterWorldPosition.xz;',
			'	wWave = 0.5 + 0.5 * sin(wUv.x * 4.0 + uWaterTime * 1.7 + cos(wUv.y * 2.0));',
			'	wFoamMask = smoothstep(0.88, 1.0, wWave);',
			'} else {',
			'	float wFallH = (abs(wNrm.x) > abs(wNrm.z)) ? vWaterWorldPosition.z : vWaterWorldPosition.x;',
			`	vec2 wFallUv = vec2(wFallH / ${WATER_FALL_RIPPLE_WIDTH.toFixed(3)}, vWaterWorldPosition.y / ${WATER_FALL_RIPPLE_HEIGHT.toFixed(3)} + uWaterTime * ${WATER_FALL_RIPPLE_SPEED.toFixed(3)});`,
			'	float wFallColumn = sin(wFallUv.x * 6.283);',
			'	float wFallA = 0.5 + 0.5 * sin(wFallUv.y * 6.283 + wFallColumn * 1.1);',
			'	float wFallB = 0.5 + 0.5 * sin(wFallUv.y * 11.0 + wFallUv.x * 2.3);',
			'	wWave = clamp(wFallA * 0.72 + wFallB * 0.28, 0.0, 1.0);',
			'	wFoamMask = 0.0;',
			'}',
			'vec3 wBody = mix(W_DARK, W_MAIN, wWave);',
			'vec3 wColor = mix(wBody, W_FOAM, wFoamMask * 0.65);',
			`wColor *= ${VOXEL_AO_CALL};`,
			`float wAlpha = mix(${WATER_BODY_ALPHA.toFixed(3)}, ${WATER_FOAM_ALPHA.toFixed(3)}, wFoamMask);`,
			'diffuseColor = vec4(wColor, wAlpha);',
			'}',
		];
	}

	// Replaces #include <color_fragment>. Top faces show the full foam-over-blue
	// look; side faces show only the falling blue tracery. Bottom faces are a
	// cheap translucent blue because they are rarely inspected and do not need
	// the Voronoi detail.
	// Each branch computes exactly what it needs -- nothing is computed
	// then discarded.
	return [
		'vec3 wNrm = normalize(vWaterWorldNormal);',
		'bool wIsTopSurface = wNrm.y > 0.5;',
		'bool wIsBottomSurface = wNrm.y < -0.5;',
		'float wRippleMask = 0.0;',
		'float wFoamMask = 0.0;',
		'float wFoamHalo = 0.0;',
		'if (wIsBottomSurface) {',
		`	diffuseColor = vec4(W_MAIN * ${VOXEL_AO_CALL}, ${WATER_BOTTOM_ALPHA.toFixed(3)});`,
		'} else {',
		'if (wIsTopSurface) {',
		// Top: omnidirectional world-XZ pattern with time-driven warp on both
		// UV axes (matches the source Shadertoy's adapted to world space).
		`	vec2 wUvFoam   = vWaterWorldPosition.xz / ${WATER_FOAM_CELL_SIZE.toFixed(3)};`,
		`	vec2 wUvRipple = vWaterWorldPosition.xz / ${WATER_RIPPLE_CELL_SIZE.toFixed(3)};`,
		'	vec2 wUvFoamD = wUvFoam + vec2(',
		'		sin(uWaterTime * 2.0 + wUvFoam.y * 5.0) * 0.10,',
		'		cos(uWaterTime * 2.0 + wUvFoam.x * 5.0) * 0.10',
		'	);',
		'	vec2 wUvRippleD = wUvRipple + vec2(',
		'		cos(uWaterTime * 1.5 + wUvRipple.y * 4.0) * 0.15,',
		'		sin(uWaterTime * 1.5 + wUvRipple.x * 4.0) * 0.15',
		'	);',
		'	float wEdge1 = waterVoronoi(wUvFoamD);',
		'	float wEdge2 = waterVoronoi(wUvRippleD);',
		'	wRippleMask = 1.0 - smoothstep(0.03, 0.07, wEdge2);',
		'	wFoamMask   = 1.0 - smoothstep(0.02, 0.05, wEdge1);',
		// Halo darkens water slightly AROUND foam crests -- mirrors edge1Halo
		// in the source. Soft shadow rim, no extra texture lookup.
		'	wFoamHalo   = 1.0 - smoothstep(0.10, 0.50, wEdge1);',
		'} else {',
		// Side: pick the in-plane horizontal axis -- X-facing sides use worldZ,
		// Z-facing sides use worldX -- so streaks stay continuous across
		// adjacent water voxels on the same face. V scrolls with time: the
		// same UV value lands at a LOWER worldY each frame, which the eye
		// reads as the pattern falling.
		'	float wFallH = (abs(wNrm.x) > abs(wNrm.z)) ? vWaterWorldPosition.z : vWaterWorldPosition.x;',
		'	float wFallV = vWaterWorldPosition.y;',
		`	vec2 wUvRipple = vec2(wFallH / ${WATER_FALL_RIPPLE_WIDTH.toFixed(3)}, wFallV / ${WATER_FALL_RIPPLE_HEIGHT.toFixed(3)} + uWaterTime * ${WATER_FALL_RIPPLE_SPEED.toFixed(3)});`,
		// Domain warp: small horizontal magnitude (no sideways sway) and a
		// larger vertical magnitude (turbulence — individual streaks ride
		// ahead/behind the base scroll). Spatial+temporal keys make the warp
		// deform in place as the streaks descend rather than translating with
		// them.
		'	vec2 wUvRippleD = wUvRipple + vec2(',
		'		cos(wUvRipple.y * 4.2 + uWaterTime * 1.2) * 0.08,',
		'		sin(wUvRipple.x * 3.0 + uWaterTime * 1.4) * 0.20',
		'	);',
		'	float wEdge2 = waterVoronoi(wUvRippleD);',
		'	wRippleMask = 1.0 - smoothstep(0.03, 0.07, wEdge2);',
		'}',
		// Compose. wFoamMask and wFoamHalo are zero on side faces so the foam
		// blend and halo darken become no-ops there. Apply AO last, then
		// finalize diffuseColor with foam-modulated alpha.
		'vec3 wBody = mix(W_DARK, W_MAIN, wRippleMask);',
		'vec3 wColor = mix(wBody, W_FOAM, wFoamMask);',
		'wColor *= 1.0 - wFoamHalo * 0.10;',
		`wColor *= ${VOXEL_AO_CALL};`,
		`float wAlpha = mix(${WATER_BODY_ALPHA.toFixed(3)}, ${WATER_FOAM_ALPHA.toFixed(3)}, wFoamMask);`,
		'diffuseColor = vec4(wColor, wAlpha);',
		'}',
	];
}

// ---------------------------------------------------------------------------
// Shader installation -- AO-only (FP view) and AO + movement-highlight (world)
// ---------------------------------------------------------------------------

function installWaterAoShader(
	material: THREE.MeshStandardMaterial,
	timeUniform: { value: number },
	voxelAo: VoxelAoTexture,
	performanceMode: boolean
): void {
	material.onBeforeCompile = (shader) => {
		applyVoxelAoUniforms(shader, voxelAo);
		shader.uniforms.uWaterTime = timeUniform;

		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			['#include <common>', ...waterCommonVertexHeader()].join('\n')
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			['#include <begin_vertex>', ...waterCommonVertexBegin(performanceMode)].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			['#include <common>', ...waterCommonFragmentHeader(performanceMode)].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			waterColorFragment(performanceMode).join('\n')
		);
	};
}

function installWaterHighlightShader(
	material: THREE.MeshStandardMaterial,
	timeUniform: { value: number },
	highlight: MovementHighlightTexture,
	voxelAo: VoxelAoTexture,
	performanceMode: boolean
): void {
	const highlightSize = new THREE.Vector2(highlight.width, highlight.length);
	const heightLevels = highlight.heightLevels;

	material.onBeforeCompile = (shader) => {
		applyVoxelAoUniforms(shader, voxelAo);
		shader.uniforms.uWaterTime = timeUniform;
		shader.uniforms.movementHighlightMap = { value: highlight.texture };
		shader.uniforms.movementHighlightSize = { value: highlightSize };
		shader.uniforms.movementHighlightHeightLevels = { value: heightLevels };

		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			[
				'#include <common>',
				...waterCommonVertexHeader(),
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
				...waterCommonVertexBegin(performanceMode),
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
				...waterCommonFragmentHeader(performanceMode),
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
			waterColorFragment(performanceMode).join('\n')
		);
		// Movement-highlight overlay -- same pattern as default and stone bricks.
		// We deliberately keep this identical so a tile that spans water and
		// stone reads as one continuous highlight band.
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

export const createWater241Material: MaterialFactory = (
	params: MaterialFactoryParams
): MaterialFactoryResult => {
	const { acceptsMovementHighlight, movementHighlight, voxelAo, performanceMode = false } = params;

	// Per-instance time uniform. onAnimationFrame writes into this object;
	// because three.js holds the same { value } reference inside its uniforms
	// table, no further bookkeeping is required.
	const timeUniform = { value: 0 };

	const material = new THREE.MeshStandardMaterial({
		roughness: WATER_ROUGHNESS,
		metalness: WATER_METALNESS,
		vertexColors: false,
		transparent: true,
		// We keep depthWrite on: stylized water is near-opaque, and writing
		// depth keeps later passes (movement highlight overlay) from leaking
		// through. Multiple water faces in front of each other do not overlap
		// thanks to occlusion-group culling within the water bucket.
		depthWrite: true,
	});

	if (acceptsMovementHighlight && movementHighlight) {
		installWaterHighlightShader(material, timeUniform, movementHighlight, voxelAo, performanceMode);
	} else {
		installWaterAoShader(material, timeUniform, voxelAo, performanceMode);
	}

	const onAnimationFrame = (timeMs: number) => {
		timeUniform.value = timeMs * 0.001;
	};

	return {
		material,
		onAnimationFrame,
		castShadow: false,         // water surface should not cast hard shadows
		receiveShadow: true,
		renderOrder: 1,            // draw after opaque terrain (default = 0)
	};
};

// ---------------------------------------------------------------------------
// Material definition (collected by materials/index.ts)
// ---------------------------------------------------------------------------

const water241Material: TerrainMaterial = {
	bucketKey: 'water_241',
	// Own occlusion group: water hides shared faces against other water voxels
	// (so a pond's interior is hollow), but emits faces against solid terrain
	// so the surface still renders where it meets the bank/floor.
	occlusionGroup: 'water_241',
	// Bump on shader-source change to invalidate the program cache.
	shaderVersion: 7,
	geometry: {
		vertexColors: false,
		// Preserve voxel faces so terrain resolution controls the water mesh
		// density and deformed side top edges stay sealed to the surface.
		preserveVoxelFaces: true,
		deformSurface: true,
	},
	// Experimental: water is non-colliding. Actors wade through it, raycasts and
	// the FP capsule pass through, and it is never a walkable surface -- but it
	// still renders. (Trial run for a future passable "smoke"/"fog" material.)
	passable: true,
	factory: createWater241Material,
	special: {
		paletteIndex: 241,
		label: 'Water',
		swatchColor: WATER_SWATCH,
	},
};

export default water241Material;
