// src/utils/terrain/data/VoxelDataUtils.ts
//
// Encodes voxel terrain data as a base64-encoded Sparse Voxel Octree (SVO).
// Voxel positions are implicit in the tree structure; colors are stored in a
// separate traversal-order byte stream.

import type { Voxel } from "../../../domains/VoxelTerrain/VoxelTerrain";
import {
	decode as decodeVoxelSVO,
	encode as encodeVoxelSVO,
	getVoxelCount as getSvoVoxelCount,
} from "./VoxelSVOCodec";

const BASE64_CHUNK_SIZE = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
	if (bytes.length === 0) return "";

	let binary = "";
	for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
		const chunk = bytes.subarray(i, i + BASE64_CHUNK_SIZE);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
	if (!encoded) return new Uint8Array(0);

	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function packPosition(x: number, y: number, z: number): number {
	return x + y * 256 + z * 65536;
}

function unpackVoxel(position: number, color: number): Voxel {
	return {
		x: position & 0xff,
		y: (position >>> 8) & 0xff,
		z: (position >>> 16) & 0xff,
		color,
	};
}

// --- Public API -------------------------------------------------------------

/**
 * Encodes an iterable of voxels into a compact base64 SVO string.
 * When two voxels share a position the last one wins.
 */
export function encodeVoxels(voxels: Iterable<Voxel>): string {
	const positionMap = new Map<number, number>(); // position -> color
	for (const voxel of voxels) {
		positionMap.set(
			packPosition(voxel.x, voxel.y, voxel.z),
			voxel.color & 0xff
		);
	}

	if (positionMap.size === 0) return "";

	const positions = new Uint32Array(positionMap.size);
	const colors = new Uint8Array(positionMap.size);
	let index = 0;
	for (const [position, color] of positionMap) {
		positions[index] = position;
		colors[index] = color;
		index++;
	}

	return bytesToBase64(encodeVoxelSVO(positions, colors));
}

/** Decodes a voxel set, yielding one Voxel per stored entry. */
export function* decodeVoxels(encoded: string): Generator<Voxel> {
	const decoded = decodeVoxelSVO(base64ToBytes(encoded));
	for (let i = 0; i < decoded.positions.length; i++) {
		yield unpackVoxel(decoded.positions[i], decoded.colors[i]);
	}
}

/** Returns the number of voxels in the encoded set. O(1). */
export function getVoxelCount(encoded: string): number {
	return getSvoVoxelCount(base64ToBytes(encoded));
}
