// Default material (bucket 'default') -- opaque vertex-coloured terrain with
// ambient occlusion and optional movement-highlight overlay.
//
// This file is one of the per-material definition files collected by
// materials/index.ts. The default export is the TerrainMaterial record; the
// registry wraps `factory` to install a stable customProgramCacheKey derived
// from bucketKey + shaderVersion + highlight flag.

import * as THREE from 'three';
import { THREE_D_TERRAIN_MATERIAL } from '../../threeDMapConstants';
import type {
	MaterialFactory,
	MaterialFactoryParams,
	MaterialFactoryResult,
	MovementHighlightTexture,
	TerrainMaterial,
} from './materialTypes';

// ---------------------------------------------------------------------------
// AO-strength shader patch (shared by both variants)
// ---------------------------------------------------------------------------

/**
 * Patches the AO-strength attribute into a MeshStandardMaterial shader.
 * Applies to both the world-view and FP-view variants of every material.
 */
export function applyAoStrengthPatch(
	shader: THREE.WebGLProgramParametersWithUniforms
): void {
	shader.vertexShader = shader.vertexShader.replace(
		'#include <common>',
		[
			'#include <common>',
			'attribute float aoStrength;',
			'varying float vAoStrength;',
		].join('\n')
	);
	shader.vertexShader = shader.vertexShader.replace(
		'#include <begin_vertex>',
		'#include <begin_vertex>\nvAoStrength = aoStrength;'
	);
	shader.fragmentShader = shader.fragmentShader.replace(
		'#include <common>',
		['#include <common>', 'varying float vAoStrength;'].join('\n')
	);
	shader.fragmentShader = shader.fragmentShader.replace(
		'#include <color_fragment>',
		'#include <color_fragment>\ndiffuseColor.rgb *= vAoStrength;'
	);
}

// ---------------------------------------------------------------------------
// AO-only variant (FP view, no highlight)
// ---------------------------------------------------------------------------

/**
 * Sets material.onBeforeCompile for the AO-only (no movement highlight) variant.
 * Used by the FP-view default material.
 */
function installDefaultAoShader(material: THREE.MeshStandardMaterial): void {
	material.onBeforeCompile = (shader) => {
		applyAoStrengthPatch(shader);
	};
}

// ---------------------------------------------------------------------------
// AO + movement-highlight combined variant (world view)
// ---------------------------------------------------------------------------

/**
 * Sets material.onBeforeCompile for the AO + movement-highlight combined variant.
 * Used by the world-view default material.
 *
 * The AO and highlight patches both modify #include <common> in the vertex and
 * fragment shaders, so they must be combined in a single onBeforeCompile call
 * rather than chained (String.replace only replaces the first occurrence).
 */
function installDefaultHighlightShader(
	material: THREE.MeshStandardMaterial,
	highlight: MovementHighlightTexture
): void {
	const highlightSize = new THREE.Vector2(highlight.width, highlight.length);
	const heightLevels = highlight.heightLevels;

	material.onBeforeCompile = (shader) => {
		shader.uniforms.movementHighlightMap          = { value: highlight.texture };
		shader.uniforms.movementHighlightSize         = { value: highlightSize };
		shader.uniforms.movementHighlightHeightLevels = { value: heightLevels };

		// AO + highlight declarations combined into the same #include <common>
		// replacement so the include appears only once in the final source.
		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			[
				'#include <common>',
				'attribute float aoStrength;',
				'varying float vAoStrength;',
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
				'vAoStrength = aoStrength;',
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
				'varying float vAoStrength;',
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
			'#include <color_fragment>\ndiffuseColor.rgb *= vAoStrength;'
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

export const createDefaultMaterial: MaterialFactory = (params: MaterialFactoryParams): MaterialFactoryResult => {
	const { acceptsMovementHighlight, movementHighlight } = params;

	const material = new THREE.MeshStandardMaterial({
		roughness: THREE_D_TERRAIN_MATERIAL.ROUGHNESS,
		metalness: THREE_D_TERRAIN_MATERIAL.METALNESS,
		vertexColors: true,
	});

	if (acceptsMovementHighlight && movementHighlight) {
		installDefaultHighlightShader(material, movementHighlight);
	} else {
		installDefaultAoShader(material);
	}
	// customProgramCacheKey is set by the registry wrapper.

	return { material, castShadow: true, receiveShadow: true };
};

// ---------------------------------------------------------------------------
// Material definition (collected by materials/index.ts)
// ---------------------------------------------------------------------------

const defaultMaterial: TerrainMaterial = {
	bucketKey: 'default',
	occlusionGroup: 'solid',
	shaderVersion: 1,
	factory: createDefaultMaterial,
	// No `special` block: this is the catch-all material for palette indices 0-239
	// and any unassigned special index.
};

export default defaultMaterial;
