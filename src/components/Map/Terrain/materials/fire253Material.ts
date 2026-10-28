// Fire material (palette index 253).
//
// Fire voxels only mark WHERE fire is. Their cube faces render invisibly; the
// flames themselves are drawn by ThreeDFireLayer (Map/Fire3D) as camera-facing
// cards with a scrolling-noise erosion shader, a contact glow on the surface
// beneath, and a small pool of flickering point lights.

import * as THREE from 'three';
import type { MaterialFactory, TerrainMaterial } from './materialTypes';

/** Cube faces of fire voxels are never drawn; the fire layer draws the flames. */
const createInvisibleFireMaterial: MaterialFactory = () => ({
	material: new THREE.MeshStandardMaterial({ visible: false }),
	castShadow: false,
	receiveShadow: false,
});

const fire253Material: TerrainMaterial = {
	bucketKey: 'fire_253',
	// Own group: the floor or wall a flame sits against must keep its face.
	occlusionGroup: 'fire_253',
	shaderVersion: 1,
	geometry: { vertexColors: false },
	// Actors walk into fire; it never blocks movement, raycasts or sight.
	passable: true,
	factory: createInvisibleFireMaterial,
	special: {
		paletteIndex: 253,
		label: 'Fire',
		swatchColor: '#ff7a1a',
		category: 'miscellaneous',
	},
};

export default fire253Material;
