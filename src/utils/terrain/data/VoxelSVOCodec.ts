const MAGIC_Q = 0x51; // Q
const MAGIC_S = 0x53; // S
const MAGIC_V = 0x56; // V
const MAGIC_O = 0x4f; // O

const HEADER_BYTE_LENGTH = 20;
const MAX_SVO_DEPTH = 8; // x/y/z are one byte each in Quest-Net voxel coords.

const STREAM_RAW = 0;
const STREAM_RLE = 1;

type ByteStreamEncoding = typeof STREAM_RAW | typeof STREAM_RLE;

export interface VoxelSVODecodeResult {
	positions: Uint32Array;
	colors: Uint8Array;
}

interface EncodedByteStream {
	encoding: ByteStreamEncoding;
	bytes: Uint8Array;
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
	return (
		bytes[offset] |
		(bytes[offset + 1] << 8) |
		(bytes[offset + 2] << 16) |
		(bytes[offset + 3] << 24)
	) >>> 0;
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
	bytes[offset] = value & 0xff;
	bytes[offset + 1] = (value >>> 8) & 0xff;
	bytes[offset + 2] = (value >>> 16) & 0xff;
	bytes[offset + 3] = (value >>> 24) & 0xff;
}

function assertMagic(bytes: Uint8Array): void {
	if (
		bytes.length < HEADER_BYTE_LENGTH ||
		bytes[0] !== MAGIC_Q ||
		bytes[1] !== MAGIC_S ||
		bytes[2] !== MAGIC_V ||
		bytes[3] !== MAGIC_O
	) {
		throw new Error("Invalid voxel SVO payload.");
	}
}

function getX(position: number): number {
	return position & 0xff;
}

function getY(position: number): number {
	return (position >>> 8) & 0xff;
}

function getZ(position: number): number {
	return (position >>> 16) & 0xff;
}

function packPosition(x: number, y: number, z: number): number {
	return x + (y << 8) + (z << 16);
}

function depthForMaxCoord(maxCoord: number): number {
	let depth = 1;
	let extent = 2;
	while (extent <= maxCoord) {
		depth++;
		extent <<= 1;
	}

	if (depth > MAX_SVO_DEPTH) {
		throw new Error(`Voxel coordinate exceeds ${MAX_SVO_DEPTH}-level SVO bounds.`);
	}
	return depth;
}

/**
 * Computes the full MAX_SVO_DEPTH Morton path for a voxel. Always emits 24
 * bits (3 bits per level) -- leading zeros mean the same numeric value sorts
 * and indexes identically for any smaller actual depth, so the encoder can
 * defer computing the real depth until after the single combined pass.
 */
function fullMortonPath(x: number, y: number, z: number): number {
	let path = 0;
	for (let level = MAX_SVO_DEPTH - 1; level >= 0; level--) {
		path =
			(path << 3) |
			(((x >>> level) & 1) << 2) |
			(((y >>> level) & 1) << 1) |
			((z >>> level) & 1);
	}
	return path;
}

function entryPath(entry: number): number {
	return Math.floor(entry / 256);
}

function entryColor(entry: number): number {
	return entry & 0xff;
}

function writeNode(
	entries: readonly number[],
	start: number,
	end: number,
	level: number,
	geometry: number[],
	colors: number[]
): void {
	const maskIndex = geometry.length;
	geometry.push(0);

	const childRanges: Array<{ start: number; end: number }> = [];
	const shift = (level - 1) * 3;
	let mask = 0;
	let cursor = start;

	while (cursor < end) {
		const child = (entryPath(entries[cursor]) >>> shift) & 0b111;
		const childStart = cursor;
		cursor++;

		while (
			cursor < end &&
			(((entryPath(entries[cursor]) >>> shift) & 0b111) === child)
		) {
			cursor++;
		}

		mask |= 1 << child;
		childRanges.push({ start: childStart, end: cursor });
	}

	geometry[maskIndex] = mask;

	if (level === 1) {
		for (const range of childRanges) {
			colors.push(entryColor(entries[range.start]));
		}
		return;
	}

	for (const range of childRanges) {
		writeNode(entries, range.start, range.end, level - 1, geometry, colors);
	}
}

