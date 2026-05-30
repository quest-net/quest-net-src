// Vite module worker -- runs geometry build off the main thread.
//
// Protocol
// --------
// Incoming:  { buildId: number; terrain: VoxelTerrain }
// Outgoing:  {
//              buildId,
//              buckets: Array<{ key, positions, normals, optional colors,
//                optional surfaceDeformStrength, tileHeights,
//                highlightStrengths, indices }>,
//              occupancy: { data, voxelWidth, voxelHeight, voxelLength,
//                worldOrigin{X,Y,Z}, worldSize{X,Y,Z}, voxelSize },
//              fogVolume: same shape as occupancy (volumetric voxel density),
//                or null when the terrain has no fog voxels,
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

	// Build raw buffers + voxel-occupancy snapshot (face-culled, per-bucket)
	// + fog-density volume (volumetric voxels, raymarched by the fog pass).
	const { buckets: bucketMap, occupancy, fogVolume } = buildVoxelTerrainBuffers(
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
			tileHeights:        buf.tileHeights,
			highlightStrengths: buf.highlightStrengths,
			indices:            buf.indices,
		});
		transferList.push(getTransferableBuffer(buf.positions));
		transferList.push(getTransferableBuffer(buf.normals));
		if (buf.colors) transferList.push(getTransferableBuffer(buf.colors));
		if (buf.surfaceDeformStrength) {
			transferList.push(getTransferableBuffer(buf.surfaceDeformStrength));
		}
		transferList.push(getTransferableBuffer(buf.tileHeights));
		transferList.push(getTransferableBuffer(buf.highlightStrengths));
		transferList.push(getTransferableBuffer(buf.indices));
	}

	transferList.push(getTransferableBuffer(occupancy.data));
	if (fogVolume) transferList.push(getTransferableBuffer(fogVolume.data));

	(self as unknown as Worker).postMessage(
		{ buildId, buckets, occupancy, fogVolume },
		transferList
	);
};
