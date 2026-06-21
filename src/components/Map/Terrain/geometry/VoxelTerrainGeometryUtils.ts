import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Voxel terrain geometry types + main-thread BufferGeometry assembly.
//
// The geometry itself is built in the WASM kernel (wasm/voxel-mesher) off the
// main thread (see voxelGeometryWorker.ts); this module only declares the
// buffer/occupancy types shared across the worker boundary and assembles a
// THREE.BufferGeometry from one bucket's buffers on the main thread.
//
// Ambient occlusion is NOT baked into vertex data. It is computed per-fragment
// in the material shader by sampling the voxel-occupancy 3D texture emitted
// alongside these buffers (see VoxelTerrainOccupancy below). This decouples AO
// from greedy meshing (so adjacent faces with different AO patterns merge
// freely) and from voxel resolution (so the AO falloff is a world-space radius
// independent of how many voxels make up a tactical tile).
// ---------------------------------------------------------------------------

export interface VoxelTerrainBuffers {
	positions: Float32Array;
	normals: Float32Array;
	colors?: Float32Array;
	/** Per-vertex mask for material vertex deformation. */
	surfaceDeformStrength?: Float32Array;
	tileHeights: Float32Array;
	highlightStrengths: Float32Array;
	indices: Uint32Array;
}

/**
 * Voxel-occupancy snapshot. One byte per grid cell, 255 if occupied and 0 if
 * empty, in `data[z * voxelWidth * voxelHeight + y * voxelWidth + x]` order
 * (Z-major, then Y, then X -- the layout `THREE.Data3DTexture` expects).
 *
 * This is a (possibly downsampled) view of the voxel grid: `voxelWidth/Height/
 * Length` are the TEXTURE dimensions, which equal the voxel dims at full
 * resolution but are coarser when the volume is downsampled to fit the AO texel
 * budget (see chooseOccupancyDownsampleFactor). The world AABB (worldOrigin/
 * worldSize) is unchanged either way, so the AO shader -- which samples in world
 * space -- needs no knowledge of the factor. `voxelSize` remains the TRUE voxel
 * edge (1 / resolution), used to offset the AO sample half a voxel off the
 * rendered face (the mesh is still full-resolution). CPU consumers that index
 * `data` must derive their grid step from worldSize / dims, NOT from voxelSize.
 *
 * The main thread wraps `data` in a `THREE.Data3DTexture` and feeds it to every
 * terrain material as the AO sampler.
 */
export interface VoxelTerrainOccupancy {
	data: Uint8Array;
	voxelWidth: number;
	voxelHeight: number;
	voxelLength: number;
	/** World coordinates of voxel (0,0,0)'s -X -Y -Z corner. */
	worldOriginX: number;
	worldOriginY: number;
	worldOriginZ: number;
	/** Terrain size in world units (= tactical width/height/length). */
	worldSizeX: number;
	worldSizeY: number;
	worldSizeZ: number;
	/** One TRUE voxel in world units (= 1 / resolution), not the grid-cell size. */
	voxelSize: number;
}

/**
 * Fog-density volume. Structurally identical to the occupancy snapshot (same
 * grid + world bounds + Data3DTexture layout), but holds the density of
 * volumetric materials (255 = full fog, 0 = none) rather than collision
 * occupancy. The main thread wraps `data` in a Data3DTexture the volumetric fog
 * pass raymarches; linear filtering smooths the cell boundaries into soft fog.
 */
export type VoxelTerrainFogVolume = VoxelTerrainOccupancy;

// ---------------------------------------------------------------------------
// Main-thread helper: assemble a BufferGeometry from one bucket's buffer struct.
// Call once per bucket entry in the Map returned by the geometry worker.
// ---------------------------------------------------------------------------
export function createVoxelTerrainBufferGeometry(
	buffers: VoxelTerrainBuffers
): THREE.BufferGeometry {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
	geometry.setAttribute('normal',   new THREE.BufferAttribute(buffers.normals, 3));
	if (buffers.colors) {
		geometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 3));
	}
	if (buffers.surfaceDeformStrength) {
		geometry.setAttribute(
			'surfaceDeformStrength',
			new THREE.BufferAttribute(buffers.surfaceDeformStrength, 1)
		);
	}
	geometry.setAttribute('tileHeight', new THREE.BufferAttribute(buffers.tileHeights, 1));
	geometry.setAttribute(
		'highlightStrength',
		new THREE.BufferAttribute(buffers.highlightStrengths, 1)
	);
	geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	return geometry;
}
