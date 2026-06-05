import { useCallback, useEffect, useState } from "react";
import * as THREE from "three";
import type { VoxelTerrain } from "../../../../domains/VoxelTerrain/VoxelTerrain";
import { getVoxelCount } from "../../../../utils/terrain/data/VoxelDataUtils";
import { resolveTerrainVoxels } from "../../../../utils/terrain/data/terrainPayloadStore";
import { createVoxelTerrainBufferGeometry } from "../geometry/VoxelTerrainGeometryUtils";
import type {
	VoxelTerrainFogVolume,
	VoxelTerrainOccupancy,
} from "../geometry/VoxelTerrainGeometryUtils";
import { createTerrainRevision } from "../../../../utils/terrain/data/VoxelTerrainIndex";

// ---------------------------------------------------------------------------
// Worker protocol types
// ---------------------------------------------------------------------------

interface BucketBufferEntry {
	key: string;
	positions: Float32Array;
	normals: Float32Array;
	colors?: Float32Array;
	surfaceDeformStrength?: Float32Array;
	tileHeights: Float32Array;
	highlightStrengths: Float32Array;
	indices: Uint32Array;
}

interface VoxelGeometryWorkerResponse {
	buildId: number;
	buckets: BucketBufferEntry[];
	occupancy: VoxelTerrainOccupancy;
	fogVolume: VoxelTerrainFogVolume | null;
}

interface VoxelGeometryWorkerErrorResponse {
	buildId: number;
	error: string;
}

type VoxelGeometryWorkerMessage =
	| VoxelGeometryWorkerResponse
	| VoxelGeometryWorkerErrorResponse;

// ---------------------------------------------------------------------------
// Cache types -- keyed by terrain signature, value is the per-bucket payload
// plus the voxel-occupancy snapshot used by the per-fragment AO shader.
// ---------------------------------------------------------------------------

interface BucketBufferPayload {
	positions: Float32Array;
	normals: Float32Array;
	colors?: Float32Array;
	surfaceDeformStrength?: Float32Array;
	tileHeights: Float32Array;
	highlightStrengths: Float32Array;
	indices: Uint32Array;
}

interface VoxelGeometryBufferPayload {
	buckets: Map<string, BucketBufferPayload>;
	occupancy: VoxelTerrainOccupancy;
	fogVolume: VoxelTerrainFogVolume | null;
}

// ---------------------------------------------------------------------------
// Public result shape
// ---------------------------------------------------------------------------

export interface VoxelTerrainGeometryResult {
	/** One THREE.BufferGeometry per material bucket (at minimum 'default'). */
	buckets: Map<string, THREE.BufferGeometry>;
	/** Voxel-occupancy snapshot used to build the per-fragment AO sampler. */
	occupancy: VoxelTerrainOccupancy;
	/** Fog-density volume for the volumetric pass, or null if no fog voxels. */
	fogVolume: VoxelTerrainFogVolume | null;
	width: number;
	length: number;
	height: number;
}

export interface VoxelTerrainGeometryWorkerResult {
	geometry: VoxelTerrainGeometryResult | null;
	error: string | null;
	retry: () => void;
}

const GEOMETRY_BUFFER_CACHE_LIMIT = 4;
const geometryBufferCache = new Map<string, VoxelGeometryBufferPayload>();

