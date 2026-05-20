import { useEffect, useState } from "react";
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { getVoxelCount } from "../../../utils/VoxelDataUtils";
import { createVoxelTerrainBufferGeometry } from "../../../utils/VoxelTerrainGeometryUtils";
import { createTerrainRevision } from "../../../utils/VoxelTerrainIndex";

interface VoxelGeometryWorkerResponse {
	buildId: number;
	positions: Float32Array;
	normals: Float32Array;
	colors: Float32Array;
	tileCoords: Float32Array;
	tileHeights: Float32Array;
	highlightStrengths: Float32Array;
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

/**
 * Back-compat alias: `createTerrainRevision` is the canonical name (lives in
 * VoxelTerrainIndex). Keep the old name re-exported so existing call sites
 * (3DMap, FirstPersonMap, FirstPerson/terrain.ts) don't churn.
 */
export const createTerrainSignature = createTerrainRevision;

function createGeometryFromWorkerResponse(
	data: VoxelGeometryWorkerResponse
): THREE.BufferGeometry {
	const geometry = createVoxelTerrainBufferGeometry({
		positions:          data.positions,
		normals:            data.normals,
		colors:             data.colors,
		tileCoords:         data.tileCoords,
		tileHeights:        data.tileHeights,
		highlightStrengths: data.highlightStrengths,
		indices:            data.indices,
	});

	const serializedBvh: RuntimeSerializedBVH = {
		version: data.bvhVersion,
		roots: data.bvhRoots,
		index: data.indices,
		indirectBuffer: null,
	};
	geometry.boundsTree = MeshBVH.deserialize(serializedBvh, geometry, {
		setIndex: false,
	});

	return geometry;
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
			worker.removeEventListener("message", onMessage);
			worker.terminate();

			const geometry = createGeometryFromWorkerResponse(event.data);
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
