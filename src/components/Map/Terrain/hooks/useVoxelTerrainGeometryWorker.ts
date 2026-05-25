import { useEffect, useState } from "react";
import * as THREE from "three";
import type { VoxelTerrain } from "../../../../domains/VoxelTerrain/VoxelTerrain";
import { getVoxelCount } from "../../../../utils/terrain/data/VoxelDataUtils";
import { createVoxelTerrainBufferGeometry } from "../geometry/VoxelTerrainGeometryUtils";
import type { VoxelTerrainOccupancy } from "../geometry/VoxelTerrainGeometryUtils";
import { createTerrainRevision } from "../../../../utils/terrain/data/VoxelTerrainIndex";

// ---------------------------------------------------------------------------
// Worker protocol types
// ---------------------------------------------------------------------------

interface BucketBufferEntry {
	key: string;
	positions: Float32Array;
	normals: Float32Array;
	colors: Float32Array;
	surfaceDeformStrength: Float32Array;
	tileCoords: Float32Array;
	tileHeights: Float32Array;
	highlightStrengths: Float32Array;
	indices: Uint32Array;
}

interface VoxelGeometryWorkerResponse {
	buildId: number;
	buckets: BucketBufferEntry[];
	occupancy: VoxelTerrainOccupancy;
}

// ---------------------------------------------------------------------------
// Cache types -- keyed by terrain signature, value is the per-bucket payload
// plus the voxel-occupancy snapshot used by the per-fragment AO shader.
// ---------------------------------------------------------------------------

interface BucketBufferPayload {
	positions: Float32Array;
	normals: Float32Array;
	colors: Float32Array;
	surfaceDeformStrength: Float32Array;
	tileCoords: Float32Array;
	tileHeights: Float32Array;
	highlightStrengths: Float32Array;
	indices: Uint32Array;
}

interface VoxelGeometryBufferPayload {
	buckets: Map<string, BucketBufferPayload>;
	occupancy: VoxelTerrainOccupancy;
}

// ---------------------------------------------------------------------------
// Public result shape
// ---------------------------------------------------------------------------

export interface VoxelTerrainGeometryResult {
	/** One THREE.BufferGeometry per material bucket (at minimum 'default'). */
	buckets: Map<string, THREE.BufferGeometry>;
	/** Voxel-occupancy snapshot used to build the per-fragment AO sampler. */
	occupancy: VoxelTerrainOccupancy;
	width: number;
	length: number;
	height: number;
}

const GEOMETRY_BUFFER_CACHE_LIMIT = 4;
const geometryBufferCache = new Map<string, VoxelGeometryBufferPayload>();

/**
 * Back-compat alias: `createTerrainRevision` is the canonical name (lives in
 * VoxelTerrainIndex). Keep the old name re-exported so existing call sites
 * (3DMap, FirstPersonMap, FirstPerson/terrain.ts) don't churn.
 */
export const createTerrainSignature = createTerrainRevision;

function getCachedGeometryBuffers(
	terrainSignature: string
): VoxelGeometryBufferPayload | null {
	const cached = geometryBufferCache.get(terrainSignature);
	if (!cached) return null;
	// LRU: move to end on access.
	geometryBufferCache.delete(terrainSignature);
	geometryBufferCache.set(terrainSignature, cached);
	return cached;
}

function cacheGeometryBuffers(
	terrainSignature: string,
	payload: VoxelGeometryBufferPayload
): void {
	geometryBufferCache.set(terrainSignature, payload);
	while (geometryBufferCache.size > GEOMETRY_BUFFER_CACHE_LIMIT) {
		const oldest = geometryBufferCache.keys().next().value;
		if (oldest === undefined) break;
		geometryBufferCache.delete(oldest);
	}
}

function payloadFromWorkerResponse(
	data: VoxelGeometryWorkerResponse
): VoxelGeometryBufferPayload {
	const map = new Map<string, BucketBufferPayload>();
	for (const entry of data.buckets) {
		const { key, ...buffers } = entry;
		map.set(key, buffers);
	}
	return { buckets: map, occupancy: data.occupancy };
}

function createGeometryFromPayload(
	payload: VoxelGeometryBufferPayload
): Map<string, THREE.BufferGeometry> {
	const result = new Map<string, THREE.BufferGeometry>();
	for (const [key, buffers] of payload.buckets) {
		result.set(key, createVoxelTerrainBufferGeometry(buffers));
	}
	return result;
}

export function useVoxelTerrainGeometryWorker(
	terrain: VoxelTerrain | null | undefined,
	terrainSignature: string,
	enabled: boolean
): VoxelTerrainGeometryResult | null {
	const [result, setResult] = useState<VoxelTerrainGeometryResult | null>(null);

	useEffect(() => {
		if (!enabled) {
			setResult(null);
			return;
		}

		if (!terrain || getVoxelCount(terrain.Voxels) === 0) {
			setResult(null);
			return;
		}

		const width = terrain.Width;
		const length = terrain.Length;
		const height = terrain.Height;
		const cachedPayload = getCachedGeometryBuffers(terrainSignature);
		if (cachedPayload) {
			setResult({
				buckets: createGeometryFromPayload(cachedPayload),
				occupancy: cachedPayload.occupancy,
				width,
				length,
				height,
			});
			return;
		}

		const worker = new Worker(
			new URL("../geometry/voxelGeometryWorker.ts", import.meta.url),
			{ type: "module" }
		);
		const buildId = 1;

		const onMessage = (event: MessageEvent<VoxelGeometryWorkerResponse>) => {
			if (event.data.buildId !== buildId) return;
			worker.removeEventListener("message", onMessage);
			worker.terminate();

			const payload = payloadFromWorkerResponse(event.data);
			cacheGeometryBuffers(terrainSignature, payload);
			setResult({
				buckets: createGeometryFromPayload(payload),
				occupancy: payload.occupancy,
				width,
				length,
				height,
			});
		};

		worker.addEventListener("message", onMessage);
		worker.postMessage({ buildId, terrain });

		return () => {
			worker.terminate();
		};
		// terrain is intentionally represented by terrainSignature; peers can
		// replace the terrain object without changing its voxel content.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabled, terrainSignature]);

	return result;
}
