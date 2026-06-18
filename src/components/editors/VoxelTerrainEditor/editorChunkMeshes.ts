// Chunked mesh builder for the voxel terrain editor.
//
// Produces one MeshStandardMaterial mesh per dirty chunk with face-culled
// geometry (only faces between a voxel and an empty/out-of-bounds neighbor are
// emitted). Each vertex carries an `isSpecial` flag (0/1) that drives the
// editor's stripe-pattern shader patch (see editorTerrainShader.ts).

import * as THREE from "three";
import { VOXEL_FACE_DEFINITIONS } from "../../Map/Terrain/geometry/VoxelTerrainGeometryConstants";
import {
	editGridHasVoxelAtIndex,
	editGridIndex,
	type EditGrid,
} from "../../../utils/terrain/editor/EditGridUtils";
import {
	CHUNK_SIZE,
	getChunkVoxelBounds,
	type ChunkDims,
} from "../../../utils/terrain/editor/EditGridChunkUtils";
import { EDITOR_IS_SPECIAL, EDITOR_RGB } from "./editorPaletteTables";

// ---------------------------------------------------------------------------
// Flattened face tables (hot path)
//
// VOXEL_FACE_DEFINITIONS is an array of objects with nested arrays; iterating it
// per voxel allocates iterators and reads through several object hops. The face
// data is constant, so we flatten it once into typed arrays the inner loop
// indexes numerically (no allocations, no property access).
// ---------------------------------------------------------------------------
const FACE_COUNT = VOXEL_FACE_DEFINITIONS.length;
const FACE_NORMALS = new Float32Array(FACE_COUNT * 3);
const FACE_NEIGHBORS = new Int8Array(FACE_COUNT * 3);
const FACE_CORNERS = new Float32Array(FACE_COUNT * 4 * 3); // [face][corner][xyz]
for (let f = 0; f < FACE_COUNT; f++) {
	const def = VOXEL_FACE_DEFINITIONS[f];
	FACE_NORMALS[f * 3] = def.normal[0];
	FACE_NORMALS[f * 3 + 1] = def.normal[1];
	FACE_NORMALS[f * 3 + 2] = def.normal[2];
	FACE_NEIGHBORS[f * 3] = def.neighborOffset[0];
	FACE_NEIGHBORS[f * 3 + 1] = def.neighborOffset[1];
	FACE_NEIGHBORS[f * 3 + 2] = def.neighborOffset[2];
	for (let c = 0; c < 4; c++) {
		FACE_CORNERS[(f * 4 + c) * 3] = def.corners[c][0];
		FACE_CORNERS[(f * 4 + c) * 3 + 1] = def.corners[c][1];
		FACE_CORNERS[(f * 4 + c) * 3 + 2] = def.corners[c][2];
	}
}

// ---------------------------------------------------------------------------
// Reusable scratch buffers, sized to a full CHUNK_SIZE^3 chunk's worst case (a
// fully exposed checkerboard can't exceed every voxel emitting all 6 faces).
// Filled per build then sliced to the exact length for the BufferGeometry, so a
// build allocates only the final right-sized attribute arrays -- no growable
// number[] / push churn.
// ---------------------------------------------------------------------------
const MAX_CHUNK_VERTS = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE * FACE_COUNT * 4;
const MAX_CHUNK_INDICES = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE * FACE_COUNT * 6;
const scratchPositions = new Float32Array(MAX_CHUNK_VERTS * 3);
const scratchNormals = new Float32Array(MAX_CHUNK_VERTS * 3);
const scratchColors = new Float32Array(MAX_CHUNK_VERTS * 3);
const scratchSpecials = new Float32Array(MAX_CHUNK_VERTS);
const scratchIndices = new Uint32Array(MAX_CHUNK_INDICES);

