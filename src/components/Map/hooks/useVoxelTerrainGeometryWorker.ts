import { useEffect, useState } from "react";
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { getVoxelCount } from "../../../utils/VoxelDataUtils";
import { getVoxelTerrainResolution } from "../../../utils/VoxelTerrainUtils";

interface VoxelGeometryWorkerResponse {
	buildId: number;
	positions: Float32Array;
	normals: Float32Array;
	colors: Float32Array;
	indices: Uint32Array;
	bvhRoots: ArrayBuffer[];
	bvhVersion: number;
}

type RuntimeSerializedBVH = Parameters<typeof MeshBVH.deserialize>[0] & {
	version: number;
	indirectBuffer: ArrayBufferView | null;
};

export interface VoxelTerrainGeometryResult {
	geometry: THREE.BufferGeometry;
	width: number;
	length: number;
	height: number;
}

type TerrainGeometrySubscriber = (result: VoxelTerrainGeometryResult) => void;

interface VoxelTerrainGeometryCacheEntry {
	signature: string;
	result: VoxelTerrainGeometryResult | null;
	worker: Worker | null;
	subscribers: Set<TerrainGeometrySubscriber>;
	retainCount: number;
	releaseTimer: ReturnType<typeof setTimeout> | null;
	lastUsedAt: number;
}

const GEOMETRY_CACHE_IDLE_MS = 120_000;
const GEOMETRY_CACHE_MAX_ENTRIES = 3;
const terrainGeometryCache = new Map<string, VoxelTerrainGeometryCacheEntry>();

function disposeGeometryResult(result: VoxelTerrainGeometryResult): void {
	result.geometry.boundsTree = undefined;
	result.geometry.dispose();
}

function disposeCacheEntry(entry: VoxelTerrainGeometryCacheEntry): void {
	if (entry.releaseTimer) {
		clearTimeout(entry.releaseTimer);
		entry.releaseTimer = null;
	}
	entry.worker?.terminate();
	entry.worker = null;
	if (entry.result) {
		disposeGeometryResult(entry.result);
		entry.result = null;
	}
	entry.subscribers.clear();
}

function trimGeometryCache(): void {
	const disposableEntries = Array.from(terrainGeometryCache.values())
		.filter((entry) => entry.retainCount === 0)
		.sort((a, b) => a.lastUsedAt - b.lastUsedAt);

	while (terrainGeometryCache.size > GEOMETRY_CACHE_MAX_ENTRIES) {
		const entry = disposableEntries.shift();
		if (!entry) return;

		terrainGeometryCache.delete(entry.signature);
		disposeCacheEntry(entry);
	}
}

function scheduleCacheRelease(entry: VoxelTerrainGeometryCacheEntry): void {
	if (entry.retainCount > 0 || entry.releaseTimer) return;

	entry.lastUsedAt = Date.now();
	entry.releaseTimer = setTimeout(() => {
		if (entry.retainCount > 0) return;
		if (terrainGeometryCache.get(entry.signature) !== entry) return;

		terrainGeometryCache.delete(entry.signature);
		disposeCacheEntry(entry);
	}, GEOMETRY_CACHE_IDLE_MS);
}

function retainCacheEntry(entry: VoxelTerrainGeometryCacheEntry): void {
	entry.retainCount++;
	entry.lastUsedAt = Date.now();
	if (entry.releaseTimer) {
		clearTimeout(entry.releaseTimer);
		entry.releaseTimer = null;
	}
}

function releaseCacheEntry(entry: VoxelTerrainGeometryCacheEntry): void {
	entry.retainCount = Math.max(0, entry.retainCount - 1);
	if (entry.retainCount === 0) {
		scheduleCacheRelease(entry);
		trimGeometryCache();
	}
}

export function createTerrainSignature(terrain?: VoxelTerrain | null): string {
	if (!terrain) return "none";

	return [
		terrain.Id,
		terrain.Width,
		terrain.Length,
		terrain.Height,
		getVoxelTerrainResolution(terrain),
		terrain.Voxels,
	].join(":");
}

function createGeometryFromWorkerResponse(
	data: VoxelGeometryWorkerResponse
): THREE.BufferGeometry {
	const {
		positions,
		normals,
		colors,
		indices,
		bvhRoots,
		bvhVersion,
	} = data;

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
	geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
	geometry.setIndex(new THREE.BufferAttribute(indices, 1));
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();

	const serializedBvh: RuntimeSerializedBVH = {
		version: bvhVersion,
		roots: bvhRoots,
		index: indices,
		indirectBuffer: null,
	};
	geometry.boundsTree = MeshBVH.deserialize(serializedBvh, geometry, {
		setIndex: false,
	});

	return geometry;
}

function startGeometryBuild(
	entry: VoxelTerrainGeometryCacheEntry,
	terrain: VoxelTerrain
): void {
	const worker = new Worker(
		new URL("../../../utils/voxelGeometryWorker.ts", import.meta.url),
		{ type: "module" }
	);
	const buildId = 1;
	const width = terrain.Width;
	const length = terrain.Length;
	const height = terrain.Height;

	const onMessage = (event: MessageEvent<VoxelGeometryWorkerResponse>) => {
		if (event.data.buildId !== buildId) return;
		if (entry.worker !== worker) return;
		worker.removeEventListener("message", onMessage);
		worker.terminate();
		entry.worker = null;

		const geometry = createGeometryFromWorkerResponse(event.data);
		entry.result = {
			geometry,
			width,
			length,
			height,
		};
		entry.lastUsedAt = Date.now();

		for (const subscriber of entry.subscribers) {
			subscriber(entry.result);
		}

		if (entry.retainCount === 0) {
			scheduleCacheRelease(entry);
		}
	};

	worker.addEventListener("message", onMessage);
	entry.worker = worker;
	worker.postMessage({ buildId, terrain });
}

function getOrCreateCacheEntry(
	terrain: VoxelTerrain,
	terrainSignature: string
): VoxelTerrainGeometryCacheEntry {
	const existing = terrainGeometryCache.get(terrainSignature);
	if (existing) return existing;

	const entry: VoxelTerrainGeometryCacheEntry = {
		signature: terrainSignature,
		result: null,
		worker: null,
		subscribers: new Set(),
		retainCount: 0,
		releaseTimer: null,
		lastUsedAt: Date.now(),
	};
	terrainGeometryCache.set(terrainSignature, entry);
	startGeometryBuild(entry, terrain);
	return entry;
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

		const entry = getOrCreateCacheEntry(terrain, terrainSignature);
		retainCacheEntry(entry);
		trimGeometryCache();

		if (entry.result) {
			setResult(entry.result);
		} else {
			setResult(null);
		}

		const onResult = (nextResult: VoxelTerrainGeometryResult) => {
			setResult(nextResult);
		};
		entry.subscribers.add(onResult);

		return () => {
			entry.subscribers.delete(onResult);
			releaseCacheEntry(entry);
		};
		// terrain is intentionally represented by terrainSignature; peers can
		// replace the terrain object without changing its voxel content.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabled, terrainSignature]);

	return result;
}
