// Voxel ambient-occlusion shader helpers, shared by every terrain material.
//
// AO is computed per fragment by sampling the voxel-occupancy 3D texture
// emitted by the geometry worker. This decouples AO from the greedy mesh
// (so adjacent faces with different occluder patterns merge freely) and from
// the voxel resolution (the falloff radius is a fixed world-space distance,
// independent of how many voxels make up a tactical tile).
//
// Sampling pattern: at each fragment we project one voxel-thickness into the
// empty cell adjacent to the face, then take 4 cardinal and 4 diagonal taps
// in the tangent plane at world-space radius `voxelAoRadius` (default 0.5,
// i.e. half a tactical tile). Sides are weighted 2x diagonals to match the
// classic Minecraft AO formula's emphasis. A value of 1 = fully lit, 0.45 =
// maximally occluded -- the same darkest-stop the old per-vertex curve used.

import * as THREE from 'three';
import type { VoxelTerrainOccupancy } from '../geometry/VoxelTerrainGeometryUtils';

/** World-space radius of the AO falloff kernel, in tactical units. */
export const VOXEL_AO_FALLOFF_RADIUS = 0.5;

/**
 * Main-thread wrapper around the worker's voxel-occupancy snapshot, ready to
 * bind as the AO sampler uniform.
 */
export interface VoxelAoTexture {
	texture: THREE.Data3DTexture;
	origin: THREE.Vector3;
	size: THREE.Vector3;
	voxelSize: number;
}

function configureOccupancyTexture(texture: THREE.Data3DTexture): void {
	texture.format = THREE.RedFormat;
	texture.type = THREE.UnsignedByteType;
	// Linear filtering gives smooth AO transitions at voxel boundaries. Even
	// with binary input (0 / 255), the filtered read produces 0..1 gradients
	// the AO formula consumes directly.
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearFilter;
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.wrapR = THREE.ClampToEdgeWrapping;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
}

/** Build a sampler-ready AO texture from a worker occupancy snapshot. */
export function createVoxelAoTexture(occupancy: VoxelTerrainOccupancy): VoxelAoTexture {
	const texture = new THREE.Data3DTexture(
		occupancy.data,
		occupancy.voxelWidth,
		occupancy.voxelHeight,
		occupancy.voxelLength
	);
	configureOccupancyTexture(texture);
	return {
		texture,
		origin: new THREE.Vector3(
			occupancy.worldOriginX,
			occupancy.worldOriginY,
			occupancy.worldOriginZ
		),
		size: new THREE.Vector3(
			occupancy.worldSizeX,
			occupancy.worldSizeY,
			occupancy.worldSizeZ
		),
		voxelSize: occupancy.voxelSize,
	};
}

/**
 * Placeholder 1x1x1 AO texture for shader pre-warm and for the brief moment
 * between scene setup and first terrain build. Reads as fully empty so AO is
 * a no-op against it.
 */
export function createPlaceholderVoxelAoTexture(): VoxelAoTexture {
	const data = new Uint8Array(1);
	const texture = new THREE.Data3DTexture(data, 1, 1, 1);
	configureOccupancyTexture(texture);
	return {
		texture,
		origin: new THREE.Vector3(0, 0, 0),
		size: new THREE.Vector3(1, 1, 1),
		voxelSize: 1,
	};
}

// ---------------------------------------------------------------------------
// Shader chunks
//
// Materials whose color_fragment is "just multiply diffuseColor by the AO
// factor" should call `applyVoxelAoPatch` and be done. Materials that already
// override color_fragment for their own purposes (stone bricks, water) should
// inline these chunks into their own combined onBeforeCompile and call
// `applyVoxelAoUniforms` to install the uniforms.
// ---------------------------------------------------------------------------

/** Append after `#include <common>` in the vertex shader. */
export const VOXEL_AO_VERTEX_HEADER: readonly string[] = [
	'varying vec3 vVoxelAoWorldPosition;',
	'varying vec3 vVoxelAoWorldNormal;',
];

/**
 * Append after `#include <begin_vertex>` in the vertex shader.
 *
 * Position is computed from `transformed`, so any vertex displacement that
 * earlier patches (e.g. water surface ripples) applied to `transformed` flows
 * into the AO sample position automatically.
 */
export const VOXEL_AO_VERTEX_BEGIN: readonly string[] = [
	'vVoxelAoWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
	'vVoxelAoWorldNormal = normalize(mat3(modelMatrix) * normal);',
];

