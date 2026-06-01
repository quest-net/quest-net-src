const STATE_UPDATE_COMPRESSION_MARKER = "__questNetCompressedStateUpdate";

export const STATE_UPDATE_DELTA_COMPRESSION_PATCH_THRESHOLD = 64;

// Trystero splits each data-channel message into ~16KB chunks (see
// @trystero-p2p/core room.mjs: `chunkSize = 16 * 2**10 - payloadIndex`) and the
// payload it chunks is the UTF-8 JSON encoding of our update object. A payload
// that fits in a single chunk is sent as one frame whether or not we compress
// it, so compression only pays off once the serialized update would span more
// than one chunk. We gate a little under the raw 16KB so anything that spills
// into a second chunk is reliably caught. This is what stops a small-patch but
// large-byte delta (e.g. a terrain switch carrying a multi-MB voxel string)
// from going over the wire uncompressed.
export const STATE_UPDATE_DELTA_COMPRESSION_BYTE_THRESHOLD = 16 * 1024;

type CompressionEncoding = "gzip";

export interface StateUpdateCompressionOptions {
	compressFullUpdates?: boolean;
	deltaPatchThreshold?: number;
	deltaByteThreshold?: number;
}

export interface CompressedStateUpdateEnvelope {
	[STATE_UPDATE_COMPRESSION_MARKER]: true;
	encoding: CompressionEncoding;
	originalType?: string;
	patchCount: number;
}

export interface StateUpdateTransport<T> {
	data: T | ArrayBuffer;
	metadata?: CompressedStateUpdateEnvelope;
}

interface PatchCountedUpdate {
	type?: string;
	patches?: unknown[];
}

const DEFAULT_OPTIONS: Required<StateUpdateCompressionOptions> = {
	compressFullUpdates: true,
	deltaPatchThreshold: STATE_UPDATE_DELTA_COMPRESSION_PATCH_THRESHOLD,
	deltaByteThreshold: STATE_UPDATE_DELTA_COMPRESSION_BYTE_THRESHOLD,
};

/**
 * Rough UTF-8 byte estimate of a delta's serialized patches, with an early-out:
 * we only need to know whether the update crosses `limit`, never its exact size.
 * Walks patch values rather than JSON.stringify-ing the whole update, so the
 * common small-delta case stays cheap. ASCII-heavy payloads (notably base64
 * voxel strings, the case this guards) estimate exactly via `string.length`.
 */
function estimatePatchedUpdateBytes(patches: unknown[], limit: number): number {
	let bytes = 0;
	for (const patch of patches) {
		const { path, value } = patch as { path?: string; value?: unknown };
		// Account for the op/path/punctuation overhead of each patch entry.
		bytes += (typeof path === "string" ? path.length : 0) + 24;
		if (typeof value === "string") {
			bytes += value.length;
		} else if (value && typeof value === "object") {
			bytes += JSON.stringify(value).length;
		} else if (value !== undefined) {
			bytes += 12;
		}
		if (bytes >= limit) return bytes; // crossed the threshold — stop counting
	}
	return bytes;
}

export function isCompressedStateUpdateEnvelope(
	data: unknown
): data is CompressedStateUpdateEnvelope {
	return (
		typeof data === "object" &&
		data !== null &&
		(data as Record<string, unknown>)[STATE_UPDATE_COMPRESSION_MARKER] === true
	);
}

export async function compressStateUpdateForTransport<T extends PatchCountedUpdate>(
	update: T,
	options: StateUpdateCompressionOptions = {}
): Promise<StateUpdateTransport<T>> {
	const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
	const patchCount = Array.isArray(update.patches) ? update.patches.length : 0;
	const shouldCompress =
		(update.type === "full" && resolvedOptions.compressFullUpdates) ||
		(update.type === "delta" &&
			// Compress when the delta has many patches OR when it is byte-heavy.
			// The byte check (only evaluated for small-patch deltas, thanks to
			// short-circuiting) catches the large-value-few-patches case that the
			// patch count alone misses.
			(patchCount >= resolvedOptions.deltaPatchThreshold ||
				estimatePatchedUpdateBytes(
					Array.isArray(update.patches) ? update.patches : [],
					resolvedOptions.deltaByteThreshold
				) >= resolvedOptions.deltaByteThreshold));

	if (!shouldCompress || !supportsCompressionStreams()) {
		return { data: update };
	}

	const json = JSON.stringify(update);
	const data = await compressString(json);

	return {
		data,
		metadata: {
			[STATE_UPDATE_COMPRESSION_MARKER]: true,
			encoding: "gzip",
			originalType: update.type,
			patchCount,
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

	if (!isBinaryPayload(data)) {
		throw new Error(
			`Compressed state update payload was not binary. Received ${describeValue(
				data
			)}.`
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

function isBinaryPayload(data: unknown): data is BufferSource {
	return data instanceof ArrayBuffer || ArrayBuffer.isView(data);
}

function describeValue(data: unknown): string {
	if (data === null) return "null";
	if (data === undefined) return "undefined";
	const constructorName =
		typeof data === "object" ? data.constructor?.name : undefined;
	return constructorName ? `${typeof data} (${constructorName})` : typeof data;
}
