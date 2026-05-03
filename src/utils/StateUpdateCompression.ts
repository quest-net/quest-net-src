const STATE_UPDATE_COMPRESSION_MARKER = "__questNetCompressedStateUpdate";

export const STATE_UPDATE_DELTA_COMPRESSION_PATCH_THRESHOLD = 64;

type CompressionEncoding = "gzip";

export interface StateUpdateCompressionOptions {
	compressFullUpdates?: boolean;
	deltaPatchThreshold?: number;
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
};

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
			patchCount >= resolvedOptions.deltaPatchThreshold);

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
