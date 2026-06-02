// src/utils/terrain/data/VoxelDataUtils.ts
//
// Encodes voxel terrain data as a base64-encoded Sparse Voxel Octree (SVO).
// Voxel positions are implicit in the tree structure; colors are stored in a
// separate traversal-order byte stream.

import type { Voxel } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { getVoxelCodec, type VoxelDecodeResult } from "./voxelCodecWasm";
import { bytesToBase64, base64ToBytes } from "../../base64";

// One 28-char base64 block decodes to 21 bytes, enough to cover the 20-byte SVO
// header. The voxel count is a u32 LE at byte offset 8, after the "QSVO" magic.
// The header layout's source of truth is wasm/voxel-mesher/src/svo.rs.
const SVO_HEADER_BASE64_LENGTH = 28;

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

	return bytesToBase64(getVoxelCodec().encode(positions, colors));
}

/** Decodes a voxel set, yielding one Voxel per stored entry. */
export function* decodeVoxels(encoded: string): Generator<Voxel> {
	const { positions, colors } = decodeVoxelBuffers(encoded);
	for (let i = 0; i < positions.length; i++) {
		yield unpackVoxel(positions[i], colors[i]);
	}
}

/**
 * Returns the number of voxels in the encoded set. O(1) -- reads the count
 * straight from the SVO header rather than decoding the terrain, so it has no
 * dependency on the (async-initialized) WASM codec.
 */
export function getVoxelCount(encoded: string): number {
	if (!encoded) return 0;
	const header = base64ToBytes(encoded.slice(0, SVO_HEADER_BASE64_LENGTH));
	if (
		header.length < 12 ||
		header[0] !== 0x51 || // Q
		header[1] !== 0x53 || // S
		header[2] !== 0x56 || // V
		header[3] !== 0x4f // O
	) {
		throw new Error("Invalid voxel SVO payload.");
	}
	return (
		(header[8] | (header[9] << 8) | (header[10] << 16) | (header[11] << 24)) >>> 0
	);
}

/**
 * Decodes a voxel set into flat parallel typed arrays without allocating a Voxel
 * object per entry. `positions[i]` is packed as x + y*256 + z*65536 (unpack with
 * `& 0xff`, `>>> 8 & 0xff`, `>>> 16 & 0xff`); `colors[i]` is the palette index.
 *
 * Prefer this over `decodeVoxels` in hot paths (e.g. geometry building) that
 * consume coordinates numerically -- it avoids hundreds of thousands of
 * short-lived object allocations and the attendant GC pressure.
 */
export function decodeVoxelBuffers(encoded: string): VoxelDecodeResult {
	return getVoxelCodec().decode(base64ToBytes(encoded));
}
