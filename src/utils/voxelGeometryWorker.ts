// Vite module worker -- runs geometry build + BVH construction off the main thread.
//
// Protocol
// --------
// Incoming:  { buildId: number; terrain: VoxelTerrain }
// Outgoing:  { buildId, positions, normals, colors, tileCoords, tileHeights,
//              highlightStrengths, indices, bvhRoots, bvhVersion }
//            All TypedArray/ArrayBuffer values are transferred (zero-copy).
//
// The main thread reconstructs THREE.BufferGeometry from the transferred arrays
// and calls MeshBVH.deserialize({ roots, version, index: indices }, geometry, { setIndex: false })
// to avoid a redundant BVH rebuild on the main thread.

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { VoxelTerrain } from '../domains/VoxelTerrain/VoxelTerrain';
import { buildVoxelTerrainBuffers } from './VoxelTerrainGeometryUtils';
import {
	normalizeVoxelPaletteIndex,
	terrainPaletteIndexToVoxelColor,
} from './VoxelTerrainEditorUtils';

type RuntimeSerializedBVH = ReturnType<typeof MeshBVH.serialize> & {
	version: number;
	indirectBuffer: ArrayBufferView | null;
};

function getTransferableBuffer(view: ArrayBufferView): ArrayBuffer {
	const { buffer } = view;
	if (buffer instanceof ArrayBuffer) return buffer;
	throw new Error('Cannot transfer SharedArrayBuffer-backed voxel geometry buffers.');
}

self.onmessage = (event: MessageEvent<{ buildId: number; terrain: VoxelTerrain }>) => {
	const { buildId, terrain } = event.data;

	// Build raw buffers (face-culled, AO-baked, quad-flipped).
	const buf = buildVoxelTerrainBuffers(terrain, (voxel) =>
		new THREE.Color(
			terrainPaletteIndexToVoxelColor(normalizeVoxelPaletteIndex(voxel.color))
		)
	);

	// Build BVH. Only position + index are needed for tree construction.
	const bvhGeometry = new THREE.BufferGeometry();
	bvhGeometry.setAttribute(
		'position',
		new THREE.BufferAttribute(buf.positions, 3)
	);
	bvhGeometry.setIndex(new THREE.BufferAttribute(buf.indices, 1));
	const bvh = new MeshBVH(bvhGeometry);

	// Serialize BVH roots as transferable ArrayBuffers without cloning.
	// The index is already in buf.indices; we don't need to re-transfer it
	// via the serialized form.
	const serialized = MeshBVH.serialize(bvh, { cloneBuffers: false }) as RuntimeSerializedBVH;

	// Collect all transferable ArrayBuffers.
	// Note: buf arrays were produced by .slice() in buildVoxelTerrainBuffers,
	// so each has its own backing buffer of exactly the right size.
	const transferList: Transferable[] = [
		getTransferableBuffer(buf.positions),
		getTransferableBuffer(buf.normals),
		getTransferableBuffer(buf.colors),
		getTransferableBuffer(buf.tileCoords),
		getTransferableBuffer(buf.tileHeights),
		getTransferableBuffer(buf.highlightStrengths),
		getTransferableBuffer(buf.indices),
		...serialized.roots,
	];

	(self as unknown as Worker).postMessage(
		{
			buildId,
			positions:          buf.positions,
			normals:            buf.normals,
			colors:             buf.colors,
			tileCoords:         buf.tileCoords,
			tileHeights:        buf.tileHeights,
			highlightStrengths: buf.highlightStrengths,
			indices:            buf.indices,
			bvhRoots:           serialized.roots,
			bvhVersion:         serialized.version,
		},
		transferList
	);
};
