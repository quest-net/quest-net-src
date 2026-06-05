import {
	MAX_HEIGHT,
	createDefaultVoxelTerrainBackground,
	createDefaultVoxelTerrainLighting,
	type EditableVoxelTerrain,
	type Voxel,
} from "../../../domains/VoxelTerrain/VoxelTerrain";
import {
	DEFAULT_TERRAIN_COLOR_INDEX,
	TERRAIN_PALETTE,
	getTerrainColorByIndex,
} from "../palette/TerrainPaletteUtils";
import { getSpecialMaterialEditorColor } from "../../../components/Map/Terrain/materials";
import { decodeVoxels, encodeVoxels } from "../data/VoxelDataUtils";
import { getVoxelTerrainResolution } from "../data/VoxelTerrainUtils";

export const MAX_VOXEL_TERRAIN_WIDTH = 64;
export const MAX_VOXEL_TERRAIN_LENGTH = 64;
export const MAX_VOXEL_TERRAIN_HEIGHT = MAX_HEIGHT;
export const MIN_VOXEL_TERRAIN_HEIGHT = 1;
export const DEFAULT_VOXEL_TERRAIN_HEIGHT = 8;
export const DEFAULT_VOXEL_TERRAIN_MAX_HEIGHT = 16;
export const MIN_VOXEL_TERRAIN_RESOLUTION = 1;
export const MAX_VOXEL_TERRAIN_RESOLUTION = 4;

const clamp = (value: number, min: number, max: number) =>
	Math.max(min, Math.min(max, value));

export function clampVoxelTerrainHeight(height: number): number {
	return clamp(
		Math.floor(height) || MIN_VOXEL_TERRAIN_HEIGHT,
		MIN_VOXEL_TERRAIN_HEIGHT,
		MAX_VOXEL_TERRAIN_HEIGHT
	);
}

export function clampVoxelTerrainResolution(resolution: number | undefined): number {
	return clamp(
		Math.floor(resolution ?? MIN_VOXEL_TERRAIN_RESOLUTION) ||
			MIN_VOXEL_TERRAIN_RESOLUTION,
		MIN_VOXEL_TERRAIN_RESOLUTION,
		MAX_VOXEL_TERRAIN_RESOLUTION
	);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const normalized = hex.replace("#", "");
	return {
		r: parseInt(normalized.slice(0, 2), 16),
		g: parseInt(normalized.slice(2, 4), 16),
		b: parseInt(normalized.slice(4, 6), 16),
	};
}

