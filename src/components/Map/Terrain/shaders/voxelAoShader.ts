// Voxel ambient-occlusion shader helpers, shared by every terrain material.
//
// AO is computed per fragment by sampling the voxel-occupancy 3D texture
// emitted by the geometry worker. This decouples AO from the greedy mesh
// (so adjacent faces with different occluder patterns merge freely) and from
// the voxel resolution (the falloff radius is a fixed world-space distance,
// independent of how many voxels make up a tactical tile).
//
// Sampling pattern: at each fragment we project one voxel-thickness into the
// empty cell adjacent to the face, then take 4 cardinal taps in the tangent
// plane at world-space radius `voxelAoRadius` (default 0.5, i.e. half a
// tactical tile). A value of 1 = fully lit, 0.45 = maximally occluded -- the
// same darkest-stop the old per-vertex curve used.

import * as THREE from 'three';
import type { VoxelTerrainOccupancy } from '../geometry/VoxelTerrainGeometryUtils';

/** World-space radius of the AO falloff kernel, in tactical units. */
export const VOXEL_AO_FALLOFF_RADIUS = 0.25;

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

function configureOccupancyTexture(
	texture: THREE.Data3DTexture,
	_performanceMode = false
): void {
	texture.format = THREE.RedFormat;
	texture.type = THREE.UnsignedByteType;
	// Linear filtering gives smooth AO transitions at voxel boundaries. Even
	// with binary input (0 / 255), the filtered read produces 0..1 gradients
	// the AO formula consumes directly. Performance mode keeps this filtering
	// because nearest sampling reads as hard shadowing instead of ambient
	// occlusion.
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearFilter;
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.wrapR = THREE.ClampToEdgeWrapping;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
}

/** Build a sampler-ready AO texture from a worker occupancy snapshot. */
export function createVoxelAoTexture(
	occupancy: VoxelTerrainOccupancy,
	options: { performanceMode?: boolean } = {}
): VoxelAoTexture {
	const texture = new THREE.Data3DTexture(
		occupancy.data,
		occupancy.voxelWidth,
		occupancy.voxelHeight,
		occupancy.voxelLength
	);
	configureOccupancyTexture(texture, options.performanceMode ?? false);
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
// Every terrain material inlines these chunks into its own combined
// onBeforeCompile (alongside its color_fragment override and the shared
// movement-highlight chunks) and calls `applyVoxelAoUniforms` to install the
// uniforms. The world-position/normal varyings declared here (vVoxelAoWorld*)
// are also what the movement-highlight overlay reads, so AO and highlight share
// them.
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
	'	float sides = 0.0;',
	'	sides += sampleVoxelAoOccupancy(base + T1 * r);',
	'	sides += sampleVoxelAoOccupancy(base - T1 * r);',
	'	sides += sampleVoxelAoOccupancy(base + T2 * r);',
	'	sides += sampleVoxelAoOccupancy(base - T2 * r);',
	'	float occ = sides / 4.0;',
	'	return mix(0.45, 1.0, 1.0 - occ);',
	'}',
];

export const VOXEL_AO_FRAGMENT_HEADER_PERFORMANCE: readonly string[] = [
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
	'	vec3 base = worldPos + normal * (voxelAoVoxelSize * 0.5);',
	'	float r = voxelAoRadius;',
	'	float sides = 0.0;',
	'	sides += sampleVoxelAoOccupancy(base + T1 * r);',
	'	sides += sampleVoxelAoOccupancy(base - T1 * r);',
	'	sides += sampleVoxelAoOccupancy(base + T2 * r);',
	'	sides += sampleVoxelAoOccupancy(base - T2 * r);',
	'	float occ = sides / 4.0;',
	'	return mix(0.52, 1.0, 1.0 - occ);',
	'}',
];

export function getVoxelAoFragmentHeader(
	performanceMode = false
): readonly string[] {
	return performanceMode
		? VOXEL_AO_FRAGMENT_HEADER_PERFORMANCE
		: VOXEL_AO_FRAGMENT_HEADER;
}

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