function writeVarUint(value: number, out: number[]): void {
	let remaining = value;
	while (remaining >= 0x80) {
		out.push((remaining % 0x80) | 0x80);
		remaining = Math.floor(remaining / 0x80);
	}
	out.push(remaining);
}

function readVarUint(bytes: Uint8Array, offset: { value: number }): number {
	let value = 0;
	let multiplier = 1;

	while (offset.value < bytes.length) {
		const byte = bytes[offset.value++];
		value += (byte & 0x7f) * multiplier;
		if ((byte & 0x80) === 0) return value;
		multiplier *= 0x80;
		if (multiplier > 0x100000000) {
			throw new Error("Voxel SVO RLE count is too large.");
		}
	}

	throw new Error("Voxel SVO RLE stream ended mid-count.");
}

function encodeRle(bytes: Uint8Array): Uint8Array {
	const out: number[] = [];
	let cursor = 0;

	while (cursor < bytes.length) {
		const value = bytes[cursor];
		let end = cursor + 1;
		while (end < bytes.length && bytes[end] === value) end++;

		writeVarUint(end - cursor, out);
		out.push(value);
		cursor = end;
	}

	return new Uint8Array(out);
}

function decodeRle(bytes: Uint8Array): Uint8Array {
	const out: number[] = [];
	const offset = { value: 0 };

	while (offset.value < bytes.length) {
		const count = readVarUint(bytes, offset);
		if (offset.value >= bytes.length) {
			throw new Error("Voxel SVO RLE stream ended before value byte.");
		}
		const value = bytes[offset.value++];
		for (let i = 0; i < count; i++) out.push(value);
	}

	return new Uint8Array(out);
}

function encodeByteStream(bytes: Uint8Array): EncodedByteStream {
	if (bytes.length === 0) {
		return { encoding: STREAM_RAW, bytes };
	}

	const rle = encodeRle(bytes);
	return rle.length < bytes.length
		? { encoding: STREAM_RLE, bytes: rle }
		: { encoding: STREAM_RAW, bytes };
}

function decodeByteStream(
	bytes: Uint8Array,
	encoding: number
): Uint8Array {
	if (encoding === STREAM_RAW) return bytes.slice();
	if (encoding === STREAM_RLE) return decodeRle(bytes);
	throw new Error(`Unsupported voxel SVO stream encoding: ${encoding}.`);
}

/**
 * Encodes voxel positions and palette colors into a Sparse Voxel Octree byte
 * stream. Positions are packed as x + y*256 + z*65536.
 */
export function encode(
	positions: Uint32Array,
	colors: Uint8Array
): Uint8Array {
	if (positions.length !== colors.length) {
		throw new Error("Voxel SVO positions/colors length mismatch.");
	}
	if (positions.length === 0) {
		return new Uint8Array(0);
	}

	// Single pass over positions: build Morton-keyed entries and track the
	// largest coordinate seen. The full-depth Morton path is depth-agnostic
	// (small coords just have leading zeros), so we don't need to know the
	// final depth until after the loop.
	const entries = new Array<number>(positions.length);
	let maxCoord = 0;
	for (let i = 0; i < positions.length; i++) {
		const position = positions[i];
		const x = getX(position);
		const y = getY(position);
		const z = getZ(position);
		if (x > maxCoord) maxCoord = x;
		if (y > maxCoord) maxCoord = y;
		if (z > maxCoord) maxCoord = z;
		entries[i] = fullMortonPath(x, y, z) * 256 + (colors[i] & 0xff);
	}
	const depth = depthForMaxCoord(maxCoord);
	entries.sort((a, b) => a - b);

	const geometryBytes: number[] = [];
	const colorBytes: number[] = [];
	writeNode(entries, 0, entries.length, depth, geometryBytes, colorBytes);

	const geometry = encodeByteStream(new Uint8Array(geometryBytes));
	const colorStream = encodeByteStream(new Uint8Array(colorBytes));
	const out = new Uint8Array(
		HEADER_BYTE_LENGTH + geometry.bytes.length + colorStream.bytes.length
	);

	out[0] = MAGIC_Q;
	out[1] = MAGIC_S;
	out[2] = MAGIC_V;
	out[3] = MAGIC_O;
	out[4] = depth;
	out[5] = geometry.encoding;
	out[6] = colorStream.encoding;
	out[7] = 0;
	writeUint32LE(out, 8, positions.length);
	writeUint32LE(out, 12, geometry.bytes.length);
	writeUint32LE(out, 16, colorStream.bytes.length);
	out.set(geometry.bytes, HEADER_BYTE_LENGTH);
	out.set(colorStream.bytes, HEADER_BYTE_LENGTH + geometry.bytes.length);

	return out;
}