export function buildChunkGeometry(
	grid: EditGrid,
	dims: ChunkDims,
	chunkX: number,
	chunkY: number,
	chunkZ: number,
): THREE.BufferGeometry | null {
	const { vW, vH, vL, resolution, tW, tL } = dims;
	const halfW = tW / 2;
	const halfL = tL / 2;
	const voxelSize = 1 / resolution;
	const halfVoxelSize = voxelSize / 2;
	const layerStride = vW * vL; // +1 Y voxel in flat index space

	const { startX, startY, startZ, endX, endY, endZ } = getChunkVoxelBounds(
		chunkX, chunkY, chunkZ, dims,
	);

	// Vertex / index write cursors into the scratch buffers (in elements).
	let vCount = 0;
	let iCount = 0;

	for (let vy = startY; vy < endY; vy++) {
		for (let vz = startZ; vz < endZ; vz++) {
			for (let vx = startX; vx < endX; vx++) {
				const voxelIndex = editGridIndex(vx, vy, vz, vW, vL);
				if (!editGridHasVoxelAtIndex(grid, voxelIndex)) continue;

				const colorByte = grid.colors[voxelIndex];
				const rgbOffset = colorByte * 3;
				const r = EDITOR_RGB[rgbOffset];
				const g = EDITOR_RGB[rgbOffset + 1];
				const b = EDITOR_RGB[rgbOffset + 2];
				const isSpecial = EDITOR_IS_SPECIAL[colorByte];

				// Center of this voxel in world space.
				const cx = vx / resolution - halfW + halfVoxelSize;
				const cy = (vy + 0.5) / resolution - 0.5;
				const cz = vz / resolution - halfL + halfVoxelSize;

				for (let f = 0; f < FACE_COUNT; f++) {
					const fOff = f * 3;
					const nx2 = vx + FACE_NEIGHBORS[fOff];
					const ny2 = vy + FACE_NEIGHBORS[fOff + 1];
					const nz2 = vz + FACE_NEIGHBORS[fOff + 2];

					// Cull face if neighbor is occupied (out-of-bounds = exposed).
					if (
						nx2 >= 0 && nx2 < vW && ny2 >= 0 && ny2 < vH && nz2 >= 0 && nz2 < vL &&
						editGridHasVoxelAtIndex(
							grid,
							voxelIndex
								+ FACE_NEIGHBORS[fOff]
								+ FACE_NEIGHBORS[fOff + 2] * vW
								+ FACE_NEIGHBORS[fOff + 1] * layerStride,
						)
					) {
						continue;
					}

					const baseVertex = vCount;
					const fnx = FACE_NORMALS[fOff];
					const fny = FACE_NORMALS[fOff + 1];
					const fnz = FACE_NORMALS[fOff + 2];
					const cornerBase = f * 4 * 3;

					for (let c = 0; c < 4; c++) {
						const co = cornerBase + c * 3;
						const p3 = vCount * 3;
						scratchPositions[p3]     = cx + FACE_CORNERS[co] * voxelSize;
						scratchPositions[p3 + 1] = cy + FACE_CORNERS[co + 1] * voxelSize;
						scratchPositions[p3 + 2] = cz + FACE_CORNERS[co + 2] * voxelSize;
						scratchNormals[p3]     = fnx;
						scratchNormals[p3 + 1] = fny;
						scratchNormals[p3 + 2] = fnz;
						scratchColors[p3]     = r;
						scratchColors[p3 + 1] = g;
						scratchColors[p3 + 2] = b;
						scratchSpecials[vCount] = isSpecial;
						vCount++;
					}

					scratchIndices[iCount]     = baseVertex;
					scratchIndices[iCount + 1] = baseVertex + 1;
					scratchIndices[iCount + 2] = baseVertex + 2;
					scratchIndices[iCount + 3] = baseVertex;
					scratchIndices[iCount + 4] = baseVertex + 2;
					scratchIndices[iCount + 5] = baseVertex + 3;
					iCount += 6;
				}
			}
		}
	}

	if (vCount === 0) return null;

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position",  new THREE.BufferAttribute(scratchPositions.slice(0, vCount * 3), 3));
	geometry.setAttribute("normal",    new THREE.BufferAttribute(scratchNormals.slice(0, vCount * 3),   3));
	geometry.setAttribute("color",     new THREE.BufferAttribute(scratchColors.slice(0, vCount * 3),    3));
	geometry.setAttribute("isSpecial", new THREE.BufferAttribute(scratchSpecials.slice(0, vCount),      1));
	geometry.setIndex(new THREE.BufferAttribute(scratchIndices.slice(0, iCount), 1));
	geometry.computeBoundingSphere();
	return geometry;
}

export function rebuildChunk(
	chunkIdx: number,
	cx: number, cy: number, cz: number,
	grid: EditGrid,
	dims: ChunkDims,
	chunkGroup: THREE.Group,
	material: THREE.MeshStandardMaterial,
	chunkMeshes: Map<number, THREE.Mesh | null>,
): void {
	const old = chunkMeshes.get(chunkIdx);
	if (old) {
		chunkGroup.remove(old);
		old.geometry.dispose();
	}

	const geometry = buildChunkGeometry(grid, dims, cx, cy, cz);
	if (!geometry) {
		chunkMeshes.set(chunkIdx, null);
		return;
	}

	const mesh = new THREE.Mesh(geometry, material);
	chunkGroup.add(mesh);
	chunkMeshes.set(chunkIdx, mesh);
}

export function clearAllChunkMeshes(
	chunkGroup: THREE.Group,
	chunkMeshes: Map<number, THREE.Mesh | null>,
): void {
	for (const mesh of chunkMeshes.values()) {
		if (mesh) {
			chunkGroup.remove(mesh);
			mesh.geometry.dispose();
		}
	}
	chunkMeshes.clear();
}
