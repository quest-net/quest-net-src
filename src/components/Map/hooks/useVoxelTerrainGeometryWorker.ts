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
		tileCoords,
		tileHeights,
		highlightStrengths,
		indices,
		bvhRoots,
		bvhVersion,
	} = data;

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
	geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
	geometry.setAttribute("tileCoord", new THREE.BufferAttribute(tileCoords, 2));
	geometry.setAttribute("tileHeight", new THREE.BufferAttribute(tileHeights, 1));
	geometry.setAttribute(
		"highlightStrength",
		new THREE.BufferAttribute(highlightStrengths, 1)
	);
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
