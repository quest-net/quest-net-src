// src/utils/VoxImportUtils.ts
//
// Parses MagicaVoxel .vox files (format versions 150 and 200) and converts
// them to VoxelTerrain-compatible data.
//
// Only the first model in a multi-model file is imported.
//
// Axis remapping:
//   MagicaVoxel uses Z-up (Z = height).
//   Quest-Net uses Y-up (Y = elevation).
//   VOX (x, y, z)  ->  Quest-Net (x=vox_x, y=vox_z, z=mirrored_vox_y)
//
//   The VOX Y axis increases going "north" (away from the viewer in
//   MagicaVoxel's default isometric camera which sits in the +X/-Y/+Z
//   octant).  Three.js positive Z points toward the camera (south), so
//   the two axes are antiparallel.  Without a mirror the imported model
//   appears flipped front-to-back.  We apply:
//     Quest-Net z = (SIZE.y - 1) - VOX y
//   which preserves the extent (terrain.Length = SIZE.y) while correcting
//   the orientation.
//
// Chunk walking strategy:
//   Unknown chunks are skipped including their children
//   (offset += contentSize + childrenSize), so nested scene-graph chunks
//   in v200 files (nTRN, nGRP, nSHP, MATL, ...) are safely bypassed.

import type { VoxelTerrain } from "../domains/VoxelTerrain/VoxelTerrain";
import { DEFAULT_TERRAIN_COLOR_INDEX } from "./TerrainPaletteUtils";
import { encodeVoxels } from "./VoxelDataUtils";
import {
	MAX_VOXEL_TERRAIN_HEIGHT,
	MAX_VOXEL_TERRAIN_LENGTH,
	MAX_VOXEL_TERRAIN_WIDTH,
	MAX_VOXEL_TERRAIN_RESOLUTION,
	MIN_VOXEL_TERRAIN_RESOLUTION,
	voxelColorToTerrainPaletteIndex,
} from "./VoxelTerrainEditorUtils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw output of parseVoxFile -- axes already remapped to Quest-Net convention. */
export interface VoxParseResult {
	/** Voxel extent along Quest-Net X axis  (= VOX SIZE.x). */
	voxWidth: number;
	/** Voxel extent along Quest-Net Z axis  (= VOX SIZE.y). */
	voxLength: number;
	/** Voxel extent along Quest-Net Y axis  (= VOX SIZE.z, elevation). */
	voxHeight: number;
	/**
	 * Remapped voxel data as a flat Uint8Array of [x, y, z, colorIndex] quads,
	 * already in Quest-Net axis order.  colorIndex is a VOX palette index (1-255).
	 */
	rawData: Uint8Array;
	/**
	 * VOX palette, 1-indexed.  palette[c] gives the color for XYZI index c as
	 * a packed little-endian uint32: 0xAABBGGRR.
	 * Entry 0 is always 0 (unused; XYZI index 0 means empty space).
	 */
	palette: number[];
}

/** One entry per resolution level describing whether it fits within max bounds. */
export interface VoxResolutionOption {
	resolution: number;
	tacticalWidth: number;
	tacticalLength: number;
	tacticalHeight: number;
	/** False when any tactical dimension exceeds its maximum. */
	fits: boolean;
}

// ---------------------------------------------------------------------------
// Default MagicaVoxel palette
// 1-indexed: entry 0 unused, entries 1-255 are the actual colors.
// Matches the DEFAULT_PALETTE in Three.js VOXLoader exactly.
// ---------------------------------------------------------------------------

