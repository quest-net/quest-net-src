// Chunked mesh builder for the voxel terrain editor.
//
// Produces one MeshStandardMaterial mesh per dirty chunk with face-culled
// geometry (only faces between a voxel and an empty/out-of-bounds neighbor are
// emitted). Each vertex carries an `isSpecial` flag (0/1) that drives the
// editor's stripe-pattern shader patch (see editorTerrainShader.ts).

import * as THREE from "three";
import { VOXEL_FACE_DEFINITIONS } from "../../Map/Terrain/geometry/VoxelTerrainGeometryConstants";
import { isSpecialPaletteIndex } from "../../Map/Terrain/materials";
import {
	editGridHasVoxelAtIndex,
	editGridIndex,
	type EditGrid,
} from "../../../utils/terrain/editor/EditGridUtils";
import {
	getChunkVoxelBounds,
	type ChunkDims,
} from "../../../utils/terrain/editor/EditGridChunkUtils";
import {
	normalizeVoxelPaletteIndex,
	terrainPaletteIndexToVoxelColor,
} from "../../../utils/terrain/editor/VoxelTerrainEditorUtils";

// Reused across buildChunkGeometry calls to avoid per-voxel Color allocations.
const CHUNK_VOXEL_COLOR = new THREE.Color();

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

	const positions: number[] = [];
	const normals:   number[] = [];
	const colors:    number[] = [];
	// Per-vertex "is this voxel a special material?" flag (0.0 or 1.0). Drives
	// the editor's terrain shader stripe pattern so special materials read as
	// distinct without recreating the full material stack from the main map.
	const specials:  number[] = [];
	const indices:   number[] = [];

	const { startX, startY, startZ, endX, endY, endZ } = getChunkVoxelBounds(
		chunkX, chunkY, chunkZ, dims,
	);

	for (let vy = startY; vy < endY; vy++) {
		for (let vz = startZ; vz < endZ; vz++) {
			for (let vx = startX; vx < endX; vx++) {
				const voxelIndex = editGridIndex(vx, vy, vz, vW, vL);
				if (!editGridHasVoxelAtIndex(grid, voxelIndex)) continue;

				const paletteIndex = normalizeVoxelPaletteIndex(grid.colors[voxelIndex]);
				CHUNK_VOXEL_COLOR.set(terrainPaletteIndexToVoxelColor(paletteIndex));
				const isSpecial = isSpecialPaletteIndex(paletteIndex) ? 1 : 0;

				// Center of this voxel in world space.
				const cx = vx / resolution - halfW + halfVoxelSize;
				const cy = (vy + 0.5) / resolution - 0.5;
				const cz = vz / resolution - halfL + halfVoxelSize;

				for (const face of VOXEL_FACE_DEFINITIONS) {
					const [dnx, dny, dnz] = face.neighborOffset;
					const nx2 = vx + dnx;
					const ny2 = vy + dny;
					const nz2 = vz + dnz;

					// Cull face if neighbor is occupied (or out-of-bounds = no face).
					const neighborOccupied =
						nx2 >= 0 && nx2 < vW && ny2 >= 0 && ny2 < vH && nz2 >= 0 && nz2 < vL &&
						editGridHasVoxelAtIndex(grid, editGridIndex(nx2, ny2, nz2, vW, vL));
					if (neighborOccupied) continue;

					const vertexIndex = positions.length / 3;
					const [fnx, fny, fnz] = face.normal;

					for (const [fcx, fcy, fcz] of face.corners) {
						positions.push(
							cx + fcx * voxelSize,
							cy + fcy * voxelSize,
							cz + fcz * voxelSize,
						);
						normals.push(fnx, fny, fnz);
						colors.push(CHUNK_VOXEL_COLOR.r, CHUNK_VOXEL_COLOR.g, CHUNK_VOXEL_COLOR.b);
						specials.push(isSpecial);
					}

					indices.push(
						vertexIndex,
						vertexIndex + 1,
						vertexIndex + 2,
						vertexIndex,
						vertexIndex + 2,
						vertexIndex + 3,
					);
				}
			}
		}
	}

	if (positions.length === 0) return null;

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position",  new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute("normal",    new THREE.Float32BufferAttribute(normals,   3));
	geometry.setAttribute("color",     new THREE.Float32BufferAttribute(colors,    3));
	geometry.setAttribute("isSpecial", new THREE.Float32BufferAttribute(specials,  1));
	geometry.setIndex(indices);
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
