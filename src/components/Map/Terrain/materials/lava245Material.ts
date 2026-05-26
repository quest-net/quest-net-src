// Lava material (palette index 245).
//
// Stylized animated lava: slow-moving Voronoi cell plates where bright
// orange/yellow glowing interiors (molten rock) are separated by dark
// red/black cooling crust at cell edges. Two Voronoi fields drive the look:
//
//   - Top faces use world-XZ mapping with slow domain warp. Large cells
//     define the crust-plate network; smaller cells control the inner glow
//     detail. Cell interiors (far from edges) are bright/hot; cell edges
//     are dark cooling crust. The glow pulses slowly via a global sin wave.
//     Surface is displaced by a very slow sin/cos wave -- lava is viscous,
//     far less choppy than water.
//   - Side faces show slow downward-scrolling lava streaks, structurally
//     identical to the waterfall pattern but much slower, warmer, and
//     driven by the same Voronoi edge field with no foam suppression.
//   - Bottom faces are a cheap dark red -- rarely visible.
//
// Lava is emissive (the bloom pass picks it up) and nearly opaque. The
// emissive intensity pulses slowly via the time uniform so the glow
// breathes rather than sitting at a flat value. No shadow casting.
//
// Adapted from water241Material.ts -- same Voronoi helper and shader
// injection pattern. Brightness mapping is inverted relative to water:
// bright cell centers / dark edges instead of bright edges / dark body.

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

const LAVA_SWATCH = '#cc3300';

/** World units per Voronoi cell for the large crust-plate pattern. */
const LAVA_CRUST_CELL_SIZE = 1.6;
/** World units per Voronoi cell for the inner glow-detail pattern. */
const LAVA_GLOW_CELL_SIZE = 0.85;

const LAVA_CRUST_COLOR:  readonly [number, number, number] = [0.02, 0.00, 0.00];
const LAVA_MID_COLOR:    readonly [number, number, number] = [0.88, 0.22, 0.00];
const LAVA_BRIGHT_COLOR: readonly [number, number, number] = [1.00, 0.90, 0.25];

/** Alpha for top/side faces. Nearly opaque -- lava is not transparent. */
const LAVA_BODY_ALPHA = 0.97;
/** Alpha for bottom faces (cheap fallback). */
const LAVA_BOTTOM_ALPHA = 0.90;

/** Surface ripple amplitude in world units. Very low -- lava is viscous. */
const LAVA_RIPPLE_AMPLITUDE = 0.055;
const LAVA_PERFORMANCE_RIPPLE_AMPLITUDE = 0.018;
/** Surface ripple spatial frequency (radians per world unit). */
const LAVA_RIPPLE_FREQUENCY = 1.8;
/** Surface ripple temporal frequency -- much slower than water. */
const LAVA_RIPPLE_TIME_SCALE = 0.35;

// -- Side-face (lava flow) tuning -------------------------------------------
/** World units per flow cell horizontally on side faces. */
const LAVA_FALL_RIPPLE_WIDTH = 1.0;
/** World units per flow cell vertically on side faces (taller = longer streaks). */
const LAVA_FALL_RIPPLE_HEIGHT = 1.5;
/** Lava cells per second the flow descends. Very slow -- viscous. */
const LAVA_FALL_RIPPLE_SPEED = 0.40;

/** PBR knobs: lava is rough + dielectric. */
const LAVA_ROUGHNESS = 0.45;
const LAVA_METALNESS = 0.0;

/** Base emissive hex color. Bloom pass amplifies this to a visible glow. */
const LAVA_EMISSIVE_COLOR = '#ff3300';
/** Base emissive intensity before the per-frame pulse is applied. */
const LAVA_EMISSIVE_INTENSITY = 3.2;

// ---------------------------------------------------------------------------
// GLSL helpers (shared between AO-only and movement-highlight variants)
// ---------------------------------------------------------------------------

