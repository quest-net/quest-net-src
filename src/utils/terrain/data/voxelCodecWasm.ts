// src/utils/terrain/data/voxelCodecWasm.ts
//
// Accessor for the WASM Sparse Voxel Octree codec (wasm/voxel-mesher pkg). This
// is the ONLY SVO codec implementation -- there is no JS fallback. The codec API
// in VoxelDataUtils is synchronous, but WASM instantiation is async, so
// `initVoxelCodec()` must be awaited at app startup (see index.tsx) before any
// terrain encode/decode runs. If it can't load, the app hard-fails loudly rather
// than silently degrading.
//
// The same pkg is loaded in the geometry worker via getMesher(); this is the
// main-thread counterpart for the editor / spatial-index / import call sites.

export interface VoxelCodec {
	/** Encodes packed positions (x + y*256 + z*65536) + palette colors to SVO bytes. */
	encode(positions: Uint32Array, colors: Uint8Array): Uint8Array;
	/** Decodes SVO bytes into parallel packed-position + palette-color arrays. */
	decode(bytes: Uint8Array): VoxelDecodeResult;
}

export interface VoxelDecodeResult {
	positions: Uint32Array;
	colors: Uint8Array;
}

let codec: VoxelCodec | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Instantiates the WASM codec once (idempotent). Must be awaited at startup
 * before any synchronous codec call. Rejects if the pkg is missing/stale, which
 * hard-fails app boot -- run `npm run build:wasm` to regenerate the pkg.
 */
export function initVoxelCodec(): Promise<void> {
	if (!initPromise) {
		initPromise = (async () => {
			const wasm = await import(
				"../../../../wasm/voxel-mesher/pkg/voxel_mesher.js"
			);
			if (
				typeof wasm.encode_svo_wasm !== "function" ||
				typeof wasm.decode_svo_wasm !== "function"
			) {
				throw new Error(
					"WASM pkg is missing the SVO codec exports. Run `npm run build:wasm` to regenerate wasm/voxel-mesher/pkg."
				);
			}
			codec = {
				encode: (positions, colors) => wasm.encode_svo_wasm(positions, colors),
				decode: (bytes) => {
					const decoded = wasm.decode_svo_wasm(bytes);
					try {
						return {
							positions: decoded.take_positions(),
							colors: decoded.take_colors(),
						};
					} finally {
						decoded.free();
					}
				},
			};
		})();
	}
	return initPromise;
}

/**
 * Returns the WASM codec. Throws if `initVoxelCodec()` has not resolved yet --
 * which should be impossible at runtime since it is awaited at startup, so a
 * throw here means a caller ran before boot completed.
 */
export function getVoxelCodec(): VoxelCodec {
	if (!codec) {
		throw new Error(
			"Voxel SVO codec used before initVoxelCodec() resolved -- it must be awaited at startup."
		);
	}
	return codec;
}