export function getVoxelCount(bytes: Uint8Array): number {
	if (bytes.length === 0) return 0;
	assertMagic(bytes);
	return readUint32LE(bytes, 8);
}

export function decode(bytes: Uint8Array): VoxelSVODecodeResult {
	if (bytes.length === 0) {
		return {
			positions: new Uint32Array(0),
			colors: new Uint8Array(0),
		};
	}

	assertMagic(bytes);

	const depth = bytes[4];
	const geometryEncoding = bytes[5];
	const colorEncoding = bytes[6];
	const voxelCount = readUint32LE(bytes, 8);
	const geometryLength = readUint32LE(bytes, 12);
	const colorLength = readUint32LE(bytes, 16);
	const expectedLength = HEADER_BYTE_LENGTH + geometryLength + colorLength;

	if (depth > MAX_SVO_DEPTH) {
		throw new Error(`Voxel SVO depth ${depth} exceeds supported bounds.`);
	}
	if (bytes.length !== expectedLength) {
		throw new Error("Voxel SVO payload length does not match its header.");
	}
	if (voxelCount === 0) {
		return {
			positions: new Uint32Array(0),
			colors: new Uint8Array(0),
		};
	}
	if (depth === 0) {
		throw new Error("Voxel SVO payload has voxels but no tree depth.");
	}

	const geometryStart = HEADER_BYTE_LENGTH;
	const colorStart = geometryStart + geometryLength;
	const geometry = decodeByteStream(
		bytes.subarray(geometryStart, colorStart),
		geometryEncoding
	);
	const colorStream = decodeByteStream(
		bytes.subarray(colorStart, expectedLength),
		colorEncoding
	);
	const positions = new Uint32Array(voxelCount);
	const colors = new Uint8Array(voxelCount);
	let geometryOffset = 0;
	let colorOffset = 0;
	let voxelOffset = 0;

	const readNode = (
		level: number,
		baseX: number,
		baseY: number,
		baseZ: number
	): void => {
		if (geometryOffset >= geometry.length) {
			throw new Error("Voxel SVO geometry stream ended early.");
		}

		const mask = geometry[geometryOffset++];
		const childSize = 1 << (level - 1);

		for (let child = 0; child < 8; child++) {
			if ((mask & (1 << child)) === 0) continue;

			const x = baseX + (((child >>> 2) & 1) * childSize);
			const y = baseY + (((child >>> 1) & 1) * childSize);
			const z = baseZ + ((child & 1) * childSize);

			if (level === 1) {
				if (voxelOffset >= voxelCount) {
					throw new Error("Voxel SVO geometry contains too many leaves.");
				}
				if (colorOffset >= colorStream.length) {
					throw new Error("Voxel SVO color stream ended early.");
				}

				positions[voxelOffset] = packPosition(x, y, z);
				colors[voxelOffset] = colorStream[colorOffset++];
				voxelOffset++;
			} else {
				readNode(level - 1, x, y, z);
			}
		}
	};

	readNode(depth, 0, 0, 0);

	if (voxelOffset !== voxelCount) {
		throw new Error("Voxel SVO geometry leaf count does not match its header.");
	}
	if (geometryOffset !== geometry.length) {
		throw new Error("Voxel SVO geometry stream has trailing bytes.");
	}
	if (colorOffset !== colorStream.length) {
		throw new Error("Voxel SVO color stream has trailing bytes.");
	}

	return { positions, colors };
}
