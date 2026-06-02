/* @ts-self-types="./voxel_mesher.d.ts" */
import * as wasm from "./voxel_mesher_bg.wasm";
import { __wbg_set_wasm } from "./voxel_mesher_bg.js";

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    MeshBuild, SvoDecode, VoxelMesher, decode_svo_wasm, encode_svo_wasm
} from "./voxel_mesher_bg.js";