/**
 * Back-compat alias: `createTerrainRevision` is the canonical name (lives in
 * VoxelTerrainIndex). Keep the old name re-exported so existing call sites
 * (MapScene, FirstPersonView) don't churn.
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
	return { buckets: map, occupancy: data.occupancy, fogVolume: data.fogVolume };
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

// ---------------------------------------------------------------------------
// Persistent geometry worker
//
// One worker for the app lifetime, shared across all terrain builds. Reusing it
// avoids respawning the worker, re-instantiating the WASM module, and rebuilding
// the palette RGB table on every terrain switch (each costs tens to hundreds of
// ms). Builds carry a monotonic id; the worker echoes it back and we dispatch to
// the matching pending handler. A cancelled build (unmount / terrain change)
// just drops its handler -- the worker is never terminated.
// ---------------------------------------------------------------------------
let sharedWorker: Worker | null = null;
const pendingBuildHandlers = new Map<number, (data: VoxelGeometryWorkerMessage) => void>();
let nextBuildId = 1;

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function rejectPendingBuilds(error: string): void {
	for (const [buildId, handler] of pendingBuildHandlers) {
		pendingBuildHandlers.delete(buildId);
		handler({ buildId, error });
	}
}

function resetSharedWorker(worker: Worker, error: string): void {
	if (sharedWorker !== worker) return;
	sharedWorker = null;
	worker.terminate();
	rejectPendingBuilds(error);
}

function getSharedGeometryWorker(): Worker {
	if (sharedWorker) return sharedWorker;
	const worker = new Worker(
		new URL("../geometry/voxelGeometryWorker.ts", import.meta.url),
		{ type: "module" }
	);
	worker.addEventListener("message", (event: MessageEvent<VoxelGeometryWorkerMessage>) => {
		const handler = pendingBuildHandlers.get(event.data.buildId);
		if (!handler) return; // build was cancelled
		pendingBuildHandlers.delete(event.data.buildId);
		handler(event.data);
	});
	// Surface worker failures instead of hanging on the loading screen forever
	// (the geometry build runs in WASM -- a Rust panic or JS error in the worker
	// would otherwise be swallowed).
	worker.addEventListener("error", (event: ErrorEvent) => {
		console.error(
			`[voxel-build] WORKER ERROR: ${event.message} ` +
			`(${event.filename}:${event.lineno}:${event.colno})`,
			event.error
		);
		resetSharedWorker(worker, "The terrain geometry worker stopped unexpectedly.");
	});
	worker.addEventListener("messageerror", (event: MessageEvent) => {
		console.error("[voxel-build] WORKER MESSAGE ERROR (structured-clone failed):", event);
		resetSharedWorker(worker, "The terrain geometry worker returned an unreadable response.");
	});
	sharedWorker = worker;
	return worker;
}

export function useVoxelTerrainGeometryWorker(
	terrain: VoxelTerrain | null | undefined,
	terrainSignature: string,
	enabled: boolean
): VoxelTerrainGeometryWorkerResult {
	const [result, setResult] = useState<VoxelTerrainGeometryResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [retryRevision, setRetryRevision] = useState(0);
	const retry = useCallback(() => {
		setError(null);
		setRetryRevision((revision) => revision + 1);
	}, []);

	useEffect(() => {
		if (!enabled) {
			setResult(null);
			setError(null);
			return;
		}

		const voxels = terrain ? resolveTerrainVoxels(terrain) : "";
		if (!terrain || getVoxelCount(voxels) === 0) {
			setResult(null);
			setError(null);
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
				fogVolume: cachedPayload.fogVolume,
				width,
				length,
				height,
			});
			setError(null);
			return;
		}

		const worker = getSharedGeometryWorker();
		const buildId = nextBuildId++;
		let cancelled = false;
		setError(null);

		pendingBuildHandlers.set(buildId, (data) => {
			if (cancelled) return;
			if ("error" in data) {
				console.error(`[voxel-build] ${data.error}`);
				setError(data.error);
				return;
			}
			try {
				const payload = payloadFromWorkerResponse(data);
				cacheGeometryBuffers(terrainSignature, payload);
				setResult({
					buckets: createGeometryFromPayload(payload),
					occupancy: payload.occupancy,
					fogVolume: payload.fogVolume,
					width,
					length,
					height,
				});
				setError(null);
			} catch (responseError) {
				const message = `Failed to create terrain geometry: ${getErrorMessage(responseError)}`;
				console.error(`[voxel-build] ${message}`);
				setError(message);
			}
		});

		try {
			worker.postMessage({ buildId, terrain, voxels });
		} catch (postError) {
			const handler = pendingBuildHandlers.get(buildId);
			pendingBuildHandlers.delete(buildId);
			handler?.({
				buildId,
				error: `Failed to send terrain geometry to the worker: ${getErrorMessage(postError)}`,
			});
		}

		return () => {
			// Drop this build's handler (ignore any late result) but keep the
			// shared worker alive for future builds.
			cancelled = true;
			pendingBuildHandlers.delete(buildId);
		};
		// terrain is intentionally represented by terrainSignature; peers can
		// replace the terrain object without changing its voxel content.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabled, terrainSignature, retryRevision]);

	return { geometry: result, error, retry };
}
