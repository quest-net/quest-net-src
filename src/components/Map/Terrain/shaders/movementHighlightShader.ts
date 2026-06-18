// Movement-highlight shader helpers, shared by every terrain material.
//
// The DM's movement-range overlay is painted onto the terrain surface by every
// material shader. Historically each material carried two near-identical
// onBeforeCompile variants -- one with this overlay (world view) and one without
// (first-person) -- which doubled the number of compiled shader programs. The
// overlay is now ALWAYS compiled in and gated at runtime by the
// `uHighlightEnabled` uniform, so a single program per material serves both
// views (and the surroundings skirt). When disabled the `if` skips the sampler
// fetch entirely, so the first-person/perspective cost is a single coherent
// branch.
//
// The overlay reuses the voxel-AO world-position/normal varyings
// (vVoxelAoWorldPosition / vVoxelAoWorldNormal) rather than declaring its own,
// so every material that applies the AO patch gets the overlay for free. The
// values are identical (both are the post-displacement world position and the
// world-space normal), so there is no behavioural difference.

import * as THREE from 'three';
import type { MovementHighlightTexture } from '../materials/materialTypes';

// ---------------------------------------------------------------------------
// Placeholder texture
//
// Highlight-disabled meshes (first-person terrain, surroundings skirt) still
// need a valid sampler3D bound even though the fetch never runs. A single
// shared 1x1x1 texture satisfies that without per-mesh allocation. Created
// lazily and never disposed -- it lives for the lifetime of the renderer, like
// the pre-warm geometry.
// ---------------------------------------------------------------------------

let placeholder: MovementHighlightTexture | null = null;

function getPlaceholderMovementHighlight(): MovementHighlightTexture {
	if (placeholder) return placeholder;
	const data = new Uint8Array(4); // 1x1x1 RGBA, all zero -> alpha 0 -> no-op
	const texture = new THREE.Data3DTexture(data, 1, 1, 1);
	texture.format = THREE.RGBAFormat;
	texture.type = THREE.UnsignedByteType;
	texture.magFilter = THREE.NearestFilter;
	texture.minFilter = THREE.NearestFilter;
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.wrapR = THREE.ClampToEdgeWrapping;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	placeholder = { texture, data, width: 1, heightLevels: 1, length: 1 };
	return placeholder;
}

// ---------------------------------------------------------------------------
// Shader chunks
//
// Each material appends these to its own #include replacements so the includes
// appear only once in the final source (String.replace only replaces the first
// occurrence). The dithering block targets a distinct include and is applied as
// its own replacement.
// ---------------------------------------------------------------------------

/** Append after `#include <common>` in the vertex shader. */
export const MOVEMENT_HIGHLIGHT_VERTEX_HEADER: readonly string[] = [
	'attribute float tileHeight;',
	'attribute float highlightStrength;',
	'varying float vMovementHighlightHeight;',
	'varying float vMovementHighlightStrength;',
];

/** Append after `#include <begin_vertex>` in the vertex shader. */
export const MOVEMENT_HIGHLIGHT_VERTEX_BEGIN: readonly string[] = [
	'vMovementHighlightHeight = tileHeight;',
	'vMovementHighlightStrength = highlightStrength;',
];

/**
 * Append after `#include <common>` in the fragment shader. `movementHighlightSize`
 * is only read here (not in the vertex stage), but the uniform is shared across
 * stages either way.
 */
export const MOVEMENT_HIGHLIGHT_FRAGMENT_HEADER: readonly string[] = [
	'uniform highp sampler3D movementHighlightMap;',
	'uniform vec2 movementHighlightSize;',
	'uniform float movementHighlightHeightLevels;',
	'uniform float uHighlightEnabled;',
	'varying float vMovementHighlightHeight;',
	'varying float vMovementHighlightStrength;',
];

/**
 * Replaces `#include <dithering_fragment>`. Reuses the voxel-AO world-position/
 * normal varyings. The whole block (including the sampler fetch) is gated by
 * `uHighlightEnabled` so disabled meshes skip it with one coherent branch.
 */
export const MOVEMENT_HIGHLIGHT_DITHERING: readonly string[] = [
	'if (uHighlightEnabled > 0.5) {',
	'	vec3 movementOwnerPosition = vVoxelAoWorldPosition - vVoxelAoWorldNormal * 0.002;',
	'	vec2 movementTileCoord = clamp(',
	'		floor(movementOwnerPosition.xz + movementHighlightSize * 0.5),',
	'		vec2(0.0),',
	'		movementHighlightSize - vec2(1.0)',
	'	);',
	'	float movementTileHeight = clamp(vMovementHighlightHeight, 0.0, movementHighlightHeightLevels - 1.0);',
	'	vec3 movementHighlightUvw = vec3(',
	'		(movementTileCoord.x + 0.5) / movementHighlightSize.x,',
	'		(movementTileHeight + 0.5) / movementHighlightHeightLevels,',
	'		(movementTileCoord.y + 0.5) / movementHighlightSize.y',
	'	);',
	'	vec4 movementHighlight = texture(movementHighlightMap, movementHighlightUvw);',
	'	if (movementHighlight.a > 0.0 && vMovementHighlightStrength > 0.0) {',
	'		vec3 baseColor = gl_FragColor.rgb;',
	'		float baseLuma = dot(baseColor, vec3(0.2126, 0.7152, 0.0722));',
	'		vec2 tileLocal = fract(movementOwnerPosition.xz + movementHighlightSize * 0.5);',
	'		float edgeDistance = min(min(tileLocal.x, 1.0 - tileLocal.x), min(tileLocal.y, 1.0 - tileLocal.y));',
	'		float edgeBand = 1.0 - smoothstep(0.025, 0.11, edgeDistance);',
	'		float markAlpha = clamp(movementHighlight.a * (1.35 + edgeBand * 0.75) * vMovementHighlightStrength, 0.0, 0.92);',
	'		vec3 screened = 1.0 - (1.0 - baseColor) * (1.0 - movementHighlight.rgb * 0.85);',
	'		vec3 marked = mix(baseColor, screened, markAlpha);',
	'		marked = max(marked, movementHighlight.rgb * movementHighlight.a * (0.65 + 0.55 * vMovementHighlightStrength));',
	'		vec3 contrastEdge = mix(vec3(1.0), vec3(0.035), step(0.58, baseLuma));',
	'		vec3 edgeColor = mix(movementHighlight.rgb, contrastEdge, 0.45);',
	'		gl_FragColor.rgb = mix(marked, edgeColor, edgeBand * movementHighlight.a * 0.7 * vMovementHighlightStrength);',
	'	}',
	'}',
	'#include <dithering_fragment>',
];

/**
 * Install the movement-highlight uniforms on an open shader object. Pass the
 * world-view highlight texture to enable the overlay; pass `undefined` (first
 * person, surroundings) to bind the shared placeholder and disable it.
 */
export function applyMovementHighlightUniforms(
	shader: THREE.WebGLProgramParametersWithUniforms,
	movementHighlight: MovementHighlightTexture | undefined
): void {
	const hl = movementHighlight ?? getPlaceholderMovementHighlight();
	shader.uniforms.movementHighlightMap = { value: hl.texture };
	shader.uniforms.movementHighlightSize = {
		value: new THREE.Vector2(hl.width, hl.length),
	};
	shader.uniforms.movementHighlightHeightLevels = { value: hl.heightLevels };
	shader.uniforms.uHighlightEnabled = { value: movementHighlight ? 1 : 0 };
}