/** Append after `#include <common>` in the fragment shader. */
export const VOXEL_AO_FRAGMENT_HEADER: readonly string[] = [
	'uniform highp sampler3D voxelAoOccupancy;',
	'uniform vec3 voxelAoOrigin;',
	'uniform vec3 voxelAoSize;',
	'uniform float voxelAoRadius;',
	'uniform float voxelAoVoxelSize;',
	'varying vec3 vVoxelAoWorldPosition;',
	'varying vec3 vVoxelAoWorldNormal;',
	'float sampleVoxelAoOccupancy(vec3 worldPos) {',
	'	vec3 uvw = (worldPos - voxelAoOrigin) / voxelAoSize;',
	'	if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return 0.0;',
	'	return texture(voxelAoOccupancy, uvw).r;',
	'}',
	'float computeVoxelAo(vec3 worldPos, vec3 normal) {',
	'	vec3 absN = abs(normal);',
	'	vec3 T1; vec3 T2;',
	'	if (absN.y > 0.5)      { T1 = vec3(1.0, 0.0, 0.0); T2 = vec3(0.0, 0.0, 1.0); }',
	'	else if (absN.x > 0.5) { T1 = vec3(0.0, 1.0, 0.0); T2 = vec3(0.0, 0.0, 1.0); }',
	'	else                   { T1 = vec3(1.0, 0.0, 0.0); T2 = vec3(0.0, 1.0, 0.0); }',
	// One half-voxel into the empty cell adjacent to the face: this is where
	// any 1-voxel-thick occluder directly above/beside the face lives, so the
	// cardinal taps below can see it regardless of resolution.
	'	vec3 base = worldPos + normal * (voxelAoVoxelSize * 0.5);',
	'	float r = voxelAoRadius;',
	// Diagonals are at sqrt(2)/2 * r so their tangent-plane distance to the
	// fragment matches the cardinal taps; otherwise diagonal occluders would
	// register further away than cardinal ones at the same world distance.
	'	float dr = r * 0.7071;',
	'	float sides = 0.0;',
	'	sides += sampleVoxelAoOccupancy(base + T1 * r);',
	'	sides += sampleVoxelAoOccupancy(base - T1 * r);',
	'	sides += sampleVoxelAoOccupancy(base + T2 * r);',
	'	sides += sampleVoxelAoOccupancy(base - T2 * r);',
	'	float diag = 0.0;',
	'	diag += sampleVoxelAoOccupancy(base + (T1 + T2) * dr);',
	'	diag += sampleVoxelAoOccupancy(base + (T1 - T2) * dr);',
	'	diag += sampleVoxelAoOccupancy(base + (-T1 + T2) * dr);',
	'	diag += sampleVoxelAoOccupancy(base + (-T1 - T2) * dr);',
	// Sides counted 2x diagonals to match the classic MC AO emphasis (each
	// side appears in 2 of the 4 per-corner formulas, each corner in 1).
	'	float occ = (sides * 2.0 + diag) / 12.0;',
	'	return mix(0.45, 1.0, 1.0 - occ);',
	'}',
];

/** GLSL expression: the AO multiplier (1.0 = fully lit) for this fragment. */
export const VOXEL_AO_CALL = 'computeVoxelAo(vVoxelAoWorldPosition, vVoxelAoWorldNormal)';

/** Install the AO sampler + parameter uniforms on an open shader object. */
export function applyVoxelAoUniforms(
	shader: THREE.WebGLProgramParametersWithUniforms,
	ao: VoxelAoTexture
): void {
	shader.uniforms.voxelAoOccupancy = { value: ao.texture };
	shader.uniforms.voxelAoOrigin = { value: ao.origin };
	shader.uniforms.voxelAoSize = { value: ao.size };
	shader.uniforms.voxelAoRadius = { value: VOXEL_AO_FALLOFF_RADIUS };
	shader.uniforms.voxelAoVoxelSize = { value: ao.voxelSize };
}

/**
 * AO-only patch. Installs uniforms, threads the world-position varyings, and
 * replaces `#include <color_fragment>` with the AO multiply. Use for materials
 * that don't otherwise override color_fragment.
 */
export function applyVoxelAoPatch(
	shader: THREE.WebGLProgramParametersWithUniforms,
	ao: VoxelAoTexture
): void {
	applyVoxelAoUniforms(shader, ao);
	shader.vertexShader = shader.vertexShader.replace(
		'#include <common>',
		['#include <common>', ...VOXEL_AO_VERTEX_HEADER].join('\n')
	);
	shader.vertexShader = shader.vertexShader.replace(
		'#include <begin_vertex>',
		['#include <begin_vertex>', ...VOXEL_AO_VERTEX_BEGIN].join('\n')
	);
	shader.fragmentShader = shader.fragmentShader.replace(
		'#include <common>',
		['#include <common>', ...VOXEL_AO_FRAGMENT_HEADER].join('\n')
	);
	shader.fragmentShader = shader.fragmentShader.replace(
		'#include <color_fragment>',
		`#include <color_fragment>\ndiffuseColor.rgb *= ${VOXEL_AO_CALL};`
	);
}
