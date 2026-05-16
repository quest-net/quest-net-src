import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Voxel, VoxelTerrain } from '../domains/VoxelTerrain/VoxelTerrain';
import {
	getVoxelSize,
	getVoxelTerrainResolution,
	voxelTopToRulesHeight,
} from './VoxelTerrainUtils';
import { VOXEL_AO_CURVE, VOXEL_FACE_DEFINITIONS } from './VoxelTerrainGeometryConstants';
import { decodeVoxels } from './VoxelDataUtils';

export type VoxelColorFactory = (voxel: Voxel) => THREE.Color;

// ---------------------------------------------------------------------------
// Raw geometry buffers
// ---------------------------------------------------------------------------

export interface VoxelTerrainBuffers {
	positions: Float32Array;
	normals: Float32Array;
	colors: Float32Array;
	tileCoords: Float32Array;
	tileHeights: Float32Array;
	highlightStrengths: Float32Array;
	indices: Uint32Array;
}

interface VoxelTerrainBufferOptions {
	transferSafe?: boolean;
}

function voxelKey(x: number, y: number, z: number): number {
	return x + y * 256 + z * 65536;
}

function trimFloat32Buffer(
	buffer: Float32Array,
	length: number,
	transferSafe: boolean
): Float32Array {
	const view = buffer.subarray(0, length);
	return transferSafe ? view.slice() : view;
}

function trimUint32Buffer(
	buffer: Uint32Array,
	length: number,
	transferSafe: boolean
): Uint32Array {
	const view = buffer.subarray(0, length);
	return transferSafe ? view.slice() : view;
}

// ---------------------------------------------------------------------------
// Vertex ambient occlusion
//
// For a face vertex at corner (cx, cy, cz) on a face with normal (nx, ny, nz),
// we check the three voxels that would cast shadow at that vertex:
//   side1  -- one step in the normal direction + one tangent step
//   side2  -- one step in the normal direction + the other tangent step
//   corner -- one step in the normal direction + both tangent steps
//
// Result: 0 (most occluded) .. 3 (fully lit), matching the VOXEL_AO_CURVE index.
// ---------------------------------------------------------------------------
function vertexAO(
	vx: number, vy: number, vz: number,
	nx: number, ny: number, nz: number,
	cx: number, cy: number, cz: number,
	occupied: Set<number>
): number {
	// Tangent step per axis: 0 for the normal axis, sign of corner component otherwise.
	const tx = nx !== 0 ? 0 : (cx > 0 ? 1 : -1);
	const ty = ny !== 0 ? 0 : (cy > 0 ? 1 : -1);
	const tz = nz !== 0 ? 0 : (cz > 0 ? 1 : -1);

	// Exactly two of (tx, ty, tz) are nonzero (the two tangent axes).
	// Decompose into d1 and d2 without heap allocation, ordered X > Y > Z.
	let d1x: number, d1y: number, d1z: number;
	let d2x: number, d2y: number, d2z: number;
	if (tx !== 0 && ty !== 0) {         // normal is Z-axis
		d1x = tx; d1y = 0;  d1z = 0;
		d2x = 0;  d2y = ty; d2z = 0;
	} else if (tx !== 0 /* && tz !== 0 */) { // normal is Y-axis
		d1x = tx; d1y = 0; d1z = 0;
		d2x = 0;  d2y = 0; d2z = tz;
	} else {                            // normal is X-axis (ty && tz nonzero)
		d1x = 0; d1y = ty; d1z = 0;
		d2x = 0; d2y = 0;  d2z = tz;
	}

	const side1  = occupied.has(voxelKey(vx + nx + d1x,       vy + ny + d1y,       vz + nz + d1z      )) ? 1 : 0;
	const side2  = occupied.has(voxelKey(vx + nx + d2x,       vy + ny + d2y,       vz + nz + d2z      )) ? 1 : 0;
	if (side1 === 1 && side2 === 1) return 0; // maximally occluded -- corner check is irrelevant
	const corner = occupied.has(voxelKey(vx + nx + d1x + d2x, vy + ny + d1y + d2y, vz + nz + d1z + d2z)) ? 1 : 0;
	return 3 - (side1 + side2 + corner);
}