const DEFAULT_PALETTE: number[] = [
	0x00000000, // index 0: unused (empty voxel marker)
	0xffffffff, 0xffccffff, 0xff99ffff, 0xff66ffff, 0xff33ffff, 0xff00ffff,
	0xffffccff, 0xffccccff, 0xff99ccff, 0xff66ccff, 0xff33ccff, 0xff00ccff,
	0xffff99ff, 0xffcc99ff, 0xff9999ff, 0xff6699ff, 0xff3399ff, 0xff0099ff,
	0xffff66ff, 0xffcc66ff, 0xff9966ff, 0xff6666ff, 0xff3366ff, 0xff0066ff,
	0xffff33ff, 0xffcc33ff, 0xff9933ff, 0xff6633ff, 0xff3333ff, 0xff0033ff,
	0xffff00ff, 0xffcc00ff, 0xff9900ff, 0xff6600ff, 0xff3300ff, 0xff0000ff,
	0xffffffcc, 0xffccffcc, 0xff99ffcc, 0xff66ffcc, 0xff33ffcc, 0xff00ffcc,
	0xffffcccc, 0xffcccccc, 0xff99cccc, 0xff66cccc, 0xff33cccc, 0xff00cccc,
	0xffff99cc, 0xffcc99cc, 0xff9999cc, 0xff6699cc, 0xff3399cc, 0xff0099cc,
	0xffff66cc, 0xffcc66cc, 0xff9966cc, 0xff6666cc, 0xff3366cc, 0xff0066cc,
	0xffff33cc, 0xffcc33cc, 0xff9933cc, 0xff6633cc, 0xff3333cc, 0xff0033cc,
	0xffff00cc, 0xffcc00cc, 0xff9900cc, 0xff6600cc, 0xff3300cc, 0xff0000cc,
	0xffffff99, 0xffccff99, 0xff99ff99, 0xff66ff99, 0xff33ff99, 0xff00ff99,
	0xffffcc99, 0xffcccc99, 0xff99cc99, 0xff66cc99, 0xff33cc99, 0xff00cc99,
	0xffff9999, 0xffcc9999, 0xff999999, 0xff669999, 0xff339999, 0xff009999,
	0xffff6699, 0xffcc6699, 0xff996699, 0xff666699, 0xff336699, 0xff006699,
	0xffff3399, 0xffcc3399, 0xff993399, 0xff663399, 0xff333399, 0xff003399,
	0xffff0099, 0xffcc0099, 0xff990099, 0xff660099, 0xff330099, 0xff000099,
	0xffffff66, 0xffccff66, 0xff99ff66, 0xff66ff66, 0xff33ff66, 0xff00ff66,
	0xffffcc66, 0xffcccc66, 0xff99cc66, 0xff66cc66, 0xff33cc66, 0xff00cc66,
	0xffff9966, 0xffcc9966, 0xff999966, 0xff669966, 0xff339966, 0xff009966,
	0xffff6666, 0xffcc6666, 0xff996666, 0xff666666, 0xff336666, 0xff006666,
	0xffff3366, 0xffcc3366, 0xff993366, 0xff663366, 0xff333366, 0xff003366,
	0xffff0066, 0xffcc0066, 0xff990066, 0xff660066, 0xff330066, 0xff000066,
	0xffffff33, 0xffccff33, 0xff99ff33, 0xff66ff33, 0xff33ff33, 0xff00ff33,
	0xffffcc33, 0xffcccc33, 0xff99cc33, 0xff66cc33, 0xff33cc33, 0xff00cc33,
	0xffff9933, 0xffcc9933, 0xff999933, 0xff669933, 0xff339933, 0xff009933,
	0xffff6633, 0xffcc6633, 0xff996633, 0xff666633, 0xff336633, 0xff006633,
	0xffff3333, 0xffcc3333, 0xff993333, 0xff663333, 0xff333333, 0xff003333,
	0xffff0033, 0xffcc0033, 0xff990033, 0xff660033, 0xff330033, 0xff000033,
	0xffffff00, 0xffccff00, 0xff99ff00, 0xff66ff00, 0xff33ff00, 0xff00ff00,
	0xffffcc00, 0xffcccc00, 0xff99cc00, 0xff66cc00, 0xff33cc00, 0xff00cc00,
	0xffff9900, 0xffcc9900, 0xff999900, 0xff669900, 0xff339900, 0xff009900,
	0xffff6600, 0xffcc6600, 0xff996600, 0xff666600, 0xff336600, 0xff006600,
	0xffff3300, 0xffcc3300, 0xff993300, 0xff663300, 0xff333300, 0xff003300,
	0xffff0000, 0xffcc0000, 0xff990000, 0xff660000, 0xff330000, 0xff0000ee,
	0xff0000dd, 0xff0000bb, 0xff0000aa, 0xff000088, 0xff000077, 0xff000055,
	0xff000044, 0xff000022, 0xff000011, 0xff00ee00, 0xff00dd00, 0xff00bb00,
	0xff00aa00, 0xff008800, 0xff007700, 0xff005500, 0xff004400, 0xff002200,
	0xff001100, 0xffee0000, 0xffdd0000, 0xffbb0000, 0xffaa0000, 0xff880000,
	0xff770000, 0xff550000, 0xff440000, 0xff220000, 0xff110000, 0xffeeeeee,
	0xffdddddd, 0xffbbbbbb, 0xffaaaaaa, 0xff888888, 0xff777777, 0xff555555,
	0xff444444, 0xff222222, 0xff111111,
];

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const VOX_MAGIC = 0x20584f56; // "VOX " as a little-endian uint32

/**
 * Parses a MagicaVoxel .vox ArrayBuffer (format versions 150 and 200).
 * Returns data for the first model found in the file.
 * Throws a descriptive Error on invalid input.
 */
