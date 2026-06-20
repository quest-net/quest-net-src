// src/utils/terrain/data/VoxelDataUtils.ts
//
// Encodes voxel terrain data as the raw bytes of a Sparse Voxel Octree (SVO).
// Voxel positions are implicit in the tree structure; colors are stored in a
// separate traversal-order byte stream. These bytes are the canonical payload
// form -- base64 only appears at text boundaries (see EncodedVoxelSVO).

import type { Voxel } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { getVoxelCodec, type VoxelDecodeResult } from "./voxelCodecWasm";

function packPosition(x: number, y: number, z: number): number {
	return x + y * 256 + z * 65536;
}

export function unpackVoxel(position: number, color: number): Voxel {
	return {
		x: position & 0xff,
		y: (position >>> 8) & 0xff,
		z: (position >>> 16) & 0xff,
		color,
	};
}

// --- Public API -------------------------------------------------------------

/**
 * Encodes an iterable of voxels into compact SVO bytes.
 * When two voxels share a position the last one wins.
 */
export function encodeVoxels(voxels: Iterable<Voxel>): Uint8Array {
	const positionMap = new Map<number, number>(); // position -> color
	for (const voxel of voxels) {
		positionMap.set(
			packPosition(voxel.x, voxel.y, voxel.z),
			voxel.color & 0xff
		);
	}

	if (positionMap.size === 0) return new Uint8Array(0);

	const positions = new Uint32Array(positionMap.size);
	const colors = new Uint8Array(positionMap.size);
	let index = 0;
	for (const [position, color] of positionMap) {
		positions[index] = position;
		colors[index] = color;
		index++;
	}

	return getVoxelCodec().encode(positions, colors);
}

/** Decodes a voxel set, yielding one Voxel per stored entry. */
export function* decodeVoxels(encoded: Uint8Array): Generator<Voxel> {
	const { positions, colors } = decodeVoxelBuffers(encoded);
	for (let i = 0; i < positions.length; i++) {
		yield unpackVoxel(positions[i], colors[i]);
	}
}

/**
 * Returns the number of voxels in the encoded set. O(1) -- reads the count
 * straight from the SVO header rather than decoding the terrain, so it has no
 * dependency on the (async-initialized) WASM codec. The voxel count is a u32 LE
 * at byte offset 8, after the "QSVO" magic; layout source of truth is
 * wasm/voxel-mesher/src/svo.rs.
 */
export function getVoxelCount(encoded: Uint8Array): number {
	if (encoded.byteLength === 0) return 0;
	if (
		encoded.length < 12 ||
		encoded[0] !== 0x51 || // Q
		encoded[1] !== 0x53 || // S
		encoded[2] !== 0x56 || // V
		encoded[3] !== 0x4f // O
	) {
		throw new Error("Invalid voxel SVO payload.");
	}
	return (
		(encoded[8] | (encoded[9] << 8) | (encoded[10] << 16) | (encoded[11] << 24)) >>>
		0
	);
}

/**
 * Content identity for a voxel payload. A fast, synchronous, zero-dependency
 * hash (cyrb53) of the SVO bytes, prefixed with the byte length so payloads of
 * different sizes can never collide.
 *
 * This is a *content-identity token*, not a cryptographic digest: it is only
 * ever compared against another hash of the same terrain to answer "did this
 * terrain's content change / do I have the right bytes?". Hashing happens at
 * author time (terrain create/edit) and on hydrate, never on a render or
 * per-frame path, so the linear scan of a multi-megabyte buffer is a non-issue.
 * The empty payload hashes to a stable, well-known value.
 */
export function hashVoxels(encoded: Uint8Array): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < encoded.length; i++) {
		const ch = encoded[i];
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
	h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
	h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
	return `${encoded.length.toString(36)}-${hash.toString(16)}`;
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
export function decodeVoxelBuffers(encoded: Uint8Array): VoxelDecodeResult {
	if (encoded.byteLength === 0) {
		return { positions: new Uint32Array(0), colors: new Uint8Array(0) };
	}
	return getVoxelCodec().decode(encoded);
}