// ---------------------------------------------------------------------------
// Core buffer builder -- no Three.js objects created, safe to run in a worker.
// Returns properly-sized (sliced) TypedArrays ready for transfer.
// ---------------------------------------------------------------------------
export function buildVoxelTerrainBuffers(
	terrain: VoxelTerrain,
	createVoxelColor: VoxelColorFactory,
	options: VoxelTerrainBufferOptions = {}
): VoxelTerrainBuffers {
	const voxelSize = getVoxelSize(terrain);
	const halfVoxelSize = voxelSize / 2;
	const resolution = getVoxelTerrainResolution(terrain);
	const voxels = Array.from(decodeVoxels(terrain.Voxels));
	const voxelCount = voxels.length;
	const transferSafe = options.transferSafe ?? false;

	// Pre-allocate at worst-case size: every voxel fully exposed (6 faces, 4 vertices, 6 indices).
	const maxVertices = voxelCount * 6 * 4;
	const maxIndices  = voxelCount * 6 * 6;

	const positions          = new Float32Array(maxVertices * 3);
	const normals            = new Float32Array(maxVertices * 3);
	const colors             = new Float32Array(maxVertices * 3);
	const tileCoords         = new Float32Array(maxVertices * 2);
	const tileHeights        = new Float32Array(maxVertices);
	const highlightStrengths = new Float32Array(maxVertices);
	const indices            = new Uint32Array(maxIndices);

	let vp = 0; // vertex pointer (one unit = one vertex)
	let ip = 0; // index pointer

	const occupied = new Set<number>();
	for (const voxel of voxels) {
		occupied.add(voxelKey(voxel.x, voxel.y, voxel.z));
	}

	for (const voxel of voxels) {
		const { x: vx, y: vy, z: vz } = voxel;
		const tileX   = Math.floor(vx / resolution);
		const tileY   = Math.floor(vz / resolution);
		const tileH   = voxelTopToRulesHeight(vy, resolution);
		const centerX = vx / resolution - terrain.Width  / 2 + halfVoxelSize;
		const centerY = (vy + 0.5)      / resolution     - 0.5;
		const centerZ = vz / resolution - terrain.Length / 2 + halfVoxelSize;

		const baseColor = createVoxelColor(voxel);
		const bcr = baseColor.r;
		const bcg = baseColor.g;
		const bcb = baseColor.b;

		for (const face of VOXEL_FACE_DEFINITIONS) {
			const [dx, dy, dz] = face.neighborOffset;
			if (occupied.has(voxelKey(vx + dx, vy + dy, vz + dz))) continue;

			const [nx, ny, nz] = face.normal;
			const strength = ny > 0.5 ? 1 : 0.28;

			// Compute AO for all four corners before writing vertex data,
			// because the quad-flip decision depends on all four values.
			const ao0 = vertexAO(vx, vy, vz, nx, ny, nz, face.corners[0][0], face.corners[0][1], face.corners[0][2], occupied);
			const ao1 = vertexAO(vx, vy, vz, nx, ny, nz, face.corners[1][0], face.corners[1][1], face.corners[1][2], occupied);
			const ao2 = vertexAO(vx, vy, vz, nx, ny, nz, face.corners[2][0], face.corners[2][1], face.corners[2][2], occupied);
			const ao3 = vertexAO(vx, vy, vz, nx, ny, nz, face.corners[3][0], face.corners[3][1], face.corners[3][2], occupied);
			const aoValues = [ao0, ao1, ao2, ao3] as const;

			const faceStartVertex = vp;

			for (let ci = 0; ci < 4; ci++) {
				const [cx, cy, cz] = face.corners[ci];
				const aoFactor = VOXEL_AO_CURVE[aoValues[ci]];

				const p3 = vp * 3;
				const p2 = vp * 2;
				positions[p3]     = centerX + cx * voxelSize;
				positions[p3 + 1] = centerY + cy * voxelSize;
				positions[p3 + 2] = centerZ + cz * voxelSize;
				normals[p3]       = nx;
				normals[p3 + 1]   = ny;
				normals[p3 + 2]   = nz;
				colors[p3]        = bcr * aoFactor;
				colors[p3 + 1]    = bcg * aoFactor;
				colors[p3 + 2]    = bcb * aoFactor;
				tileCoords[p2]    = tileX;
				tileCoords[p2 + 1] = tileY;
				tileHeights[vp]         = tileH;
				highlightStrengths[vp]  = strength;
				vp++;
			}

			// Quad-flip anisotropy fix (Mikola Lysenko / 0fps.net):
			// When AO values differ across the diagonal, the "wrong" triangle split
			// creates a visible seam. Flip the winding when the sum of opposite corners
			// is unequal, so the interpolation gradient is always consistent.
			const flipQuad = ao0 + ao2 > ao1 + ao3;
			if (!flipQuad) {
				// Default winding: diagonal v0--v2
				indices[ip]     = faceStartVertex;
				indices[ip + 1] = faceStartVertex + 1;
				indices[ip + 2] = faceStartVertex + 2;
				indices[ip + 3] = faceStartVertex;
				indices[ip + 4] = faceStartVertex + 2;
				indices[ip + 5] = faceStartVertex + 3;
			} else {
				// Flipped winding: diagonal v1--v3
				indices[ip]     = faceStartVertex;
				indices[ip + 1] = faceStartVertex + 1;
				indices[ip + 2] = faceStartVertex + 3;
				indices[ip + 3] = faceStartVertex + 1;
				indices[ip + 4] = faceStartVertex + 2;
				indices[ip + 5] = faceStartVertex + 3;
			}
			ip += 6;
		}
	}

	return {
		positions:          trimFloat32Buffer(positions, vp * 3, transferSafe),
		normals:            trimFloat32Buffer(normals, vp * 3, transferSafe),
		colors:             trimFloat32Buffer(colors, vp * 3, transferSafe),
		tileCoords:         trimFloat32Buffer(tileCoords, vp * 2, transferSafe),
		tileHeights:        trimFloat32Buffer(tileHeights, vp, transferSafe),
		highlightStrengths: trimFloat32Buffer(highlightStrengths, vp, transferSafe),
		indices:            trimUint32Buffer(indices, ip, transferSafe),
	};
}

// ---------------------------------------------------------------------------
// Convenience wrapper that constructs a BufferGeometry + BVH on the caller's
// thread. Used by editor previews and any path that doesn't need off-thread
// building.
// ---------------------------------------------------------------------------
export function createVoxelTerrainGeometry(
	terrain: VoxelTerrain,
	createVoxelColor: VoxelColorFactory
): THREE.BufferGeometry {
	const buf = buildVoxelTerrainBuffers(terrain, createVoxelColor);

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position',          new THREE.BufferAttribute(buf.positions, 3));
	geometry.setAttribute('normal',            new THREE.BufferAttribute(buf.normals, 3));
	geometry.setAttribute('color',             new THREE.BufferAttribute(buf.colors, 3));
	geometry.setAttribute('tileCoord',         new THREE.BufferAttribute(buf.tileCoords, 2));
	geometry.setAttribute('tileHeight',        new THREE.BufferAttribute(buf.tileHeights, 1));
	geometry.setAttribute('highlightStrength', new THREE.BufferAttribute(buf.highlightStrengths, 1));
	geometry.setIndex(new THREE.BufferAttribute(buf.indices, 1));
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	geometry.boundsTree = new MeshBVH(geometry);

	return geometry;
}
