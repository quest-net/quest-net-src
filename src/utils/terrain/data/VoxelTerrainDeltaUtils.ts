// src/utils/terrain/data/VoxelTerrainDeltaUtils.ts
//
// Delta codec for voxel terrain edits. A delta is a compact description of the
// voxels that changed between two committed SVO payloads (old -> new): a set of
// positions with their new palette color, plus the positions that were removed.
//
// This is a pure OPTIMIZATION layer over the existing full-payload fetch
// (TerrainTransferService). It lets the DM broadcast a few KB instead of
// re-sending the whole multi-MB SVO on every terrain edit. If anything is off
// (wrong base, dimension/resolution change, too many voxels changed) the codec
// returns null / the apply path is skipped, and the client falls through to the
// full fetch, which is always correct. See docs/terrain-delta-updates-plan.md.
//
// Determinism note: the WASM SVO encoder is position-structural (octree), so
// re-encoding the same voxel SET always yields byte-identical output regardless
// of insertion order. That is what lets a player reconstruct the DM's exact new
// payload from a delta and verify it by re-hashing against the broadcast newHash.

import type { Voxel } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { decodeVoxelBuffers, encodeVoxels, unpackVoxel } from "./VoxelDataUtils";

/**
 * The set of voxels that changed between two payloads. `positions[i]` is packed
 * as x + y*256 + z*65536 (same packing as the SVO codec); `newColors[i]` is the
 * voxel's new palette index (0..255), or -1 when the voxel was removed.
 */
export interface VoxelDelta {
	positions: Uint32Array;
	newColors: Int16Array;
}

export interface ComputeVoxelDeltaOptions {
	/**
	 * Skip the delta (return null) when its estimated transport size is at least
	 * this fraction of the full new payload's size. A delta is only worth
	 * broadcasting when it is meaningfully smaller than just sending the whole
	 * thing. Defaults to 0.5 (delta must be < 50% of the full payload).
	 */
	maxSizeRatio?: number;
}

const DEFAULT_MAX_SIZE_RATIO = 0.5;

// Compact binary transport layout (all multi-byte fields little-endian, read via
// DataView so there are no alignment requirements):
//   [0..4)   magic "QVDL"
//   [4]      version (1)
//   [5..9)   changedCount (u32)
//   [9..13)  removedCount (u32)
//   then changedCount * u32 positions
//   then changedCount * u8  colors
//   then removedCount * u32 positions
const DELTA_HEADER_BYTES = 13;
const DELTA_VERSION = 1;
// "QVDL" = Quest Voxel DeLta.
const MAGIC = [0x51, 0x56, 0x44, 0x4c] as const;

function* voxelsFromMap(map: Map<number, number>): Generator<Voxel> {
	for (const [position, color] of map) {
		yield unpackVoxel(position, color);
	}
}

function decodeToMap(encoded: Uint8Array): Map<number, number> {
	const map = new Map<number, number>();
	if (encoded.byteLength === 0) return map;
	const { positions, colors } = decodeVoxelBuffers(encoded);
	for (let i = 0; i < positions.length; i++) {
		map.set(positions[i], colors[i]);
	}
	return map;
}

/**
 * Diffs two committed SVO payloads and returns the changed voxels as a delta, or
 * null when a delta should not be used:
 *  - either side is empty (no base / full clear -- full fetch is trivial), or
 *  - the delta isn't a net win (estimated transport size >= maxSizeRatio of the
 *    full new payload).
 *
 * Dimension / resolution changes are NOT guarded here -- positions are always
 * packed the same way so the diff stays correct -- but such changes typically
 * rewrite most voxels and so naturally trip the size guard. The caller may also
 * skip computing a delta on a dimension change as a cheap short-circuit.
 */
export function computeVoxelDelta(
	oldBytes: Uint8Array,
	newBytes: Uint8Array,
	options?: ComputeVoxelDeltaOptions
): VoxelDelta | null {
	if (oldBytes.byteLength === 0 || newBytes.byteLength === 0) return null;

	const oldMap = decodeToMap(oldBytes);
	const newMap = decodeToMap(newBytes);

	const positions: number[] = [];
	const newColors: number[] = [];

	// Added or recolored voxels.
	for (const [position, color] of newMap) {
		if (oldMap.get(position) !== color) {
			positions.push(position);
			newColors.push(color);
		}
	}

	let removedCount = 0;
	// Removed voxels (present in old, absent in new).
	for (const position of oldMap.keys()) {
		if (!newMap.has(position)) {
			positions.push(position);
			newColors.push(-1);
			removedCount++;
		}
	}

	const changedCount = positions.length - removedCount;
	const estimatedBytes =
		DELTA_HEADER_BYTES + changedCount * 5 + removedCount * 4;
	const maxSizeRatio = options?.maxSizeRatio ?? DEFAULT_MAX_SIZE_RATIO;
	if (estimatedBytes >= newBytes.byteLength * maxSizeRatio) return null;

	return {
		positions: Uint32Array.from(positions),
		newColors: Int16Array.from(newColors),
	};
}

