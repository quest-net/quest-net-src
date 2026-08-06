const STATE_UPDATE_COMPRESSION_MARKER = "__questNetCompressedStateUpdate";

// Trystero splits each data-channel message into ~16KB chunks (see
// @trystero-p2p/core room.mjs: `chunkSize = 16 * 2**10 - payloadIndex`) and the
// payload it chunks is the UTF-8 JSON encoding of our update object. A payload
// that fits in a single chunk is sent as one frame whether or not we compress
// it, so compression only pays off once the serialized update would span more
// than one chunk. We gate a little under the raw 16KB so anything that spills
// into a second chunk is reliably caught. This is what stops a small-patch but
// large-byte delta (e.g. a terrain switch carrying a multi-MB voxel string)
// from going over the wire uncompressed.
const COMPRESSION_BYTE_THRESHOLD = 16 * 1024;

type CompressionEncoding = "gzip";

interface CompressedStateUpdateEnvelope {
	[STATE_UPDATE_COMPRESSION_MARKER]: true;
	encoding: CompressionEncoding;
}

export interface StateUpdateTransport<T> {
	data: T | ArrayBuffer;
	metadata?: CompressedStateUpdateEnvelope;
}

function isCompressedStateUpdateEnvelope(
	data: unknown
): data is CompressedStateUpdateEnvelope {
	return (
		typeof data === "object" &&
		data !== null &&
		(data as Record<string, unknown>)[STATE_UPDATE_COMPRESSION_MARKER] === true
	);
}

export async function compressStateUpdateForTransport<T extends { type?: string }>(
	update: T
): Promise<StateUpdateTransport<T>> {
	if (!supportsCompressionStreams()) {
		return { data: update };
	}

	// Serialize once and measure the real thing: full sends always compress,
	// deltas only when they would spill past a single chunk. (JSON is ASCII-heavy
	// here, so `length` tracks the UTF-8 byte count closely enough to gate on.)
	const json = JSON.stringify(update);
	if (update.type !== "full" && json.length < COMPRESSION_BYTE_THRESHOLD) {
		return { data: update };
	}

	return {
		data: await compressString(json),
		metadata: {
			[STATE_UPDATE_COMPRESSION_MARKER]: true,
			encoding: "gzip",
		},
	};
}

export async function decompressStateUpdateIfNeeded<T>(
	data: T | BufferSource,
	metadata?: unknown
): Promise<T> {
	if (!isCompressedStateUpdateEnvelope(metadata)) {
		return data as T;
	}

	if (!supportsCompressionStreams()) {
		throw new Error("Received compressed state update, but gzip is unavailable.");
	}

	if (metadata.encoding !== "gzip") {
		throw new Error(`Unsupported state update compression: ${metadata.encoding}`);
	}

	if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
		throw new Error(
			`Compressed state update payload was not binary. Received ${typeof data}.`
		);
	}

	const json = await decompressString(data);
	return JSON.parse(json) as T;
}

function supportsCompressionStreams(): boolean {
	return (
		typeof CompressionStream !== "undefined" &&
		typeof DecompressionStream !== "undefined"
	);
}

async function compressString(value: string): Promise<ArrayBuffer> {
	const stream = new Blob([value])
		.stream()
		.pipeThrough(new CompressionStream("gzip"));
	return new Response(stream).arrayBuffer();
}

async function decompressString(value: BufferSource): Promise<string> {
	const stream = new Blob([value])
		.stream()
		.pipeThrough(new DecompressionStream("gzip"));
	return new Response(stream).text();
}