// Voronoi (F2 - F1) -- same branchless formula used by water, renamed to
// `lavaVoronoi` for clarity. Returns small values at cell edges and larger
// values at cell centers; this is the opposite of what water uses (water
// draws foam at edges; lava draws crust at edges and glow at centers).
const LAVA_VORONOI_GLSL: string = [
	'float lavaVoronoi(vec2 uv) {',
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

function lavaCommonVertexHeader(): string[] {
	return [
		'attribute float surfaceDeformStrength;',
		...VOXEL_AO_VERTEX_HEADER,
		'varying vec3 vLavaWorldPosition;',
		'varying vec3 vLavaWorldNormal;',
		'uniform float uLavaTime;',
	];
}

function lavaCommonVertexBegin(performanceMode: boolean): string[] {
	const rippleAmplitude = performanceMode
		? LAVA_PERFORMANCE_RIPPLE_AMPLITUDE
		: LAVA_RIPPLE_AMPLITUDE;
	// Same displacement logic as water: perturb Y on top faces only
	// (surfaceDeformStrength == 0 on sides/bottom), recompute world position
	// after displacement so the fragment shader sees the deformed surface.
	return [
		'vLavaWorldNormal = normalize(mat3(modelMatrix) * normal);',
		'vec3 lavaWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
		`float lavaRippleA = sin(lavaWorld.x * ${LAVA_RIPPLE_FREQUENCY.toFixed(3)} + uLavaTime * ${LAVA_RIPPLE_TIME_SCALE.toFixed(3)});`,
		`float lavaRippleB = cos(lavaWorld.z * ${LAVA_RIPPLE_FREQUENCY.toFixed(3)} * 1.17 + uLavaTime * ${LAVA_RIPPLE_TIME_SCALE.toFixed(3)} * 0.83);`,
		`float lavaDisplacement = (lavaRippleA + lavaRippleB) * 0.5 * ${rippleAmplitude.toFixed(4)} * surfaceDeformStrength;`,
		'transformed.y += lavaDisplacement;',
		'vLavaWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
		...VOXEL_AO_VERTEX_BEGIN,
	];
}

function lavaCommonFragmentHeader(performanceMode: boolean): string[] {
	const header = [
		...getVoxelAoFragmentHeader(performanceMode),
		'varying vec3 vLavaWorldPosition;',
		'varying vec3 vLavaWorldNormal;',
		'uniform float uLavaTime;',
		`const vec3 L_CRUST  = vec3(${LAVA_CRUST_COLOR[0].toFixed(3)}, ${LAVA_CRUST_COLOR[1].toFixed(3)}, ${LAVA_CRUST_COLOR[2].toFixed(3)});`,
		`const vec3 L_MID    = vec3(${LAVA_MID_COLOR[0].toFixed(3)}, ${LAVA_MID_COLOR[1].toFixed(3)}, ${LAVA_MID_COLOR[2].toFixed(3)});`,
		`const vec3 L_BRIGHT = vec3(${LAVA_BRIGHT_COLOR[0].toFixed(3)}, ${LAVA_BRIGHT_COLOR[1].toFixed(3)}, ${LAVA_BRIGHT_COLOR[2].toFixed(3)});`,
	];
	if (!performanceMode) header.push(LAVA_VORONOI_GLSL);
	return header;
}

function lavaColorFragment(performanceMode: boolean): string[] {
	if (performanceMode) {
		// Performance path: no Voronoi -- use cheap sin waves for the glow
		// pattern. Bottom is a flat dark red.
		return [
			'vec3 lNrm = normalize(vLavaWorldNormal);',
			'bool lIsTop    = lNrm.y >  0.5;',
			'bool lIsBottom = lNrm.y < -0.5;',
			'if (lIsBottom) {',
			`	diffuseColor = vec4(L_CRUST * ${VOXEL_AO_CALL}, ${LAVA_BOTTOM_ALPHA.toFixed(3)});`,
			'} else {',
			'float lGlow = 0.0;',
			'if (lIsTop) {',
			'	vec2 lUv = vLavaWorldPosition.xz;',
			'	lGlow = 0.5 + 0.5 * sin(lUv.x * 2.8 + uLavaTime * 0.5 + cos(lUv.y * 1.6 + uLavaTime * 0.35));',
			'} else {',
			'	float lFallH = (abs(lNrm.x) > abs(lNrm.z)) ? vLavaWorldPosition.z : vLavaWorldPosition.x;',
			`	vec2 lFallUv = vec2(lFallH / ${LAVA_FALL_RIPPLE_WIDTH.toFixed(3)}, vLavaWorldPosition.y / ${LAVA_FALL_RIPPLE_HEIGHT.toFixed(3)} + uLavaTime * ${LAVA_FALL_RIPPLE_SPEED.toFixed(3)});`,
			'	float lFallA = 0.5 + 0.5 * sin(lFallUv.y * 5.2 + lFallUv.x * 1.8);',
			'	float lFallB = 0.5 + 0.5 * sin(lFallUv.y * 9.0 + uLavaTime * 0.4);',
			'	lGlow = clamp(lFallA * 0.65 + lFallB * 0.35, 0.0, 1.0);',
			'}',
			'vec3 lColor = mix(L_MID, L_BRIGHT, lGlow * 0.7);',
			`lColor *= ${VOXEL_AO_CALL};`,
			`diffuseColor = vec4(lColor, ${LAVA_BODY_ALPHA.toFixed(3)});`,
			'}',
		];
	}

	// Full quality: two Voronoi fields on top faces (crust plates + glow
	// detail), one field on side faces (flow streaks). Bottom is a flat dark
	// red because it is rarely inspected. Brightness is inverted relative to
	// water: Voronoi returns near-0 at cell edges and larger values at centers,
	// so edges become crust (dark) and interiors become glow (bright/hot).
	return [
		'vec3 lNrm = normalize(vLavaWorldNormal);',
		'bool lIsTop    = lNrm.y >  0.5;',
		'bool lIsBottom = lNrm.y < -0.5;',
		'float lGlowMask  = 0.0;',
		'float lCrustMask = 0.0;',
		'if (lIsBottom) {',
		`	diffuseColor = vec4(L_CRUST * ${VOXEL_AO_CALL}, ${LAVA_BOTTOM_ALPHA.toFixed(3)});`,
		'} else {',
		'if (lIsTop) {',
		// Top: two overlapping Voronoi fields in world XZ. The large field
		// (crust) defines the plate crack network. The smaller field (glow)
		// drives the interior brightness variation. Both warped slowly.
		`	vec2 lUvCrust = vLavaWorldPosition.xz / ${LAVA_CRUST_CELL_SIZE.toFixed(3)};`,
		`	vec2 lUvGlow  = vLavaWorldPosition.xz / ${LAVA_GLOW_CELL_SIZE.toFixed(3)};`,
		'	vec2 lUvCrustW = lUvCrust + vec2(',
		'		sin(uLavaTime * 0.28 + lUvCrust.y * 3.1) * 0.11,',
		'		cos(uLavaTime * 0.23 + lUvCrust.x * 2.8) * 0.11',
		'	);',
		'	vec2 lUvGlowW = lUvGlow + vec2(',
		'		cos(uLavaTime * 0.38 + lUvGlow.y * 2.4) * 0.09,',
		'		sin(uLavaTime * 0.32 + lUvGlow.x * 2.4) * 0.09',
		'	);',
		'	float lEdgeCrust = lavaVoronoi(lUvCrustW);',
		'	float lEdgeGlow  = lavaVoronoi(lUvGlowW);',
		// Crust: 1.0 at cell edges (dist near 0), fades inward.
		'	lCrustMask = 1.0 - smoothstep(0.03, 0.16, lEdgeCrust);',
		// Glow: 1.0 well away from edges (hot interior). Multiplied by a slow
		// global pulse so the whole surface breathes.
		'	lGlowMask  = smoothstep(0.10, 0.30, lEdgeGlow);',
		'	float lPulse = 0.75 + 0.25 * sin(uLavaTime * 1.05);',
		'	lGlowMask *= lPulse;',
		'} else {',
		// Side: downward-scrolling flow streaks. Horizontal tangent axis chosen
		// per face so streaks are continuous across adjacent voxels on the same
		// wall. The scroll direction is -Y (lava falls). Glow lights up the
		// channel interiors; thin crust lines remain at the edges.
		'	float lFallH = (abs(lNrm.x) > abs(lNrm.z)) ? vLavaWorldPosition.z : vLavaWorldPosition.x;',
		'	float lFallV = vLavaWorldPosition.y;',
		`	vec2 lFallUv = vec2(lFallH / ${LAVA_FALL_RIPPLE_WIDTH.toFixed(3)}, lFallV / ${LAVA_FALL_RIPPLE_HEIGHT.toFixed(3)} + uLavaTime * ${LAVA_FALL_RIPPLE_SPEED.toFixed(3)});`,
		'	vec2 lFallUvW = lFallUv + vec2(',
		'		cos(lFallUv.y * 3.2 + uLavaTime * 0.55) * 0.07,',
		'		sin(lFallUv.x * 2.2 + uLavaTime * 0.48) * 0.14',
		'	);',
		'	float lFallEdge = lavaVoronoi(lFallUvW);',
		'	lGlowMask  = smoothstep(0.10, 0.32, lFallEdge) * 0.80;',
		'	lCrustMask = 1.0 - smoothstep(0.03, 0.10, lFallEdge);',
		'}',
		// Compose: glow drives the hot interior color; crust overlays the dark
		// edges. AO applied last.
		'vec3 lBodyColor = mix(L_MID, L_BRIGHT, lGlowMask);',
		'vec3 lColor     = mix(lBodyColor, L_CRUST, lCrustMask);',
		`lColor *= ${VOXEL_AO_CALL};`,
		`diffuseColor = vec4(lColor, ${LAVA_BODY_ALPHA.toFixed(3)});`,
		'}',
	];
}

// Modulates totalEmissiveRadiance (already set to emissive * intensity by
// THREE.js) with a slow sin pulse so the bloom glow breathes. We drop the
// default #include because there is no emissive texture on this material.
function lavaEmissiveFragment(): string[] {
	return [
		'float lavaEmissivePulse = 0.78 + 0.22 * sin(uLavaTime * 1.05);',
		'totalEmissiveRadiance *= lavaEmissivePulse;',
	];
}

// ---------------------------------------------------------------------------
// Shader installation
// ---------------------------------------------------------------------------

function installLavaAoShader(
	material: THREE.MeshStandardMaterial,
	timeUniform: { value: number },
	voxelAo: VoxelAoTexture,
	performanceMode: boolean
): void {
	material.onBeforeCompile = (shader) => {
		applyVoxelAoUniforms(shader, voxelAo);
		shader.uniforms.uLavaTime = timeUniform;

		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			['#include <common>', ...lavaCommonVertexHeader()].join('\n')
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			['#include <begin_vertex>', ...lavaCommonVertexBegin(performanceMode)].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			['#include <common>', ...lavaCommonFragmentHeader(performanceMode)].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			lavaColorFragment(performanceMode).join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <emissivemap_fragment>',
			lavaEmissiveFragment().join('\n')
		);
	};
}

