import type { Voxel, VoxelTerrain } from "../domains/VoxelTerrain/VoxelTerrain";
import {
	DEFAULT_TERRAIN_COLOR_INDEX,
	TERRAIN_PALETTE,
	getTerrainColorByIndex,
} from "./TerrainPaletteUtils";
import { decodeVoxels, emptyVoxels, encodeVoxels } from "./VoxelDataUtils";
import { getVoxelTerrainResolution } from "./VoxelTerrainUtils";

export const MAX_VOXEL_TERRAIN_HEIGHT = 16;
export const MIN_VOXEL_TERRAIN_HEIGHT = 1;
export const DEFAULT_VOXEL_TERRAIN_HEIGHT = 8;
export const MIN_VOXEL_TERRAIN_RESOLUTION = 1;
export const MAX_VOXEL_TERRAIN_RESOLUTION = 3;

export interface VoxelTerrainEditorMaps {
	heightMap: number[][];
	colorMap: number[][];
}

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

export function terrainPaletteIndexToVoxelColor(index: number): number {
	return parseInt(getTerrainColorByIndex(index).slice(1), 16);
}

export function voxelColorToTerrainPaletteIndex(color: number): number {
	const rgb = hexToRgb(numberToHex(color));
	let bestIndex = DEFAULT_TERRAIN_COLOR_INDEX;
	let bestDistance = Infinity;

	for (let index = 0; index < TERRAIN_PALETTE.length; index++) {
		const candidate = hexToRgb(TERRAIN_PALETTE[index]);
		const dr = rgb.r - candidate.r;
		const dg = rgb.g - candidate.g;
		const db = rgb.b - candidate.b;
		const distance = dr * dr + dg * dg + db * db;

		if (distance < bestDistance) {
			bestDistance = distance;
			bestIndex = index;
		}
	}

	return bestIndex;
}

export function normalizeVoxelPaletteIndex(color: number): number {
	const index = Math.floor(color);
	if (index >= 0 && index < TERRAIN_PALETTE.length) return index;

	return voxelColorToTerrainPaletteIndex(color);
}

export function voxelTerrainToEditorMaps(
	terrain: VoxelTerrain
): VoxelTerrainEditorMaps {
	const resolution = getVoxelTerrainResolution(terrain);
	const heightMap: number[][] = Array.from({ length: terrain.Length }, () =>
		Array.from({ length: terrain.Width }, () => 0)
	);
	const colorMap: number[][] = Array.from({ length: terrain.Length }, () =>
		Array.from({ length: terrain.Width }, () => DEFAULT_TERRAIN_COLOR_INDEX)
	);

	// Single pass: find the highest voxel in each tactical tile.
	const topVoxels = new Map<number, Voxel>(); // key: tileX + tileZ * Width
	for (const voxel of decodeVoxels(terrain.Voxels)) {
		const tileX = Math.floor(voxel.x / resolution);
		const tileZ = Math.floor(voxel.z / resolution);
		const key = tileX + tileZ * terrain.Width;
		const current = topVoxels.get(key);
		if (!current || voxel.y > current.y) {
			topVoxels.set(key, voxel);
		}
	}

	for (let z = 0; z < terrain.Length; z++) {
		for (let x = 0; x < terrain.Width; x++) {
			const topVoxel = topVoxels.get(x + z * terrain.Width);
			if (!topVoxel) continue;
			heightMap[z][x] = clamp(topVoxel.y + 1, 0, terrain.Height * resolution);
			colorMap[z][x] = normalizeVoxelPaletteIndex(topVoxel.color);
		}
	}

	return { heightMap, colorMap };
}

export function editorMapsToVoxelTerrain(
	terrain: VoxelTerrain,
	maps: VoxelTerrainEditorMaps
): VoxelTerrain {
	const resolution = clampVoxelTerrainResolution(terrain.Resolution);
	const tacticalHeight = clampVoxelTerrainHeight(terrain.Height);
	const maxResolvedHeight = tacticalHeight * resolution;
	const voxels: Voxel[] = [];

	for (let z = 0; z < terrain.Length; z++) {
		for (let x = 0; x < terrain.Width; x++) {
			const height = clamp(
				Math.floor(maps.heightMap[z]?.[x] ?? 0),
				0,
				maxResolvedHeight
			);
			const color = normalizeVoxelPaletteIndex(
				maps.colorMap[z]?.[x] ?? DEFAULT_TERRAIN_COLOR_INDEX
			);

			for (let subZ = 0; subZ < resolution; subZ++) {
				for (let subX = 0; subX < resolution; subX++) {
					for (let y = 0; y < height; y++) {
						voxels.push({
							x: x * resolution + subX,
							y,
							z: z * resolution + subZ,
							color,
						});
					}
				}
			}
		}
	}

	return {
		...terrain,
		Height: tacticalHeight,
		Resolution: resolution,
		Voxels: encodeVoxels(voxels),
	};
}

function getRescaledVoxelRange(
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
	terrain: VoxelTerrain,
	nextShape: {
		width: number;
		length: number;
		height: number;
		resolution: number;
	}
): VoxelTerrain {
	const oldResolution = getVoxelTerrainResolution(terrain);
	const newResolution = clampVoxelTerrainResolution(nextShape.resolution);
	const nextHeight = clampVoxelTerrainHeight(nextShape.height);
	const nextWidth = clamp(Math.floor(nextShape.width) || 1, 1, 48);
	const nextLength = clamp(Math.floor(nextShape.length) || 1, 1, 48);
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
}): VoxelTerrain {
	const height = clamp(
		Math.floor(params.height ?? DEFAULT_VOXEL_TERRAIN_HEIGHT),
		0,
		MAX_VOXEL_TERRAIN_HEIGHT
	);
	const maxHeight = clamp(
		Math.floor(params.maxHeight ?? MAX_VOXEL_TERRAIN_HEIGHT),
		MIN_VOXEL_TERRAIN_HEIGHT,
		MAX_VOXEL_TERRAIN_HEIGHT
	);
	const colorIndex = params.colorIndex ?? DEFAULT_TERRAIN_COLOR_INDEX;
	const heightMap: number[][] = Array.from({ length: params.length }, () =>
		Array.from({ length: params.width }, () => height)
	);
	const colorMap: number[][] = Array.from({ length: params.length }, () =>
		Array.from({ length: params.width }, () => colorIndex)
	);
	const terrain: VoxelTerrain = {
		Id: params.id,
		Name: params.name,
		Width: params.width,
		Length: params.length,
		Height: maxHeight,
		Resolution: 1,
		Voxels: emptyVoxels(),
		Tags: params.tags,
	};

	return editorMapsToVoxelTerrain(terrain, { heightMap, colorMap });
}

export function getMostCommonVoxelTerrainColor(terrain: VoxelTerrain): string {
	const colorCounts = new Map<number, number>();

	for (const voxel of decodeVoxels(terrain.Voxels)) {
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