export function parseVoxFile(buffer: ArrayBuffer): VoxParseResult {
	const view = new DataView(buffer);

	if (view.byteLength < 12) {
		throw new Error("File is too small to be a valid .vox file.");
	}
	if (view.getUint32(0, true) !== VOX_MAGIC) {
		throw new Error("Not a valid .vox file (magic bytes mismatch).");
	}
	// Bytes 4-7 are the version (150 or 200). Both use the same chunk layout
	// for the data we need, so no version gate is applied here.

	// --- Read MAIN chunk header (starts at byte 8) --------------------------
	let offset = 8;
	const mainId = readId(view, offset); offset += 4;
	if (mainId !== "MAIN") {
		throw new Error(".vox file is missing the expected MAIN chunk.");
	}
	const mainContentSize = view.getUint32(offset, true); offset += 4;
	const mainChildrenSize = view.getUint32(offset, true); offset += 4;

	offset += mainContentSize; // skip MAIN content (always 0 bytes in practice)

	const mainEnd = offset + mainChildrenSize;

	// --- Walk MAIN's children -----------------------------------------------
	let size: { x: number; y: number; z: number } | null = null;
	let rawData: Uint8Array | null = null;
	let palette: number[] = DEFAULT_PALETTE;

	while (offset < mainEnd) {
		const id = readId(view, offset); offset += 4;
		const contentSize = view.getUint32(offset, true); offset += 4;
		const childrenSize = view.getUint32(offset, true); offset += 4;
		const contentStart = offset;

		if (id === "SIZE" && size === null) {
			// 12 bytes: x_size, y_size, z_size (each uint32 LE)
			size = {
				x: view.getUint32(offset,      true),
				y: view.getUint32(offset + 4,  true),
				z: view.getUint32(offset + 8,  true),
			};
			offset += contentSize;

		} else if (id === "XYZI" && size !== null && rawData === null) {
			// 4 bytes: num_voxels, then num_voxels * 4 bytes of [x, y, z, i] quads.
			// We remap axes here: VOX(x,y,z) -> Quest-Net(x, elevation=z, depth=mirrored_y).
			// The VOX Y axis is mirrored (see comment at top of file) so that the
			// model's front face stays front-facing after import.
			const numVoxels = view.getUint32(offset, true);
			const remapped = new Uint8Array(numVoxels * 4);
			const sizeY = size.y; // captured for mirror calculation below
			for (let i = 0; i < numVoxels; i++) {
				const base = contentStart + 4 + i * 4;
				remapped[i * 4]     = view.getUint8(base);                         // Quest-Net x  <- VOX x
				remapped[i * 4 + 1] = view.getUint8(base + 2);                     // Quest-Net y  <- VOX z (elevation)
				remapped[i * 4 + 2] = sizeY - 1 - view.getUint8(base + 1);        // Quest-Net z  <- mirrored VOX y
				remapped[i * 4 + 3] = view.getUint8(base + 3);                     // color index unchanged
			}
			rawData = remapped;
			offset += contentSize;

		} else if (id === "RGBA") {
			// 256 * 4 bytes of RGBA colors. Build a 1-indexed array so that
			// XYZI color index c maps directly to palette[c].
			// (RGBA[0] in the file -> palette[1], ..., RGBA[254] -> palette[255];
			//  palette[256] exists but is never referenced by XYZI.)
			const p: number[] = [0];
			for (let j = 0; j < 256; j++) {
				p[j + 1] = view.getUint32(offset + j * 4, true);
			}
			palette = p;
			offset += contentSize;

		} else {
			// Unknown or unwanted chunk (PACK, nTRN, nGRP, nSHP, MATL, LAYR, ...).
			// Skip content AND children so nested chunks don't corrupt the offset.
			offset += contentSize + childrenSize;
		}

		// Once we have the first model's geometry and the palette we can stop.
		// (If RGBA hasn't appeared yet we keep walking -- it usually comes last
		// in v200 files, after all the scene-graph chunks.)
		if (size !== null && rawData !== null && palette !== DEFAULT_PALETTE) break;
	}

	if (size === null) throw new Error(".vox file contains no SIZE chunk.");
	if (rawData === null) throw new Error(".vox file contains no XYZI chunk.");

	return {
		// voxWidth/Length/Height are in Quest-Net axis order post-remap
		voxWidth:  size.x, // VOX x -> Quest-Net x (width)
		voxLength: size.y, // VOX y -> Quest-Net z (length/depth)
		voxHeight: size.z, // VOX z -> Quest-Net y (elevation)
		rawData,
		palette,
	};
}

