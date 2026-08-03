// Parses MagicaVoxel .vox files and converts the first model to
// VoxelTerrain-compatible data.
//
// MagicaVoxel uses Z-up while Quest-Net uses Y-up. The remaining depth axis is
// mirrored so models keep the same front-facing orientation:
//   VOX (x, y, z) -> Quest-Net (x, z, SIZE.y - 1 - y)

import { VOXLoader } from "three/examples/jsm/loaders/VOXLoader.js";
import type {
	EncodedVoxelSVO,
	VoxelTerrain,
} from "../../../domains/VoxelTerrain/VoxelTerrain";
import { DEFAULT_TERRAIN_COLOR_INDEX } from "../palette/TerrainPaletteUtils";
import { encodeVoxels } from "../data/VoxelDataUtils";
import {
	maxTacticalDimensionForResolution,
	MAX_VOXEL_TERRAIN_RESOLUTION,
	MIN_VOXEL_TERRAIN_RESOLUTION,
	voxelColorToTerrainPaletteIndex,
} from "../editor/VoxelTerrainEditorUtils";

/** First-model VOX data with coordinates already remapped for Quest-Net. */
export interface VoxParseResult {
	voxWidth: number;
	voxLength: number;
	voxHeight: number;
	/** Flat [x, y, z, colorIndex] quads in Quest-Net axis order. */
	rawData: Uint8Array;
	/** 1-indexed packed colors in 0xAABBGGRR format. */
	palette: number[];
}

export interface VoxResolutionOption {
	resolution: number;
	tacticalWidth: number;
	tacticalLength: number;
	tacticalHeight: number;
	fits: boolean;
}

const VOX_MAGIC = 0x20584f56;

/**
 * Parse the first model in a MagicaVoxel file. Three.js owns the file-format
 * parsing; this adapter keeps only Quest-Net's validation and axis convention.
 */
export function parseVoxFile(buffer: ArrayBuffer): VoxParseResult {
	if (buffer.byteLength < 12) {
		throw new Error("File is too small to be a valid .vox file.");
	}

	const view = new DataView(buffer);
	if (view.getUint32(0, true) !== VOX_MAGIC) {
		throw new Error("Not a valid .vox file (magic bytes mismatch).");
	}

	const version = view.getUint32(4, true);
	if (version !== 150 && version !== 200) {
		throw new Error(`Unsupported .vox file version: ${version}.`);
	}

	let result: ReturnType<VOXLoader["parse"]> | undefined;
	try {
		result = new VOXLoader().parse(buffer);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Could not parse .vox file: ${message}`);
	}

	const chunk = result?.chunks[0];
	if (!chunk) throw new Error(".vox file contains no SIZE chunk.");
	if (!chunk.data) throw new Error(".vox file contains no XYZI chunk.");
	if (chunk.data.length % 4 !== 0) {
		throw new Error(".vox file contains malformed XYZI data.");
	}

	const { size, data, palette } = chunk;
	const rawData = new Uint8Array(data.length);
	for (let i = 0; i < data.length; i += 4) {
		rawData[i] = data[i];
		rawData[i + 1] = data[i + 2];
		rawData[i + 2] = size.y - 1 - data[i + 1];
		rawData[i + 3] = data[i + 3];
	}

	return {
		voxWidth: size.x,
		voxLength: size.y,
		voxHeight: size.z,
		rawData,
		palette,
	};
}

/** Describe each supported resolution and whether its terrain dimensions fit. */
export function getVoxResolutionOptions(
	parsed: VoxParseResult
): VoxResolutionOption[] {
	const options: VoxResolutionOption[] = [];
	for (
		let resolution = MIN_VOXEL_TERRAIN_RESOLUTION;
		resolution <= MAX_VOXEL_TERRAIN_RESOLUTION;
		resolution++
	) {
		const tacticalWidth = Math.ceil(parsed.voxWidth / resolution);
		const tacticalLength = Math.ceil(parsed.voxLength / resolution);
		const tacticalHeight = Math.ceil(parsed.voxHeight / resolution);
		const maxDimension = maxTacticalDimensionForResolution(resolution);
		options.push({
			resolution,
			tacticalWidth,
			tacticalLength,
			tacticalHeight,
			fits:
				tacticalWidth <= maxDimension &&
				tacticalLength <= maxDimension &&
				tacticalHeight <= maxDimension,
		});
	}
	return options;
}

/** Convert parsed VOX data into the terrain fields selected by the caller. */
export function buildTerrainFromVox(
	parsed: VoxParseResult,
	resolution: number,
): Pick<VoxelTerrain, "Width" | "Length" | "Height" | "Resolution"> & {
	Voxels: EncodedVoxelSVO;
} {
	const colorLookup = buildColorLookup(parsed.palette);
	const voxels = [];

	for (let i = 0; i < parsed.rawData.length; i += 4) {
		const colorIndex = parsed.rawData[i + 3];
		if (colorIndex === 0) continue;
		voxels.push({
			x: parsed.rawData[i],
			y: parsed.rawData[i + 1],
			z: parsed.rawData[i + 2],
			color: colorLookup[colorIndex],
		});
	}

	return {
		Width: Math.ceil(parsed.voxWidth / resolution),
		Length: Math.ceil(parsed.voxLength / resolution),
		Height: Math.ceil(parsed.voxHeight / resolution),
		Resolution: resolution,
		Voxels: encodeVoxels(voxels),
	};
}

/** Build a VOX palette-index to Quest-Net palette-index lookup table. */
function buildColorLookup(palette: number[]): Uint8Array {
	const lookup = new Uint8Array(256);
	lookup[0] = DEFAULT_TERRAIN_COLOR_INDEX;

	for (let colorIndex = 1; colorIndex <= 255; colorIndex++) {
		const packed = palette[colorIndex] ?? 0;
		const alpha = (packed >>> 24) & 0xff;
		if (alpha === 0) {
			lookup[colorIndex] = DEFAULT_TERRAIN_COLOR_INDEX;
			continue;
		}

		const red = packed & 0xff;
		const green = (packed >>> 8) & 0xff;
		const blue = (packed >>> 16) & 0xff;
		lookup[colorIndex] = voxelColorToTerrainPaletteIndex(
			(red << 16) | (green << 8) | blue
		);
	}

	return lookup;
}