function numberToHex(color: number): string {
	return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// OKLab perceptual color distance
// ---------------------------------------------------------------------------
// Euclidean RGB distance gives poor results when matching natural/desaturated
// colors (e.g. olive greens, warm browns) against a palette generated in
// OKLCh space, because the palette colors are "pure" in each hue direction
// while real-world colors have mixed RGB channels.  A grey can end up closer
// to an olive green than the correct green palette entry in raw RGB space.
//
// OKLab distance correlates with how humans actually perceive color difference,
// so the nearest-neighbor search returns the right hue bucket instead of grey.
// ---------------------------------------------------------------------------

function srgbChannelToLinear(c: number): number {
	const v = c / 255;
	return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
	const rl = srgbChannelToLinear(r);
	const gl = srgbChannelToLinear(g);
	const bl = srgbChannelToLinear(b);

	const l = Math.cbrt(0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl);
	const m = Math.cbrt(0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl);
	const s = Math.cbrt(0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl);

	return [
		0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
	];
}

export function terrainPaletteIndexToVoxelColor(index: number): number {
	// Special materials (indices 240-255) use the swatch color declared in
	// their material definition file, not a fallback palette lookup. This
	// keeps each material file the single source of truth for its color.
	const special = getSpecialMaterialEditorColor(index);
	if (special !== undefined) return special;
	return parseInt(getTerrainColorByIndex(index).slice(1), 16);
}

export function voxelColorToTerrainPaletteIndex(color: number): number {
	const { r, g, b } = hexToRgb(numberToHex(color));
	const [L1, a1, b1] = rgbToOklab(r, g, b);

	let bestIndex = DEFAULT_TERRAIN_COLOR_INDEX;
	let bestDistance = Infinity;

	for (let index = 0; index < TERRAIN_PALETTE.length; index++) {
		const candidate = hexToRgb(TERRAIN_PALETTE[index]);
		const [L2, a2, b2] = rgbToOklab(candidate.r, candidate.g, candidate.b);
		const dL = L1 - L2;
		const da = a1 - a2;
		const db = b1 - b2;
		const distance = dL * dL + da * da + db * db;

		if (distance < bestDistance) {
			bestDistance = distance;
			bestIndex = index;
		}
	}

	return bestIndex;
}

export function normalizeVoxelPaletteIndex(color: number): number {
	const index = Math.floor(color);
	// Normal palette indices (0-239) and special material indices (240-255)
	// are all valid voxel data values -- pass them through unchanged.
	if (index >= 0 && index <= 255) return index;
	// Fallback: treat as a legacy raw RGB hex value and find the nearest
	// palette color (handles old saves that stored color values directly).
	return voxelColorToTerrainPaletteIndex(color);
}

export function getRescaledVoxelRange(
	index: number,
	oldResolution: number,
	newResolution: number,
	maxExclusive: number
): { start: number; end: number } | null {
	const start = Math.floor((index * newResolution) / oldResolution);
	const end = Math.ceil(((index + 1) * newResolution) / oldResolution);
	const clampedStart = clamp(start, 0, maxExclusive);
	const clampedEnd = clamp(end, clampedStart, maxExclusive);

	if (clampedStart >= clampedEnd) return null;
	return { start: clampedStart, end: clampedEnd };
}

export function reshapeVoxelTerrainForEditor(
	terrain: EditableVoxelTerrain,
	nextShape: {
		width: number;
		length: number;
		height: number;
		resolution: number;
	}
): EditableVoxelTerrain {
	const oldResolution = getVoxelTerrainResolution(terrain);
	const newResolution = clampVoxelTerrainResolution(nextShape.resolution);
	const nextHeight = clampVoxelTerrainHeight(nextShape.height);
	const nextWidth = clamp(Math.floor(nextShape.width) || 1, 1, MAX_VOXEL_TERRAIN_WIDTH);
	const nextLength = clamp(Math.floor(nextShape.length) || 1, 1, MAX_VOXEL_TERRAIN_LENGTH);
	const nextResolvedWidth = nextWidth * newResolution;
	const nextResolvedLength = nextLength * newResolution;
	const nextResolvedHeight = nextHeight * newResolution;
	const voxels: Voxel[] = [];

	for (const voxel of decodeVoxels(terrain.Voxels)) {
		const xRange = getRescaledVoxelRange(
			voxel.x,
			oldResolution,
			newResolution,
			nextResolvedWidth
		);
		const yRange = getRescaledVoxelRange(
			voxel.y,
			oldResolution,
			newResolution,
			nextResolvedHeight
		);
		const zRange = getRescaledVoxelRange(
			voxel.z,
			oldResolution,
			newResolution,
			nextResolvedLength
		);

		if (!xRange || !yRange || !zRange) continue;

		for (let z = zRange.start; z < zRange.end; z++) {
			for (let y = yRange.start; y < yRange.end; y++) {
				for (let x = xRange.start; x < xRange.end; x++) {
					voxels.push({
						x,
						y,
						z,
						color: normalizeVoxelPaletteIndex(voxel.color),
					});
				}
			}
		}
	}

	return {
		...terrain,
		Width: nextWidth,
		Length: nextLength,
		Height: nextHeight,
		Resolution: newResolution,
		Voxels: encodeVoxels(voxels),
	};
}

export function createFlatVoxelTerrain(params: {
	id: string;
	name: string;
	width: number;
	length: number;
	height?: number;
	maxHeight?: number;
	colorIndex?: number;
	tags?: string[];
}): EditableVoxelTerrain {
	const height = clamp(
		Math.floor(params.height ?? DEFAULT_VOXEL_TERRAIN_HEIGHT),
		0,
		MAX_VOXEL_TERRAIN_HEIGHT
	);
	const maxHeight = clamp(
		Math.floor(params.maxHeight ?? DEFAULT_VOXEL_TERRAIN_MAX_HEIGHT),
		MIN_VOXEL_TERRAIN_HEIGHT,
		MAX_VOXEL_TERRAIN_HEIGHT
	);
	const fillHeight = clamp(height, 0, maxHeight);
	const colorIndex = normalizeVoxelPaletteIndex(
		params.colorIndex ?? DEFAULT_TERRAIN_COLOR_INDEX
	);
	const voxels: Voxel[] = [];

	for (let z = 0; z < params.length; z++) {
		for (let x = 0; x < params.width; x++) {
			for (let y = 0; y < fillHeight; y++) {
				voxels.push({ x, y, z, color: colorIndex });
			}
		}
	}

	return {
		Id: params.id,
		Name: params.name,
		Width: params.width,
		Length: params.length,
		Height: maxHeight,
		Resolution: 1,
		Voxels: encodeVoxels(voxels),
		Lighting: createDefaultVoxelTerrainLighting(),
		Background: createDefaultVoxelTerrainBackground(),
		Tags: params.tags,
	};
}

export function getMostCommonVoxelTerrainColor(voxels: string): string {
	const colorCounts = new Map<number, number>();

	for (const voxel of decodeVoxels(voxels)) {
		const color = normalizeVoxelPaletteIndex(voxel.color);
		colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
	}

	let mostCommonColor = DEFAULT_TERRAIN_COLOR_INDEX;
	let maxCount = 0;
	for (const [color, count] of colorCounts) {
		if (count > maxCount) {
			mostCommonColor = color;
			maxCount = count;
		}
	}

	const hex = getTerrainColorByIndex(mostCommonColor);
	const { r, g, b } = hexToRgb(hex);
	const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

	return luminance > 0.86 ? "black" : hex;
}
