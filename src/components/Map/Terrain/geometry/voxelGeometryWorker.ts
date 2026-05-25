// Vite module worker -- runs geometry build off the main thread.
//
// Protocol
// --------
// Incoming:  { buildId: number; terrain: VoxelTerrain }
// Outgoing:  {
//              buildId,
//              buckets: Array<{ key, positions, normals, colors,
//                surfaceDeformStrength, tileCoords, tileHeights,
//                highlightStrengths, indices }>,
//              occupancy: { data, voxelWidth, voxelHeight, voxelLength,
//                worldOrigin{X,Y,Z}, worldSize{X,Y,Z}, voxelSize },
//            }
//            All TypedArray/ArrayBuffer values are transferred (zero-copy).

import * as THREE from 'three';
import type { VoxelTerrain } from '../../../../domains/VoxelTerrain/VoxelTerrain';
import { buildVoxelTerrainBuffers } from './VoxelTerrainGeometryUtils';
import {
	normalizeVoxelPaletteIndex,
	terrainPaletteIndexToVoxelColor,
} from '../../../../utils/terrain/editor/VoxelTerrainEditorUtils';

function getTransferableBuffer(view: ArrayBufferView): ArrayBuffer {
	const { buffer } = view;
	if (buffer instanceof ArrayBuffer) return buffer;
	throw new Error('Cannot transfer SharedArrayBuffer-backed voxel geometry buffers.');
}

self.onmessage = (event: MessageEvent<{ buildId: number; terrain: VoxelTerrain }>) => {
	const { buildId, terrain } = event.data;

	// Build raw buffers + voxel-occupancy snapshot (face-culled, per-bucket).
	const { buckets: bucketMap, occupancy } = buildVoxelTerrainBuffers(
		terrain,
		(voxel) =>
			new THREE.Color(
				terrainPaletteIndexToVoxelColor(normalizeVoxelPaletteIndex(voxel.color))
			),
		{ transferSafe: true }
	);

	// Flatten the Map into an array for structured-clone transfer.
	// Collect all ArrayBuffers into the transfer list for zero-copy transfer.
	const buckets = [];
	const transferList: Transferable[] = [];

	for (const [key, buf] of bucketMap) {
		buckets.push({
			key,
			positions:          buf.positions,
			normals:            buf.normals,
			colors:             buf.colors,
			surfaceDeformStrength: buf.surfaceDeformStrength,
			tileCoords:         buf.tileCoords,
			tileHeights:        buf.tileHeights,
			highlightStrengths: buf.highlightStrengths,
			indices:            buf.indices,
		});
		transferList.push(
			getTransferableBuffer(buf.positions),
			getTransferableBuffer(buf.normals),
			getTransferableBuffer(buf.colors),
			getTransferableBuffer(buf.surfaceDeformStrength),
			getTransferableBuffer(buf.tileCoords),
			getTransferableBuffer(buf.tileHeights),
			getTransferableBuffer(buf.highlightStrengths),
			getTransferableBuffer(buf.indices)
		);
	}

	transferList.push(getTransferableBuffer(occupancy.data));

	(self as unknown as Worker).postMessage(
		{ buildId, buckets, occupancy },
		transferList
	);
};
