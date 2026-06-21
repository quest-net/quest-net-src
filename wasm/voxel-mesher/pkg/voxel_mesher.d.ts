/* tslint:disable */
/* eslint-disable */

export class MeshBuild {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    bucket_count(): number;
    /**
     * Interned bucket id (maps to bucketKeyById JS-side).
     */
    bucket_id(i: number): number;
    occupancy_height(): number;
    occupancy_length(): number;
    /**
     * Occupancy/fog grid dimensions (= voxel dims when not downsampled). The
     * occupancy and fog volumes share these dims.
     */
    occupancy_width(): number;
    take_colors(i: number): Float32Array | undefined;
    take_fog(): Uint8Array | undefined;
    take_highlights(i: number): Float32Array;
    take_indices(i: number): Uint32Array;
    take_normals(i: number): Float32Array;
    take_occupancy(): Uint8Array;
    take_positions(i: number): Float32Array;
    take_surface_deform(i: number): Float32Array | undefined;
    take_tile_heights(i: number): Float32Array;
    voxel_count(): number;
}

export class SvoDecode {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    take_colors(): Uint8Array;
    take_positions(): Uint32Array;
}

export class VoxelMesher {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Build geometry. `positions[i]` packed as x + y*256 + z*65536; `colors[i]`
     * is the palette index. width/height/length are TACTICAL units; voxel dims
     * = tactical * resolution.
     */
    build(positions: Uint32Array, colors: Uint8Array, width: number, height: number, length: number, resolution: number, occ_factor: number): MeshBuild;
    /**
     * Fused decode + mesh: decodes the base64-free SVO byte payload in WASM and
     * runs the same greedy mesher as `build`. This keeps the SVO decode off the
     * JS side entirely and avoids marshalling the positions/colors arrays across
     * the JS<->WASM boundary on the gameplay terrain build path.
     */
    build_from_svo(svo_bytes: Uint8Array, width: number, height: number, length: number, resolution: number, occ_factor: number): MeshBuild;
    constructor(bucket_id: Int32Array, occlusion_id: Int32Array, uses_vertex_colors: Uint8Array, deforms_surface: Uint8Array, preserves_faces: Uint8Array, is_volumetric: Uint8Array, rgb: Float32Array);
}

export function decode_svo_wasm(svo_bytes: Uint8Array): SvoDecode;

export function encode_svo_wasm(positions: Uint32Array, colors: Uint8Array): Uint8Array;
