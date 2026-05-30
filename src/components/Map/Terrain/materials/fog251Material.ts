// Fog material (palette index 251).
//
// Fog is rendered VOLUMETRICALLY, not as surface geometry. Painting voxels with
// this index defines the shape of a fog/smoke/cloud volume; the geometry
// builder routes those voxels into a fog-density 3D texture (instead of the
// greedy-meshed render buckets and AO occupancy), and a screen-space raymarch
// pass (see mapVolumetricFog) marches that density per pixel. A thin flat layer
// reads as ground fog, a high sheet as clouds, a tall column as a smoke plume.
//
// Because the volume is raymarched in screen space against the scene depth
// buffer, it is consistent from any camera -- it correctly obscures vision both
// when looked at from the tactical view and when the first-person camera is
// submerged inside it. (The old surface-shaded approach could not: a camera
// inside the hollow shell saw straight out.)
//
// This file therefore carries only METADATA now: the palette index, editor
// swatch, the `passable` flag (actors/raycasts pass through), and the
// `volumetric` flag (excluded from surface meshing). The `factory` is a minimal
// placeholder -- it is never used to draw terrain (no fog render bucket is ever
// emitted); it exists only to satisfy the registry/pre-warm contract. The fog
// look (color, density shaping, animation) lives in the volumetric pass.

import * as THREE from 'three';
import type {
	MaterialFactory,
	MaterialFactoryParams,
	MaterialFactoryResult,
	TerrainMaterial,
} from './materialTypes';

/** Editor swatch + the tint the volumetric pass uses as a starting point. */
const FOG_SWATCH = '#cfd4dc';

// Placeholder factory. Never drives real terrain (fog has no render bucket);
// only the pre-warm step instantiates it. Kept trivial on purpose.
export const createFog251Material: MaterialFactory = (
	_params: MaterialFactoryParams
): MaterialFactoryResult => {
	const material = new THREE.MeshStandardMaterial({
		color: FOG_SWATCH,
		transparent: true,
		opacity: 0,
		depthWrite: false,
		vertexColors: false,
	});
	return {
		material,
		castShadow: false,
		receiveShadow: false,
	};
};

const fog251Material: TerrainMaterial = {
	bucketKey: 'fog_251',
	// Own occlusion group so that solid voxels adjacent to fog still emit their
	// faces (fog is not a surface, so neighboring solids must not be culled
	// against it). Fog itself never renders a bucket, so this only governs how
	// neighbors treat fog cells during face culling.
	occlusionGroup: 'fog_251',
	shaderVersion: 1,
	// Non-colliding: actors and raycasts pass through; never a walkable surface.
	passable: true,
	// Rendered by the volumetric fog pass, not as a surface mesh.
	volumetric: true,
	factory: createFog251Material,
	special: {
		paletteIndex: 251,
		label: 'Fog',
		swatchColor: FOG_SWATCH,
	},
};

export default fog251Material;
