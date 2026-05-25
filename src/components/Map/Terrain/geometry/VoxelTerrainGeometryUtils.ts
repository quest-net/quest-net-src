import type { Voxel, VoxelTerrain } from '../../../../domains/VoxelTerrain/VoxelTerrain';
import { decodeVoxels } from '../../../../utils/terrain/data/VoxelDataUtils';
import { VOXEL_FACE_DEFINITIONS } from './VoxelTerrainGeometryConstants';
import {
	buildVoxelTerrainIndex,
	voxelTopToRulesHeight,
} from '../../../../utils/terrain/data/VoxelTerrainIndex';
import {
	getMaterialBucket,
	getMaterialDeformsSurface,
	getMaterialOcclusionGroup,
	getMaterialPreservesVoxelFaces,
} from '../materials';

import * as THREE from 'three';

export type VoxelColorFactory = (voxel: Voxel) => THREE.Color;

// The palette-index -> material dispatch lives in the materials module so that
// each material file remains the single source of truth. Re-exported here for
// the small number of callers that historically imported it from this module;
// the canonical source is `components/Map/Terrain/materials`.
export { getMaterialBucket, getMaterialOcclusionGroup };


// ---------------------------------------------------------------------------
// Raw geometry buffers
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
	colors: Float32Array;
	/** Per-vertex mask for material vertex deformation. */
	surfaceDeformStrength: Float32Array;
	tileCoords: Float32Array;
	tileHeights: Float32Array;
	highlightStrengths: Float32Array;
	indices: Uint32Array;
}

/**
 * Voxel-occupancy snapshot. One byte per voxel cell, 255 if occupied and 0 if
 * empty, in `data[z * voxelWidth * voxelHeight + y * voxelWidth + x]` order
 * (Z-major, then Y, then X -- the layout `THREE.Data3DTexture` expects).
 *
 * Sized in voxel units. The main thread wraps `data` in a `THREE.Data3DTexture`
 * and feeds it to every terrain material as the AO sampler.
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
	/** One voxel in world units (= 1 / resolution). */
	voxelSize: number;
}

interface VoxelTerrainBufferOptions {
	transferSafe?: boolean;
}

export interface VoxelTerrainBuildResult {
	buckets: Map<string, VoxelTerrainBuffers>;
	occupancy: VoxelTerrainOccupancy;
}

// ---------------------------------------------------------------------------
// Per-render-bucket accumulator -- one per distinct getMaterialBucket() result.
// Allocated lazily the first time a bucket is needed, then grown on demand.
// ---------------------------------------------------------------------------
interface BucketState {
	positions: Float32Array;
	normals: Float32Array;
	colors: Float32Array;
	surfaceDeformStrength: Float32Array;
	tileCoords: Float32Array;
	tileHeights: Float32Array;
	highlightStrengths: Float32Array;
	indices: Uint32Array;
	vp: number; // vertex pointer
	ip: number; // index pointer
}

function createBucketState(maxVertices: number, maxIndices: number): BucketState {
	return {
		positions:          new Float32Array(maxVertices * 3),
		normals:            new Float32Array(maxVertices * 3),
		colors:             new Float32Array(maxVertices * 3),
		surfaceDeformStrength: new Float32Array(maxVertices),
		tileCoords:         new Float32Array(maxVertices * 2),
		tileHeights:        new Float32Array(maxVertices),
		highlightStrengths: new Float32Array(maxVertices),
		indices:            new Uint32Array(maxIndices),
		vp: 0,
		ip: 0,
	};
}

function nextBufferLength(current: number, required: number): number {
	if (required <= current) return current;
	let next = Math.max(current, 256);
	while (next < required) next = Math.ceil(next * 1.5);
	return next;
}

function growFloat32Buffer(buffer: Float32Array, required: number): Float32Array {
	const nextLength = nextBufferLength(buffer.length, required);
	if (nextLength === buffer.length) return buffer;
	const grown = new Float32Array(nextLength);
	grown.set(buffer);
	return grown;
}

function growUint32Buffer(buffer: Uint32Array, required: number): Uint32Array {
	const nextLength = nextBufferLength(buffer.length, required);
	if (nextLength === buffer.length) return buffer;
	const grown = new Uint32Array(nextLength);
	grown.set(buffer);
	return grown;
}

