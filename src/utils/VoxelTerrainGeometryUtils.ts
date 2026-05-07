import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Voxel, VoxelTerrain } from '../domains/VoxelTerrain/VoxelTerrain';
import {
	getVoxelSize,
	getVoxelTerrainResolution,
} from './VoxelTerrainUtils';
import { VOXEL_FACE_DEFINITIONS } from './VoxelTerrainGeometryConstants';
import { decodeVoxels } from './VoxelDataUtils';

type VoxelColorFactory = (voxel: Voxel, isTopFace: boolean) => THREE.Color;

function voxelKey(x: number, y: number, z: number): number {
	return x + y * 256 + z * 65536;
}

export function createVoxelTerrainGeometry(
	terrain: VoxelTerrain,
	createVoxelColor: VoxelColorFactory
): THREE.BufferGeometry {
	const positions: number[] = [];
	const normals: number[] = [];
	const colors: number[] = [];
	const tileCoords: number[] = [];
	const highlightStrengths: number[] = [];
	const indices: number[] = [];
	const voxelSize = getVoxelSize(terrain);
	const halfVoxelSize = voxelSize / 2;
	const resolution = getVoxelTerrainResolution(terrain);
	const voxels = Array.from(decodeVoxels(terrain.Voxels));

	const occupied = new Set<number>();
	for (const voxel of voxels) {
		occupied.add(voxelKey(voxel.x, voxel.y, voxel.z));
	}

	for (const voxel of voxels) {
		const tileX = Math.floor(voxel.x / resolution);
		const tileY = Math.floor(voxel.z / resolution);
		const centerX = voxel.x / resolution - terrain.Width / 2 + halfVoxelSize;
		const centerY = (voxel.y + 0.5) / resolution - 0.5;
		const centerZ = voxel.z / resolution - terrain.Length / 2 + halfVoxelSize;

		for (const face of VOXEL_FACE_DEFINITIONS) {
			const [dx, dy, dz] = face.neighborOffset;
			if (occupied.has(voxelKey(voxel.x + dx, voxel.y + dy, voxel.z + dz))) continue;

			const isTopFace = face.normal[1] > 0.5;
			const color = createVoxelColor(voxel, isTopFace);
			const vertexIndex = positions.length / 3;
			for (const [cx, cy, cz] of face.corners) {
				positions.push(
					centerX + cx * voxelSize,
					centerY + cy * voxelSize,
					centerZ + cz * voxelSize
				);
				normals.push(...face.normal);
				colors.push(color.r, color.g, color.b);
				tileCoords.push(tileX, tileY);
				highlightStrengths.push(face.normal[1] > 0.5 ? 1 : 0.28);
			}

			indices.push(
				vertexIndex,
				vertexIndex + 1,
				vertexIndex + 2,
				vertexIndex,
				vertexIndex + 2,
				vertexIndex + 3
			);
		}
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
	geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
	geometry.setAttribute('tileCoord', new THREE.Float32BufferAttribute(tileCoords, 2));
	geometry.setAttribute('highlightStrength', new THREE.Float32BufferAttribute(highlightStrengths, 1));
	geometry.setIndex(indices);
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	geometry.boundsTree = new MeshBVH(geometry);

	return geometry;
}