function readId(view: DataView, offset: number): string {
	return (
		String.fromCharCode(view.getUint8(offset)) +
		String.fromCharCode(view.getUint8(offset + 1)) +
		String.fromCharCode(view.getUint8(offset + 2)) +
		String.fromCharCode(view.getUint8(offset + 3))
	);
}

// ---------------------------------------------------------------------------
// Resolution options
// ---------------------------------------------------------------------------

/**
 * Returns one option per resolution level (MIN to MAX) describing
 * the resulting tactical dimensions and whether they fit within the
 * terrain size limits.
 */
export function getVoxResolutionOptions(parsed: VoxParseResult): VoxResolutionOption[] {
	const options: VoxResolutionOption[] = [];
	for (let r = MIN_VOXEL_TERRAIN_RESOLUTION; r <= MAX_VOXEL_TERRAIN_RESOLUTION; r++) {
		const tacticalWidth  = Math.ceil(parsed.voxWidth  / r);
		const tacticalLength = Math.ceil(parsed.voxLength / r);
		const tacticalHeight = Math.ceil(parsed.voxHeight / r);
		options.push({
			resolution: r,
			tacticalWidth,
			tacticalLength,
			tacticalHeight,
			fits:
				tacticalWidth  <= MAX_VOXEL_TERRAIN_WIDTH  &&
				tacticalLength <= MAX_VOXEL_TERRAIN_LENGTH &&
				tacticalHeight <= MAX_VOXEL_TERRAIN_HEIGHT,
		});
	}
	return options;
}

// ---------------------------------------------------------------------------
// Terrain builder
// ---------------------------------------------------------------------------

/**
 * Converts a parsed VOX file into the voxel/dimension fields of a
 * VoxelTerrain at the given resolution.  Id and Name must be assigned
 * by the caller.
 *
 * @param parsed  - Output of parseVoxFile.
 * @param resolution - Must be one of the `fits: true` options from
 *                     getVoxResolutionOptions.
 */
export function buildTerrainFromVox(
	parsed: VoxParseResult,
	resolution: number,
): Pick<VoxelTerrain, "Width" | "Length" | "Height" | "Resolution" | "Voxels"> {
	// Build a 256-entry lookup: VOX palette index -> Quest-Net palette index.
	// This avoids an O(65) nearest-neighbor search per voxel.
	const colorLookup = buildColorLookup(parsed.palette);

	const { rawData } = parsed;
	const voxels = [];

	for (let i = 0; i < rawData.length; i += 4) {
		const ci = rawData[i + 3];
		if (ci === 0) continue; // index 0 = empty, skip
		voxels.push({
			x:     rawData[i],
			y:     rawData[i + 1],
			z:     rawData[i + 2],
			color: colorLookup[ci],
		});
	}

	return {
		Width:      Math.ceil(parsed.voxWidth  / resolution),
		Length:     Math.ceil(parsed.voxLength / resolution),
		Height:     Math.ceil(parsed.voxHeight / resolution),
		Resolution: resolution,
		Voxels:     encodeVoxels(voxels),
	};
}

// ---------------------------------------------------------------------------
// Color lookup table
// ---------------------------------------------------------------------------

/**
 * Builds a 256-entry Uint8Array mapping each VOX palette index (0-255) to
 * the nearest Quest-Net terrain palette index.
 *
 * VOX palette entries are packed little-endian uint32: 0xAABBGGRR.
 * voxelColorToTerrainPaletteIndex expects a 24-bit 0xRRGGBB number.
 *
 * Index 0 is mapped to DEFAULT_TERRAIN_COLOR_INDEX (it should never
 * appear in XYZI data, but is set defensively).
 * Fully transparent entries (alpha === 0) are also mapped to the default.
 */
function buildColorLookup(palette: number[]): Uint8Array {
	const lookup = new Uint8Array(256);
	lookup[0] = DEFAULT_TERRAIN_COLOR_INDEX;

	for (let ci = 1; ci <= 255; ci++) {
		const packed = palette[ci] ?? 0;
		const alpha = (packed >>> 24) & 0xff;
		if (alpha === 0) {
			lookup[ci] = DEFAULT_TERRAIN_COLOR_INDEX;
			continue;
		}
		// Unpack 0xAABBGGRR -> convert to 0xRRGGBB
		const r = (packed)       & 0xff;
		const g = (packed >>> 8) & 0xff;
		const b = (packed >>> 16) & 0xff;
		lookup[ci] = voxelColorToTerrainPaletteIndex((r << 16) | (g << 8) | b);
	}

	return lookup;
}
