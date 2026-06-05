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
//            On failure: { buildId, error: string }
//
// The greedy mesh runs in the WASM kernel (wasm/voxel-mesher). The kernel also
// decodes the SVO (build_from_svo), so this worker just hands it the raw SVO
// bytes and reshapes its output into the message above.

import * as THREE from 'three';
import type { VoxelTerrain } from '../../../../domains/VoxelTerrain/VoxelTerrain';
import type { VoxelTerrainOccupancy } from './VoxelTerrainGeometryUtils';
import { MATERIAL_LOOKUP } from '../materials';
import { base64ToBytes } from '../../../../utils/base64';
import { getVoxelTerrainResolution } from '../../../../utils/terrain/data/VoxelTerrainIndex';
import {
	normalizeVoxelPaletteIndex,
	terrainPaletteIndexToVoxelColor,
} from '../../../../utils/terrain/editor/VoxelTerrainEditorUtils';
// Type-only import (erased at runtime). The actual module is loaded lazily via
// dynamic import below so the worker has NO top-level await -- see getMesher().
import type { VoxelMesher as VoxelMesherType } from '../../../../../wasm/voxel-mesher/pkg/voxel_mesher.js';

const BUCKET_KEY_BY_ID = MATERIAL_LOOKUP.bucketKeyById;

// ---------------------------------------------------------------------------
// Lazily import + construct the WASM mesher on first build, then reuse it.
//
// A dynamic import (not a top-level one) keeps the worker free of top-level
// await: the message handler registers synchronously and any init failure is
// caught and logged rather than leaving the worker module hung on an
// unresolved import (which manifests as a silent perpetual loading screen).
//
// RGB table: the kernel can't call THREE.Color, so we precompute the 256-entry
// vertex-color table here exactly as the TS factory did -- constructing a real
// THREE.Color per palette index so color management / linearization matches
// bit-for-bit.
// ---------------------------------------------------------------------------
let mesherPromise: Promise<VoxelMesherType> | null = null;
function getMesher(): Promise<VoxelMesherType> {
	if (!mesherPromise) {
		const pendingMesher = (async () => {
			const { VoxelMesher } = await import(
				'../../../../../wasm/voxel-mesher/pkg/voxel_mesher.js'
			);
			const rgb = new Float32Array(256 * 3);
			for (let i = 0; i < 256; i++) {
				const c = new THREE.Color(
					terrainPaletteIndexToVoxelColor(normalizeVoxelPaletteIndex(i))
				);
				rgb[i * 3] = c.r;
				rgb[i * 3 + 1] = c.g;
				rgb[i * 3 + 2] = c.b;
			}
			return new VoxelMesher(
				MATERIAL_LOOKUP.bucketId,
				MATERIAL_LOOKUP.occlusionId,
				MATERIAL_LOOKUP.usesVertexColors,
				MATERIAL_LOOKUP.deformsSurface,
				MATERIAL_LOOKUP.preservesVoxelFaces,
				MATERIAL_LOOKUP.isVolumetric,
				rgb
			);
		})();
		mesherPromise = pendingMesher.catch((error) => {
			// Allow an explicit UI retry after a transient asset-loading failure.
			mesherPromise = null;
			throw error;
		});
	}
	return mesherPromise;
}

interface BucketMessageEntry {
	key: string;
	positions: Float32Array;
	normals: Float32Array;
	colors?: Float32Array;
	surfaceDeformStrength?: Float32Array;
	tileHeights: Float32Array;
	highlightStrengths: Float32Array;
	indices: Uint32Array;
}

