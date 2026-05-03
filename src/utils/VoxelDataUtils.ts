// src/utils/VoxelDataUtils.ts
//
// Encodes voxel terrain data as a base64-encoded sorted Uint32Array for
// compact localStorage storage (~2.3x smaller than the previous
// Record<string, number> format).
//
// Encoding: each uint32 = (x + y*256 + z*65536) * 256 + color
//   Byte 3 (MSB): z   Byte 2: y   Byte 1: x   Byte 0 (LSB): color
//
// The array is kept sorted in ascending numeric order, which is equivalent
// to sorting voxels by (z, y, x). This enables O(log n) position lookups
// via binary search and guarantees a stable, deterministic encoding.

import type { Voxel } from "../domains/VoxelTerrain/VoxelTerrain";

// --- Internal codec ---------------------------------------------------------

function encodeArray(arr: Uint32Array): string {
	if (arr.length === 0) return "";
	const bytes = new Uint8Array(arr.buffer);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

function decodeArray(encoded: string): Uint32Array {
	if (!encoded) return new Uint32Array(0);
	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return new Uint32Array(bytes.buffer);
}

function unpackValue(value: number): Voxel {
	const position = Math.floor(value / 256);
	return {
		x: position & 0xFF,
		y: (position >>> 8) & 0xFF,
		z: (position >>> 16) & 0xFF,
		color: value & 0xFF,
	};
}

// Returns the index of the voxel at the given position, or the bitwise
// complement of the correct insertion point if not found (~lo).
function binarySearch(arr: Uint32Array, position: number): number {
	let lo = 0;
	let hi = arr.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >>> 1;
		const midPos = Math.floor(arr[mid] / 256);
		if (midPos === position) return mid;
		if (midPos < position) lo = mid + 1;
		else hi = mid - 1;
	}
	return ~lo;
}

// --- Public API -------------------------------------------------------------

/** Returns the canonical empty voxel set. */
export function emptyVoxels(): string {
	return "";
}

/**
 * Encodes an iterable of Voxels into a compact base64 string.
 * When two voxels share a position the last one wins.
 */
export function encodeVoxels(voxels: Iterable<Voxel>): string {
	const positionMap = new Map<number, number>(); // position -> color
	for (const v of voxels) {
		positionMap.set(v.x + v.y * 256 + v.z * 65536, v.color & 0xFF);
	}
	const packed: number[] = [];
	for (const [position, color] of positionMap) {
		packed.push(position * 256 + color);
	}
	packed.sort((a, b) => a - b);
	return encodeArray(new Uint32Array(packed));
}

/** Decodes a voxel set, yielding one Voxel per stored entry. */
export function* decodeVoxels(encoded: string): Generator<Voxel> {
	const arr = decodeArray(encoded);
	for (let i = 0; i < arr.length; i++) {
		yield unpackValue(arr[i]);
	}
}

/** Returns the number of voxels in the encoded set. O(1). */
export function getVoxelCount(encoded: string): number {
	if (!encoded) return 0;
	const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
	return (encoded.length * 3 / 4 - padding) / 4;
}

/**
 * Returns a new voxel set with the given voxel added or updated.
 * If a voxel already exists at (x, y, z) its color is replaced.
 */
export function setVoxel(encoded: string, voxel: Voxel): string {
	const arr = decodeArray(encoded);
	const position = voxel.x + voxel.y * 256 + voxel.z * 65536;
	const packed = position * 256 + (voxel.color & 0xFF);
	const idx = binarySearch(arr, position);

	if (idx >= 0) {
		const newArr = new Uint32Array(arr);
		newArr[idx] = packed;
		return encodeArray(newArr);
	}

	const insertAt = ~idx;
	const newArr = new Uint32Array(arr.length + 1);
	newArr.set(arr.subarray(0, insertAt));
	newArr[insertAt] = packed;
	newArr.set(arr.subarray(insertAt), insertAt + 1);
	return encodeArray(newArr);
}

/**
 * Returns a new voxel set with the voxel at (x, y, z) removed.
 * Returns the original string unchanged if no voxel exists at that position.
 */
export function removeVoxel(encoded: string, x: number, y: number, z: number): string {
	const arr = decodeArray(encoded);
	const idx = binarySearch(arr, x + y * 256 + z * 65536);
	if (idx < 0) return encoded;

	const newArr = new Uint32Array(arr.length - 1);
	newArr.set(arr.subarray(0, idx));
	newArr.set(arr.subarray(idx + 1), idx);
	return encodeArray(newArr);
}