function installLavaHighlightShader(
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
		shader.uniforms.uLavaTime = timeUniform;
		shader.uniforms.movementHighlightMap = { value: highlight.texture };
		shader.uniforms.movementHighlightSize = { value: highlightSize };
		shader.uniforms.movementHighlightHeightLevels = { value: heightLevels };

		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			[
				'#include <common>',
				...lavaCommonVertexHeader(),
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
				...lavaCommonVertexBegin(performanceMode),
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
				...lavaCommonFragmentHeader(performanceMode),
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
			lavaColorFragment(performanceMode).join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <emissivemap_fragment>',
			lavaEmissiveFragment().join('\n')
		);
		// Movement-highlight overlay -- identical to the water implementation
		// so a tile spanning lava and other terrain reads as one continuous band.
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

export const createLava245Material: MaterialFactory = (
	params: MaterialFactoryParams
): MaterialFactoryResult => {
	const { acceptsMovementHighlight, movementHighlight, voxelAo, performanceMode = false } = params;

	// Per-instance time uniform. onAnimationFrame writes into this object;
	// THREE.js holds the same { value } reference in its uniforms table so
	// no further bookkeeping is required.
	const timeUniform = { value: 0 };

	const material = new THREE.MeshStandardMaterial({
		color: LAVA_SWATCH,
		emissive: new THREE.Color(LAVA_EMISSIVE_COLOR),
		emissiveIntensity: LAVA_EMISSIVE_INTENSITY,
		roughness: LAVA_ROUGHNESS,
		metalness: LAVA_METALNESS,
		vertexColors: false,
		transparent: true,
		// Keep depthWrite on: lava is near-opaque and we want later passes
		// (movement highlight overlay) not to leak through.
		depthWrite: true,
	});

	if (acceptsMovementHighlight && movementHighlight) {
		installLavaHighlightShader(material, timeUniform, movementHighlight, voxelAo, performanceMode);
	} else {
		installLavaAoShader(material, timeUniform, voxelAo, performanceMode);
	}

	const onAnimationFrame = (timeMs: number) => {
		timeUniform.value = timeMs * 0.001;
	};

	return {
		material,
		onAnimationFrame,
		castShadow: false,       // lava glows; hard shadow casting looks wrong
		receiveShadow: true,
		renderOrder: 1,          // draw after opaque terrain (default = 0)
	};
};

// ---------------------------------------------------------------------------
// Material definition (collected by materials/index.ts)
// ---------------------------------------------------------------------------

const lava245Material: TerrainMaterial = {
	bucketKey: 'lava_245',
	// Own occlusion group: lava-to-lava faces are culled (solid pool interior
	// stays hollow), but lava emits faces against solid terrain so the surface
	// renders where it meets rock walls and floors.
	occlusionGroup: 'lava_245',
	shaderVersion: 1,
	geometry: {
		vertexColors: false,
		// Preserve per-voxel faces so terrain resolution controls mesh density
		// and the deformed top edges stay sealed to the displaced surface.
		preserveVoxelFaces: true,
		deformSurface: true,
	},
	factory: createLava245Material,
	special: {
		paletteIndex: 245,
		label: 'Lava',
		swatchColor: LAVA_SWATCH,
	},
};

export default lava245Material;