function getTransferableBuffer(view: ArrayBufferView): ArrayBuffer {
	const { buffer } = view;
	if (buffer instanceof ArrayBuffer) return buffer;
	throw new Error('Cannot transfer SharedArrayBuffer-backed voxel geometry buffers.');
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function postBuildError(buildId: number, phase: string, error: unknown): void {
	(self as unknown as Worker).postMessage({
		buildId,
		error: `Failed to ${phase}: ${getErrorMessage(error)}`,
	});
}

self.onmessage = async (
	event: MessageEvent<{ buildId: number; terrain: VoxelTerrain; voxels: string }>
) => {
	const { buildId, terrain, voxels } = event.data;

	let mesher: VoxelMesherType;
	try {
		mesher = await getMesher();
	} catch (e) {
		console.error('[voxel-build] WASM mesher init FAILED:', e);
		postBuildError(buildId, 'initialize the WebAssembly terrain mesher', e);
		return;
	}

	try {
		buildAndPost(mesher, buildId, terrain, voxels);
	} catch (e) {
		console.error('[voxel-build] WASM build FAILED:', e);
		postBuildError(buildId, 'build the terrain geometry', e);
	}
};

function buildAndPost(
	mesher: VoxelMesherType,
	buildId: number,
	terrain: VoxelTerrain,
	voxels: string
): void {
	const resolution = getVoxelTerrainResolution(terrain);

	// Fused decode + mesh: the SVO is decoded inside WASM (build_from_svo), so
	// the positions/colors arrays never cross the JS<->WASM boundary on this
	// gameplay build path.
	const build = mesher.build_from_svo(
		base64ToBytes(voxels),
		terrain.Width,
		terrain.Height,
		terrain.Length,
		resolution
	);

	// Reshape the kernel output into the worker message + transfer list. Each
	// take_*() returns a fresh transferable typed array copied out of WASM memory.
	const buckets: BucketMessageEntry[] = [];
	const transferList: Transferable[] = [];
	let occupancyData: Uint8Array;
	let fogData: Uint8Array | null;
	try {
		const bucketCount = build.bucket_count();
		for (let i = 0; i < bucketCount; i++) {
			const key = BUCKET_KEY_BY_ID[build.bucket_id(i)];
			const positionsB = build.take_positions(i);
			const normalsB = build.take_normals(i);
			const colorsB = build.take_colors(i);
			const surfaceDeformB = build.take_surface_deform(i);
			const tileHeightsB = build.take_tile_heights(i);
			const highlightsB = build.take_highlights(i);
			const indicesB = build.take_indices(i);

			buckets.push({
				key,
				positions: positionsB,
				normals: normalsB,
				colors: colorsB,
				surfaceDeformStrength: surfaceDeformB,
				tileHeights: tileHeightsB,
				highlightStrengths: highlightsB,
				indices: indicesB,
			});

			transferList.push(getTransferableBuffer(positionsB));
			transferList.push(getTransferableBuffer(normalsB));
			if (colorsB) transferList.push(getTransferableBuffer(colorsB));
			if (surfaceDeformB) transferList.push(getTransferableBuffer(surfaceDeformB));
			transferList.push(getTransferableBuffer(tileHeightsB));
			transferList.push(getTransferableBuffer(highlightsB));
			transferList.push(getTransferableBuffer(indicesB));
		}

		occupancyData = build.take_occupancy();
		fogData = build.take_fog() ?? null;
	} finally {
		build.free();
	}

	// Occupancy/fog world bounds are pure terrain math -- compute them here so
	// the kernel only has to return the byte volumes.
	const voxelWidth = terrain.Width * resolution;
	const voxelHeight = terrain.Height * resolution;
	const voxelLength = terrain.Length * resolution;
	const worldBounds = {
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
	} as const;

	const occupancy: VoxelTerrainOccupancy = { data: occupancyData, ...worldBounds };
	const fogVolume: VoxelTerrainOccupancy | null = fogData
		? { data: fogData, ...worldBounds }
		: null;

	transferList.push(getTransferableBuffer(occupancy.data));
	if (fogVolume) transferList.push(getTransferableBuffer(fogVolume.data));

	(self as unknown as Worker).postMessage(
		{ buildId, buckets, occupancy, fogVolume },
		transferList
	);
}