/**
 * Applies a delta to a base SVO payload and returns the resulting SVO bytes.
 * The caller must ensure `oldBytes` is the payload the delta was computed against
 * (matched by content hash); otherwise the result is meaningless.
 */
export function applyVoxelDelta(oldBytes: Uint8Array, delta: VoxelDelta): Uint8Array {
	const map = decodeToMap(oldBytes);
	const { positions, newColors } = delta;
	for (let i = 0; i < positions.length; i++) {
		const color = newColors[i];
		if (color < 0) {
			map.delete(positions[i]);
		} else {
			map.set(positions[i], color);
		}
	}
	return encodeVoxels(voxelsFromMap(map));
}

/** Serializes a delta to its compact binary transport form (layout above). */
export function encodeDeltaBytes(delta: VoxelDelta): Uint8Array {
	const { positions, newColors } = delta;
	const total = positions.length;

	// Partition into changed (color >= 0) and removed (color === -1).
	const changedPositions: number[] = [];
	const changedColors: number[] = [];
	const removedPositions: number[] = [];
	for (let i = 0; i < total; i++) {
		if (newColors[i] < 0) {
			removedPositions.push(positions[i]);
		} else {
			changedPositions.push(positions[i]);
			changedColors.push(newColors[i]);
		}
	}

	const changedCount = changedPositions.length;
	const removedCount = removedPositions.length;
	const byteLength =
		DELTA_HEADER_BYTES + changedCount * 5 + removedCount * 4;
	const buffer = new ArrayBuffer(byteLength);
	const view = new DataView(buffer);
	const bytes = new Uint8Array(buffer);

	bytes[0] = MAGIC[0];
	bytes[1] = MAGIC[1];
	bytes[2] = MAGIC[2];
	bytes[3] = MAGIC[3];
	bytes[4] = DELTA_VERSION;
	view.setUint32(5, changedCount, true);
	view.setUint32(9, removedCount, true);

	let offset = DELTA_HEADER_BYTES;
	for (let i = 0; i < changedCount; i++) {
		view.setUint32(offset, changedPositions[i], true);
		offset += 4;
	}
	for (let i = 0; i < changedCount; i++) {
		bytes[offset] = changedColors[i] & 0xff;
		offset += 1;
	}
	for (let i = 0; i < removedCount; i++) {
		view.setUint32(offset, removedPositions[i], true);
		offset += 4;
	}

	return bytes;
}

/**
 * Parses the compact binary transport form back into a VoxelDelta. Throws on a
 * missing magic or unsupported version so a corrupt/incompatible message is
 * rejected by the caller (which then falls through to a full fetch).
 */
export function decodeDeltaBytes(bytes: Uint8Array): VoxelDelta {
	if (
		bytes.length < DELTA_HEADER_BYTES ||
		bytes[0] !== MAGIC[0] ||
		bytes[1] !== MAGIC[1] ||
		bytes[2] !== MAGIC[2] ||
		bytes[3] !== MAGIC[3]
	) {
		throw new Error("Invalid voxel delta payload.");
	}
	if (bytes[4] !== DELTA_VERSION) {
		throw new Error(`Unsupported voxel delta version: ${bytes[4]}`);
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const changedCount = view.getUint32(5, true);
	const removedCount = view.getUint32(9, true);
	const total = changedCount + removedCount;

	const positions = new Uint32Array(total);
	const newColors = new Int16Array(total);

	let offset = DELTA_HEADER_BYTES;
	for (let i = 0; i < changedCount; i++) {
		positions[i] = view.getUint32(offset, true);
		offset += 4;
	}
	const colorBase = offset;
	for (let i = 0; i < changedCount; i++) {
		newColors[i] = bytes[colorBase + i];
	}
	offset = colorBase + changedCount;
	for (let i = 0; i < removedCount; i++) {
		positions[changedCount + i] = view.getUint32(offset, true);
		newColors[changedCount + i] = -1;
		offset += 4;
	}

	return { positions, newColors };
}
