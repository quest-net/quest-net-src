import { useEffect, useState } from "react";
import * as THREE from "three";
import type { VoxelTerrain } from "../../../../domains/VoxelTerrain/VoxelTerrain";
import { getVoxelCount } from "../../../../utils/terrain/data/VoxelDataUtils";
import { createVoxelTerrainBufferGeometry } from "../geometry/VoxelTerrainGeometryUtils";
import { createTerrainRevision } from "../../../../utils/terrain/data/VoxelTerrainIndex";

interface VoxelGeometryWorkerResponse {
	buildId: number;
	positions: Float32Array;
	normals: Float32Array;
	colors: Float32Array;
	tileCoords: Float32Array;
	tileHeights: Float32Array;
	highlightStrengths: Float32Array;
	indices: Uint32Array;
}

interface VoxelGeometryBufferPayload {
	positions: Float32Array;
	normals: Float32Array;
	colors: Float32Array;
	tileCoords: Float32Array;
	tileHeights: Float32Array;
	highlightStrengths: Float32Array;
	indices: Uint32Array;
}

export interface VoxelTerrainGeometryResult {
	geometry: THREE.BufferGeometry;
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
	return {
		positions:          data.positions,
		normals:            data.normals,
		colors:             data.colors,
		tileCoords:         data.tileCoords,
		tileHeights:        data.tileHeights,
		highlightStrengths: data.highlightStrengths,
		indices:            data.indices,
	};
}

function createGeometryFromPayload(
	payload: VoxelGeometryBufferPayload
): THREE.BufferGeometry {
	return createVoxelTerrainBufferGeometry(payload);
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
				geometry: createGeometryFromPayload(cachedPayload),
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
			const geometry = createGeometryFromPayload(payload);
			setResult({
				geometry,
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
