// Precomputed per-palette-index tables for the editor chunk mesher (and, in a
// later step, the WASM editor mesher).
//
// Voxel palette indices are always 0-255, and both the vertex color and the
// "is this a special material?" flag are pure functions of that index. The
// editor mesher used to resolve them per voxel, per face (a THREE.Color.set
// from a string plus a Map-backed isSpecialPaletteIndex lookup) -- so we
// precompute the whole 256-entry answer space once at module load and index it
// directly in the hot loop.
//
//   EDITOR_RGB        -- 256 * 3 managed RGB triples (row-major r,g,b), built
//                        through THREE.Color so color management matches the
//                        per-voxel path bit-for-bit.
//   EDITOR_IS_SPECIAL -- 256 flags (1 = special material -> editor stripe
//                        shader, 0 = normal).
//
// These live in this leaf module rather than in MATERIAL_LOOKUP because
// VoxelTerrainEditorUtils imports from materials; building the RGB table at
// materials' module-load (where MATERIAL_LOOKUP is evaluated) would risk a
// circular-init TDZ. This module is only ever imported by the editor, well
// after both dependencies have finished initializing.

import * as THREE from "three";
import { isSpecialPaletteIndex } from "../../Map/Terrain/materials";
import {
	normalizeVoxelPaletteIndex,
	terrainPaletteIndexToVoxelColor,
} from "../../../utils/terrain/editor/VoxelTerrainEditorUtils";

const RGB = new Float32Array(256 * 3);
const IS_SPECIAL = new Uint8Array(256);

{
	const color = new THREE.Color();
	for (let i = 0; i < 256; i++) {
		color.set(terrainPaletteIndexToVoxelColor(normalizeVoxelPaletteIndex(i)));
		RGB[i * 3] = color.r;
		RGB[i * 3 + 1] = color.g;
		RGB[i * 3 + 2] = color.b;
		IS_SPECIAL[i] = isSpecialPaletteIndex(i) ? 1 : 0;
	}
}

export const EDITOR_RGB: Float32Array = RGB;
export const EDITOR_IS_SPECIAL: Uint8Array = IS_SPECIAL;