function ensureBucketCapacity(
	bucket: BucketState,
	additionalVertices: number,
	additionalIndices: number
): void {
	const requiredVertices = bucket.vp + additionalVertices;
	const requiredIndices = bucket.ip + additionalIndices;
	bucket.positions = growFloat32Buffer(bucket.positions, requiredVertices * 3);
	bucket.normals = growFloat32Buffer(bucket.normals, requiredVertices * 3);
	bucket.colors = growFloat32Buffer(bucket.colors, requiredVertices * 3);
	bucket.surfaceDeformStrength = growFloat32Buffer(
		bucket.surfaceDeformStrength,
		requiredVertices
	);
	bucket.tileCoords = growFloat32Buffer(bucket.tileCoords, requiredVertices * 2);
	bucket.tileHeights = growFloat32Buffer(bucket.tileHeights, requiredVertices);
	bucket.highlightStrengths = growFloat32Buffer(
		bucket.highlightStrengths,
		requiredVertices
	);
	bucket.indices = growUint32Buffer(bucket.indices, requiredIndices);
}

interface GreedyFace {
	vx: number;
	vy: number;
	vz: number;
	color: number;
	/** Bucket key for this face -- faces only merge within the same bucket. */
	bucket: string;
	preserveVoxelFaces: boolean;
	deformsSurface: boolean;
	deformsTopEdge: boolean;
	r: number;
	g: number;
	b: number;
	tileX: number;
	tileY: number;
	tileHeight: number;
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

function normalAxisOf(faceNormal: readonly [number, number, number]): number {
	if (faceNormal[0] !== 0) return 0;
	if (faceNormal[1] !== 0) return 1;
	return 2;
}

function getAxisValue(voxel: Voxel, axis: number): number {
	if (axis === 0) return voxel.x;
	if (axis === 1) return voxel.y;
	return voxel.z;
}

function getGreedyFaceAxisValue(face: GreedyFace, axis: number): number {
	if (axis === 0) return face.vx;
	if (axis === 1) return face.vy;
	return face.vz;
}

function getFaceSliceCoordinate(
	voxel: Voxel,
	normalAxis: number,
	normalSign: number
): number {
	return getAxisValue(voxel, normalAxis) + (normalSign > 0 ? 1 : 0);
}

function canMergeGreedyFaces(a: GreedyFace, b: GreedyFace | null): boolean {
	// AO is no longer in this predicate: it's computed per-fragment from the
	// voxel-occupancy 3D texture in the material shader, so adjacent faces with
	// different AO patterns can merge freely.
	return (
		b !== null &&
		!a.preserveVoxelFaces &&
		!b.preserveVoxelFaces &&
		a.bucket === b.bucket &&
		a.deformsSurface === b.deformsSurface &&
		a.deformsTopEdge === b.deformsTopEdge &&
		a.color === b.color &&
		a.tileHeight === b.tileHeight
	);
}

function getCornerGridValue(
	corner: readonly [number, number, number],
	axis: number,
	normalAxis: number,
	uAxis: number,
	vAxis: number,
	sliceCoordinate: number,
	startU: number,
	endU: number,
	startV: number,
	endV: number
): number {
	if (axis === normalAxis) return sliceCoordinate;
	if (axis === uAxis) return corner[axis] < 0 ? startU : endU;
	if (axis === vAxis) return corner[axis] < 0 ? startV : endV;
	return 0;
}

// ---------------------------------------------------------------------------
// Core buffer builder -- no Three.js objects created, safe to run in a worker.
// Returns:
//   - buckets: Map<bucketKey, VoxelTerrainBuffers> with properly-sized (sliced)
//     TypedArrays ready for transfer. Each bucket becomes its own draw call.
//   - occupancy: voxel-occupancy snapshot used by the per-fragment AO shader.
// ---------------------------------------------------------------------------
export function buildVoxelTerrainBuffers(
	terrain: VoxelTerrain,
	createVoxelColor: VoxelColorFactory,
	options: VoxelTerrainBufferOptions = {}
): VoxelTerrainBuildResult {
	// Decode once, share with the index so it doesn't re-decode for occupancy.
	const voxels = Array.from(decodeVoxels(terrain.Voxels));
	const index = buildVoxelTerrainIndex(terrain, voxels);
	const { resolution, voxelCount, voxelWidth, voxelHeight, voxelLength } = index;
	const transferSafe = options.transferSafe ?? false;

	// Buckets grow on demand, so material-specific buckets only allocate storage
	// for the faces they actually render.
	const initialVertices = Math.min(Math.max(voxelCount * 4, 256), 65536);
	const initialIndices = Math.min(Math.max(voxelCount * 6, 384), 98304);

	const buckets = new Map<string, BucketState>();

	const getOrCreateBucket = (key: string): BucketState => {
		let b = buckets.get(key);
		if (!b) {
			b = createBucketState(initialVertices, initialIndices);
			buckets.set(key, b);
		}
		return b;
	};

	const voxelDimensions = [voxelWidth, voxelHeight, voxelLength] as const;
	const colorCache = new Map<number, { r: number; g: number; b: number }>();

	const getCachedColor = (voxel: Voxel) => {
		const cached = colorCache.get(voxel.color);
		if (cached) return cached;
		const color = createVoxelColor(voxel);
		const cachedColor = { r: color.r, g: color.g, b: color.b };
		colorCache.set(voxel.color, cachedColor);
		return cachedColor;
	};

	// -----------------------------------------------------------------------
	// Voxel-occupancy snapshot for per-fragment AO. One byte per voxel cell in
	// Z-major (then Y, then X) order, which is the layout `THREE.Data3DTexture`
	// expects. Built in this same pass since we already have the decoded voxels
	// on hand.
	// -----------------------------------------------------------------------
	const occupancyData = new Uint8Array(voxelWidth * voxelHeight * voxelLength);
	for (const voxel of voxels) {
		if (
			voxel.x < 0 || voxel.x >= voxelWidth ||
			voxel.y < 0 || voxel.y >= voxelHeight ||
			voxel.z < 0 || voxel.z >= voxelLength
		) continue;
		occupancyData[voxel.z * voxelWidth * voxelHeight + voxel.y * voxelWidth + voxel.x] = 255;
	}

	const writeGreedyQuad = (
		face: typeof VOXEL_FACE_DEFINITIONS[number],
		greedyFace: GreedyFace,
		normalAxis: number,
		uAxis: number,
		vAxis: number,
		sliceCoordinate: number,
		quadWidth: number,
		quadHeight: number
	) => {
		const b = getOrCreateBucket(greedyFace.bucket);
		const [nx, ny, nz] = face.normal;
		const strength = ny > 0.5 ? 1 : 0.28;
		const startU = getGreedyFaceAxisValue(greedyFace, uAxis);
		const startV = getGreedyFaceAxisValue(greedyFace, vAxis);
		const endU = startU + quadWidth;
		const endV = startV + quadHeight;
		const vertexCount = 4;

		ensureBucketCapacity(b, vertexCount, 6);
		const faceStartVertex = b.vp;
		const cornerGridValues = face.corners.map((corner) => ([
			getCornerGridValue(
				corner,
				0,
				normalAxis,
				uAxis,
				vAxis,
				sliceCoordinate,
				startU,
				endU,
				startV,
				endV
			),
			getCornerGridValue(
				corner,
				1,
				normalAxis,
				uAxis,
				vAxis,
				sliceCoordinate,
				startU,
				endU,
				startV,
				endV
			),
			getCornerGridValue(
				corner,
				2,
				normalAxis,
				uAxis,
				vAxis,
				sliceCoordinate,
				startU,
				endU,
				startV,
				endV
			),
		] as const));
		const topGridY = Math.max(
			cornerGridValues[0][1],
			cornerGridValues[1][1],
			cornerGridValues[2][1],
			cornerGridValues[3][1]
		);
		const isTopFaceDeformed = greedyFace.deformsSurface && ny > 0.5;

		for (let ci = 0; ci < vertexCount; ci++) {
			const [gridX, gridY, gridZ] = cornerGridValues[ci];
			const p3 = b.vp * 3;
			const p2 = b.vp * 2;
			b.positions[p3] = gridX / resolution - terrain.Width / 2;
			b.positions[p3 + 1] = gridY / resolution - 0.5;
			b.positions[p3 + 2] = gridZ / resolution - terrain.Length / 2;
			b.normals[p3] = nx;
			b.normals[p3 + 1] = ny;
			b.normals[p3 + 2] = nz;
			b.colors[p3] = greedyFace.r;
			b.colors[p3 + 1] = greedyFace.g;
			b.colors[p3 + 2] = greedyFace.b;
			const isSideTopEdgeDeformed = greedyFace.deformsTopEdge &&
				ny === 0 &&
				Math.abs(gridY - topGridY) < 0.0001;
			b.surfaceDeformStrength[b.vp] = isTopFaceDeformed || isSideTopEdgeDeformed ? 1 : 0;
			// tileCoord is retained for buffer compatibility. The gameplay
			// highlight shader derives X/Z per fragment from world position so
			// merged quads can span tactical-tile boundaries safely.
			b.tileCoords[p2] = greedyFace.tileX;
			b.tileCoords[p2 + 1] = greedyFace.tileY;
			b.tileHeights[b.vp] = greedyFace.tileHeight;
			b.highlightStrengths[b.vp] = strength;
			b.vp++;
		}

		// Default winding: v0 -- v1 -- v2 / v0 -- v2 -- v3. The old quad-flip
		// fix was for vertex-AO diagonal anisotropy; with AO computed per
		// fragment from a 3D texture, both winding choices interpolate the same
		// colour, so a stable winding is all we need.
		b.indices[b.ip] = faceStartVertex;
		b.indices[b.ip + 1] = faceStartVertex + 1;
		b.indices[b.ip + 2] = faceStartVertex + 2;
		b.indices[b.ip + 3] = faceStartVertex;
		b.indices[b.ip + 4] = faceStartVertex + 2;
		b.indices[b.ip + 5] = faceStartVertex + 3;
		b.ip += 6;
	};

	for (const face of VOXEL_FACE_DEFINITIONS) {
		const [dx, dy, dz] = face.neighborOffset;
		const normalAxis = normalAxisOf(face.normal);
		const normalSign = face.normal[normalAxis];
		const tangentAxes = ([0, 1, 2] as const).filter((axis) => axis !== normalAxis);
		const uAxis = tangentAxes[0];
		const vAxis = tangentAxes[1];
		const uDim = voxelDimensions[uAxis];
		const vDim = voxelDimensions[vAxis];
		const masks = new Map<number, Array<GreedyFace | null>>();

		for (const voxel of voxels) {
			const { x: vx, y: vy, z: vz } = voxel;

			// Face culling: cull a face if and only if its neighbor is in the
			// same occlusion group. Render bucket controls draw calls and shader
			// selection; occlusion group controls whether neighboring materials
			// are allowed to hide shared faces.
			const neighborColor = index.getVoxelColor(vx + dx, vy + dy, vz + dz);
			if (
				neighborColor !== null &&
				getMaterialOcclusionGroup(voxel.color) === getMaterialOcclusionGroup(neighborColor)
			) continue;

			const sliceCoordinate = getFaceSliceCoordinate(voxel, normalAxis, normalSign);
			let mask = masks.get(sliceCoordinate);
			if (!mask) {
				mask = new Array<GreedyFace | null>(uDim * vDim).fill(null);
				masks.set(sliceCoordinate, mask);
			}

			const color = getCachedColor(voxel);
			const u = getAxisValue(voxel, uAxis);
			const v = getAxisValue(voxel, vAxis);
			const bucket = getMaterialBucket(voxel.color);
			const deformsSurface = getMaterialDeformsSurface(voxel.color);
			const aboveColor = index.getVoxelColor(vx, vy + 1, vz);
			const topEdgeExposed = aboveColor === null ||
				getMaterialOcclusionGroup(voxel.color) !== getMaterialOcclusionGroup(aboveColor);

			mask[u + v * uDim] = {
				vx,
				vy,
				vz,
				color: voxel.color,
				bucket,
				preserveVoxelFaces: getMaterialPreservesVoxelFaces(voxel.color),
				deformsSurface,
				deformsTopEdge: deformsSurface && face.normal[1] === 0 && topEdgeExposed,
				r: color.r,
				g: color.g,
				b: color.b,
				tileX: Math.floor(vx / resolution),
				tileY: Math.floor(vz / resolution),
				tileHeight: voxelTopToRulesHeight(vy, resolution),
			};
		}

		for (const [sliceCoordinate, mask] of masks) {
			for (let v = 0; v < vDim; v++) {
				for (let u = 0; u < uDim;) {
					const maskIndex = u + v * uDim;
					const greedyFace = mask[maskIndex];
					if (!greedyFace) {
						u++;
						continue;
					}

					let quadWidth = 1;
					while (
						u + quadWidth < uDim &&
						canMergeGreedyFaces(greedyFace, mask[u + quadWidth + v * uDim])
					) {
						quadWidth++;
					}

					let quadHeight = 1;
					heightSearch:
					while (v + quadHeight < vDim) {
						for (let testU = 0; testU < quadWidth; testU++) {
							if (!canMergeGreedyFaces(
								greedyFace,
								mask[u + testU + (v + quadHeight) * uDim]
							)) {
								break heightSearch;
							}
						}
						quadHeight++;
					}

					writeGreedyQuad(
						face,
						greedyFace,
						normalAxis,
						uAxis,
						vAxis,
						sliceCoordinate,
						quadWidth,
						quadHeight
					);

					for (let clearV = 0; clearV < quadHeight; clearV++) {
						for (let clearU = 0; clearU < quadWidth; clearU++) {
							mask[u + clearU + (v + clearV) * uDim] = null;
						}
					}

					u += quadWidth;
				}
			}
		}
	}

	// Trim and package each bucket's buffers.
	const bucketResult = new Map<string, VoxelTerrainBuffers>();
	for (const [key, b] of buckets) {
		bucketResult.set(key, {
			positions:          trimFloat32Buffer(b.positions, b.vp * 3, transferSafe),
			normals:            trimFloat32Buffer(b.normals, b.vp * 3, transferSafe),
			colors:             trimFloat32Buffer(b.colors, b.vp * 3, transferSafe),
			surfaceDeformStrength: trimFloat32Buffer(b.surfaceDeformStrength, b.vp, transferSafe),
			tileCoords:         trimFloat32Buffer(b.tileCoords, b.vp * 2, transferSafe),
			tileHeights:        trimFloat32Buffer(b.tileHeights, b.vp, transferSafe),
			highlightStrengths: trimFloat32Buffer(b.highlightStrengths, b.vp, transferSafe),
			indices:            trimUint32Buffer(b.indices, b.ip, transferSafe),
		});
	}

	const occupancy: VoxelTerrainOccupancy = {
		data: occupancyData,
		voxelWidth,
		voxelHeight,
		voxelLength,
		worldOriginX: -terrain.Width / 2,
		worldOriginY: -0.5,
		worldOriginZ: -terrain.Length / 2,
		worldSizeX: terrain.Width,
		worldSizeY: terrain.Height,
		worldSizeZ: terrain.Length,
		voxelSize: 1 / resolution,
	};

	return { buckets: bucketResult, occupancy };
}

// ---------------------------------------------------------------------------
// Main-thread helper: assemble a BufferGeometry from one bucket's buffer struct.
// Call once per bucket entry in the Map returned by buildVoxelTerrainBuffers.
// ---------------------------------------------------------------------------
export function createVoxelTerrainBufferGeometry(
	buffers: VoxelTerrainBuffers
): THREE.BufferGeometry {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
	geometry.setAttribute('normal',   new THREE.BufferAttribute(buffers.normals, 3));
	geometry.setAttribute('color',    new THREE.BufferAttribute(buffers.colors, 3));
	geometry.setAttribute(
		'surfaceDeformStrength',
		new THREE.BufferAttribute(buffers.surfaceDeformStrength, 1)
	);
	geometry.setAttribute('tileCoord', new THREE.BufferAttribute(buffers.tileCoords, 2));
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
