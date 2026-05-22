// Vite module worker -- runs geometry build off the main thread.
//
// Protocol
// --------
// Incoming:  { buildId: number; terrain: VoxelTerrain }
// Outgoing:  { buildId, positions, normals, colors, tileCoords, tileHeights,
//              highlightStrengths, indices }
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

	// Build raw buffers (face-culled, AO-baked, quad-flipped).
	const buf = buildVoxelTerrainBuffers(
		terrain,
		(voxel) =>
			new THREE.Color(
				terrainPaletteIndexToVoxelColor(normalizeVoxelPaletteIndex(voxel.color))
			),
		{ transferSafe: true }
	);

	const transferList: Transferable[] = [
		getTransferableBuffer(buf.positions),
		getTransferableBuffer(buf.normals),
		getTransferableBuffer(buf.colors),
		getTransferableBuffer(buf.tileCoords),
		getTransferableBuffer(buf.tileHeights),
		getTransferableBuffer(buf.highlightStrengths),
		getTransferableBuffer(buf.materialSlots),
		getTransferableBuffer(buf.indices),
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
			materialSlots:      buf.materialSlots,
			indices:            buf.indices,
		},
		transferList
	);
};
