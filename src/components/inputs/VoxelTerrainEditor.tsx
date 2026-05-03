import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { VoxelTerrain } from "../../domains/VoxelTerrain/VoxelTerrain";
import {
	DEFAULT_TERRAIN_COLOR_INDEX,
	TERRAIN_PALETTE_FAMILIES,
	getTerrainColorByIndex,
	getTerrainPaletteIndex,
} from "../../utils/TerrainPaletteUtils";
import {
	type VoxelTerrainEditorMaps,
	clampVoxelTerrainResolution,
	editorMapsToVoxelTerrain,
	voxelTerrainToEditorMaps,
} from "../../utils/VoxelTerrainEditorUtils";
import {
	applyFlatten,
	applyRandomHills,
	applyRandomTrees,
	applySmooth,
} from "../../utils/TerrainUtils";
import { decodeVoxels, encodeVoxels } from "../../utils/VoxelDataUtils";
import HeightRangeInput, { type HeightSelection } from "./HeightRangeInput";

type EditorMode = "normal" | "sculpt";
type NormalTool = "paint" | "eyedropper" | "raise" | "lower" | "set";
type SculptTool = "paint" | "set" | "clear";
type BrushShape = "square" | "round";

interface VoxelTerrainEditorProps {
	terrain: VoxelTerrain;
	readOnly?: boolean;
	onChange(next: VoxelTerrain): void;
}

interface HistorySnapshot {
	terrain: VoxelTerrain;
}

const GRID_GAP = 1;
const MAX_HISTORY = 50;
const MIN_TILE_PX = 4;
const MAX_TILE_PX = 24;
const DETAIL_MIN_TILE_PX = 2;
const DETAIL_MAX_TILE_PX = 48;

const NORMAL_TOOL_OPTIONS: Array<{
	value: NormalTool;
	label: string;
	icon: string;
	title: string;
}> = [
	{ value: "paint", label: "Paint", icon: "icon-[mdi--brush]", title: "Paint color" },
	{
		value: "eyedropper",
		label: "Pick",
		icon: "icon-[mdi--eyedropper-variant]",
		title: "Pick color from terrain",
	},
	{ value: "raise", label: "Raise", icon: "icon-[mdi--arrow-up-bold]", title: "Raise terrain" },
	{ value: "lower", label: "Lower", icon: "icon-[mdi--arrow-down-bold]", title: "Lower terrain" },
	{ value: "set", label: "Set", icon: "icon-[mdi--ruler]", title: "Set fixed height" },
];

const SCULPT_TOOL_OPTIONS: Array<{
	value: SculptTool;
	label: string;
	icon: string;
	title: string;
}> = [
	{ value: "paint", label: "Paint", icon: "icon-[mdi--brush]", title: "Paint existing voxels" },
	{ value: "set", label: "Set", icon: "icon-[mdi--cube-outline]", title: "Set voxels" },
	{ value: "clear", label: "Clear", icon: "icon-[mdi--eraser]", title: "Clear voxels" },
];

const BRUSH_OPTIONS: Array<{ size: number; shape: BrushShape }> = [
	{ size: 1, shape: "square" },
	{ size: 2, shape: "round" },
	{ size: 2, shape: "square" },
	{ size: 3, shape: "round" },
	{ size: 3, shape: "square" },
	{ size: 4, shape: "round" },
	{ size: 4, shape: "square" },
	{ size: 5, shape: "round" },
	{ size: 5, shape: "square" },
];

const clamp = (value: number, min: number, max: number) =>
	Math.max(min, Math.min(max, value));

function cloneTerrain(terrain: VoxelTerrain): VoxelTerrain {
	return { ...terrain, Tags: terrain.Tags ? [...terrain.Tags] : terrain.Tags };
}

function isSameEditorTerrain(a: VoxelTerrain, b: VoxelTerrain): boolean {
	return (
		a.Id === b.Id &&
		a.Width === b.Width &&
		a.Length === b.Length &&
		a.Height === b.Height &&
		(a.Resolution ?? 1) === (b.Resolution ?? 1) &&
		a.Voxels === b.Voxels
	);
}

function clone2DNumber(arr: number[][]): number[][] {
	return arr.map((row) => row.slice());
}

function getVoxelPositionKey(x: number, y: number, z: number): number {
	return x + y * 256 + z * 65536;
}

function cloneVoxelMap(encoded: string): Map<number, number> {
	const map = new Map<number, number>();
	for (const voxel of decodeVoxels(encoded)) {
		map.set(getVoxelPositionKey(voxel.x, voxel.y, voxel.z), voxel.color);
	}
	return map;
}

function encodeVoxelMap(map: Map<number, number>): string {
	return encodeVoxels(
		Array.from(map, ([position, color]) => ({
			x: position & 0xff,
			y: (position >>> 8) & 0xff,
			z: (position >>> 16) & 0xff,
			color,
		}))
	);
}

function getTileKey(x: number, y: number): string {
	return `${x},${y}`;
}

function parseTileKey(key: string): { x: number; y: number } | null {
	const [x, y] = key.split(",").map(Number);
	if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
	return { x, y };
}

function applySquareBrush(
	cx: number,
	cy: number,
	size: number,
	width: number,
	length: number,
	fn: (x: number, y: number) => void
) {
	const r = Math.max(0, size - 1);
	const x0 = clamp(cx - r, 0, width - 1);
	const x1 = clamp(cx + r, 0, width - 1);
	const y0 = clamp(cy - r, 0, length - 1);
	const y1 = clamp(cy + r, 0, length - 1);

	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			fn(x, y);
		}
	}
}

function isRoundBrushTile(cx: number, cy: number, x: number, y: number, size: number) {
	const r = Math.max(0, size - 1);
	const dx = x - cx;
	const dy = y - cy;
	return dx * dx + dy * dy <= r * r;
}

function applyBrush(
	cx: number,
	cy: number,
	size: number,
	shape: BrushShape,
	width: number,
	length: number,
	fn: (x: number, y: number) => void
) {
	applySquareBrush(cx, cy, size, width, length, (x, y) => {
		if (shape === "round" && !isRoundBrushTile(cx, cy, x, y, size)) return;
		fn(x, y);
	});
}

function getBrushTiles(
	cx: number,
	cy: number,
	size: number,
	shape: BrushShape,
	width: number,
	length: number
): Set<string> {
	const tiles = new Set<string>();
	applyBrush(cx, cy, size, shape, width, length, (x, y) => {
		tiles.add(getTileKey(x, y));
	});
	return tiles;
}

function getMirroredTileCoords(
	x: number,
	y: number,
	width: number,
	length: number,
	mirrorHorizontal: boolean,
	mirrorVertical: boolean
): Array<{ x: number; y: number }> {
	const coords = [{ x, y }];
	if (mirrorHorizontal) coords.push({ x: width - 1 - x, y });
	if (mirrorVertical) coords.push({ x, y: length - 1 - y });
	if (mirrorHorizontal && mirrorVertical) {
		coords.push({ x: width - 1 - x, y: length - 1 - y });
	}

	const seen = new Set<string>();
	return coords.filter((coord) => {
		const key = getTileKey(coord.x, coord.y);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function getTileKeySet(tiles: Array<{ x: number; y: number }>): Set<string> {
	return new Set(tiles.map((tile) => getTileKey(tile.x, tile.y)));
}

function getAllTileCoords(width: number, length: number): Array<{ x: number; y: number }> {
	const tiles: Array<{ x: number; y: number }> = [];
	for (let y = 0; y < length; y++) {
		for (let x = 0; x < width; x++) {
			tiles.push({ x, y });
		}
	}
	return tiles;
}

function isVoxelInAnyTile(
	voxelX: number,
	voxelZ: number,
	resolution: number,
	tileKeys: Set<string>
): boolean {
	return tileKeys.has(
		getTileKey(Math.floor(voxelX / resolution), Math.floor(voxelZ / resolution))
	);
}

function replaceVoxelTerrainColumns(
	terrain: VoxelTerrain,
	maps: VoxelTerrainEditorMaps,
	tiles: Array<{ x: number; y: number }>
): VoxelTerrain {
	const resolution = clampVoxelTerrainResolution(terrain.Resolution);
	const maxHeight = terrain.Height * resolution;
	const tileKeys = getTileKeySet(tiles);
	const voxels = Array.from(decodeVoxels(terrain.Voxels)).filter(
		(voxel) => !isVoxelInAnyTile(voxel.x, voxel.z, resolution, tileKeys)
	);

	for (const tile of tiles) {
		const height = clamp(Math.floor(maps.heightMap[tile.y]?.[tile.x] ?? 0), 0, maxHeight);
		const color = maps.colorMap[tile.y]?.[tile.x] ?? DEFAULT_TERRAIN_COLOR_INDEX;
		for (let subZ = 0; subZ < resolution; subZ++) {
			for (let subX = 0; subX < resolution; subX++) {
				for (let y = 0; y < height; y++) {
					voxels.push({
						x: tile.x * resolution + subX,
						y,
						z: tile.y * resolution + subZ,
						color,
					});
				}
			}
		}
	}

	return { ...terrain, Voxels: encodeVoxels(voxels) };
}

function recolorExistingVoxels(
	terrain: VoxelTerrain,
	tiles: Array<{ x: number; y: number }>,
	color: number
): VoxelTerrain {
	const resolution = clampVoxelTerrainResolution(terrain.Resolution);
	const tileKeys = getTileKeySet(tiles);
	const voxels = Array.from(decodeVoxels(terrain.Voxels)).map((voxel) =>
		isVoxelInAnyTile(voxel.x, voxel.z, resolution, tileKeys)
			? { ...voxel, color }
			: voxel
	);

	return { ...terrain, Voxels: encodeVoxels(voxels) };
}

function getBrushPreviewCells(size: number, shape: BrushShape): boolean[] {
	const footprint = size * 2 - 1;
	const center = size - 1;
	return Array.from({ length: footprint * footprint }, (_, idx) => {
		const x = idx % footprint;
		const y = Math.floor(idx / footprint);
		return shape === "square" || isRoundBrushTile(center, center, x, y, size);
	});
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const normalized = hex.replace("#", "");
	return {
		r: parseInt(normalized.slice(0, 2), 16),
		g: parseInt(normalized.slice(2, 4), 16),
		b: parseInt(normalized.slice(4, 6), 16),
	};
}

function channelToHex(value: number): string {
	return clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
}

function adjustHexBrightness(hex: string, brightnessPercent: number): string {
	const { r, g, b } = hexToRgb(hex);
	const multiplier = brightnessPercent / 100;
	return `#${channelToHex(r * multiplier)}${channelToHex(g * multiplier)}${channelToHex(b * multiplier)}`;
}

function getReadableTextStyle(backgroundHex: string): {
	color: string;
	textShadow: string;
} {
	const { r, g, b } = hexToRgb(backgroundHex);
	const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
	const isDark = luminance < 0.48;
	return isDark
		? { color: "rgba(255,255,255,0.95)", textShadow: "0 0 2px rgba(0,0,0,0.85)" }
		: { color: "rgba(0,0,0,0.9)", textShadow: "0 0 2px rgba(255,255,255,0.55)" };
}

function getSelectedVoxelHeights(selection: HeightSelection, maxHeight: number): number[] {
	const cappedMax = Math.max(1, Math.floor(maxHeight));
	if (selection.mode === "single") {
		return [clamp(Math.floor(selection.value), 0, cappedMax - 1)];
	}

	const start = clamp(Math.floor(selection.start), 0, cappedMax - 1);
	const end = clamp(Math.floor(selection.end), start + 1, cappedMax);
	return Array.from({ length: end - start }, (_, index) => start + index);
}

export function VoxelTerrainEditor({
	terrain,
	readOnly,
	onChange,
}: VoxelTerrainEditorProps) {
	const [draftTerrain, setDraftTerrain] = useState<VoxelTerrain>(() => cloneTerrain(terrain));
	const draftTerrainRef = useRef(draftTerrain);
	const [maps, setMaps] = useState<VoxelTerrainEditorMaps>(() =>
		voxelTerrainToEditorMaps(terrain)
	);
	const [mode, setMode] = useState<EditorMode>("normal");
	const [detailMode, setDetailMode] = useState(false);
	const [normalTool, setNormalTool] = useState<NormalTool>("paint");
	const [sculptTool, setSculptTool] = useState<SculptTool>("set");
	const [brushSize, setBrushSize] = useState(1);
	const [brushShape, setBrushShape] = useState<BrushShape>("square");
	const [selectedColorIndex, setSelectedColorIndex] = useState(DEFAULT_TERRAIN_COLOR_INDEX);
	const [targetHeight, setTargetHeight] = useState(1);
	const [showHeights, setShowHeights] = useState(false);
	const [mirrorHorizontal, setMirrorHorizontal] = useState(false);
	const [mirrorVertical, setMirrorVertical] = useState(false);
	const [heightSelection, setHeightSelection] = useState<HeightSelection>(() => ({
		mode: "range",
		start: 0,
		end: Math.max(1, clampVoxelTerrainResolution(terrain.Resolution)),
	}));
	const [hoverTile, setHoverTile] = useState<{ x: number; y: number } | null>(null);
	const [flattenConfirm, setFlattenConfirm] = useState(false);
	const [undoStack, setUndoStack] = useState<HistorySnapshot[]>([]);
	const [redoStack, setRedoStack] = useState<HistorySnapshot[]>([]);

	const resolution = clampVoxelTerrainResolution(draftTerrain.Resolution);
	const clampedMaxHeight = Math.max(1, draftTerrain.Height * resolution);
	const paletteLevels = TERRAIN_PALETTE_FAMILIES[0]?.colors.length ?? 5;
	const middlePaletteLevel = Math.floor(paletteLevels / 2);
	const selectedFamilyIndex = Math.floor(selectedColorIndex / paletteLevels);
	const selectedLevelIndex = selectedColorIndex % paletteLevels;
	const activeTool = mode === "normal" ? normalTool : sculptTool;
	const isColorTool =
		mode === "normal"
			? normalTool === "paint" || normalTool === "eyedropper"
			: sculptTool !== "clear";

	useEffect(() => {
		const nextTerrain = cloneTerrain(terrain);
		const isOwnCommit = isSameEditorTerrain(nextTerrain, draftTerrainRef.current);
		draftTerrainRef.current = nextTerrain;
		setDraftTerrain(nextTerrain);
		setMaps(voxelTerrainToEditorMaps(nextTerrain));
		if (!isOwnCommit) {
			setUndoStack([]);
			setRedoStack([]);
		}
	}, [terrain]);

	useEffect(() => {
		setTargetHeight((prev) => clamp(prev, 0, clampedMaxHeight));
		setHeightSelection((prev) => {
			if (prev.mode === "single") {
				return {
					mode: "single",
					value: clamp(prev.value, 0, clampedMaxHeight - 1),
				};
			}
			const start = clamp(prev.start, 0, clampedMaxHeight - 1);
			const end = clamp(prev.end, start + 1, clampedMaxHeight);
			return { mode: "range", start, end };
		});
	}, [clampedMaxHeight]);

	const commitDraftTerrain = useCallback(
		(nextTerrain: VoxelTerrain, shouldNotify = true) => {
			draftTerrainRef.current = nextTerrain;
			setDraftTerrain(nextTerrain);
			setMaps(voxelTerrainToEditorMaps(nextTerrain));
			if (shouldNotify) onChange(nextTerrain);
		},
		[onChange]
	);

	const pushToHistory = useCallback(() => {
		const snapshot = { terrain: cloneTerrain(draftTerrainRef.current) };
		setUndoStack((prev) => {
			const next = [...prev, snapshot];
			if (next.length > MAX_HISTORY) next.shift();
			return next;
		});
		setRedoStack([]);
	}, []);

	const restoreSnapshot = useCallback(
		(snapshot: HistorySnapshot) => {
			commitDraftTerrain(cloneTerrain(snapshot.terrain));
		},
		[commitDraftTerrain]
	);

	const undo = useCallback(() => {
		if (undoStack.length === 0 || readOnly) return;
		const nextUndo = [...undoStack];
		const snapshot = nextUndo.pop()!;
		setUndoStack(nextUndo);
		setRedoStack((prev) => [...prev, { terrain: cloneTerrain(draftTerrainRef.current) }]);
		restoreSnapshot(snapshot);
	}, [readOnly, restoreSnapshot, undoStack]);

	const redo = useCallback(() => {
		if (redoStack.length === 0 || readOnly) return;
		const nextRedo = [...redoStack];
		const snapshot = nextRedo.pop()!;
		setRedoStack(nextRedo);
		setUndoStack((prev) => [...prev, { terrain: cloneTerrain(draftTerrainRef.current) }]);
		restoreSnapshot(snapshot);
	}, [readOnly, redoStack, restoreSnapshot]);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (readOnly) return;
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
				e.preventDefault();
				if (e.shiftKey) redo();
				else undo();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [readOnly, redo, undo]);

	const containerRef = useRef<HTMLDivElement | null>(null);
	const toolbarStackRef = useRef<HTMLDivElement | null>(null);
	const gridContainerRef = useRef<HTMLDivElement | null>(null);
	const footerRef = useRef<HTMLDivElement | null>(null);
	const gridRef = useRef<HTMLDivElement | null>(null);
	const [tilePx, setTilePx] = useState(16);
	const [detailTilePx, setDetailTilePx] = useState(16);
	const [toolbarHeight, setToolbarHeight] = useState(0);
	const [footerHeight, setFooterHeight] = useState(0);

	const width = draftTerrain.Width;
	const length = draftTerrain.Length;

	// In detail mode, the grid displays at voxel-subcell resolution
	const displayCols = detailMode ? width * resolution : width;
	const displayRows = detailMode ? length * resolution : length;
	const minGridWidth = Math.max(0, width * MIN_TILE_PX + (width - 1) * GRID_GAP);
	const minGridHeight = Math.max(0, length * MIN_TILE_PX + (length - 1) * GRID_GAP);
	const editorMinHeight = toolbarHeight + footerHeight + minGridHeight + 12;

	// Active tile pixel size: auto-fitted in normal mode, user-zoomed in detail mode
	const activeTilePx = detailMode ? detailTilePx : tilePx;

	useEffect(() => {
		if (!toolbarStackRef.current) return;
		const measureToolbar = () => {
			const toolbarStack = toolbarStackRef.current;
			if (!toolbarStack) return;
			setToolbarHeight(toolbarStack.getBoundingClientRect().height);
		};

		measureToolbar();
		const ro = new ResizeObserver(measureToolbar);
		ro.observe(toolbarStackRef.current);
		return () => ro.disconnect();
	}, []);

	useEffect(() => {
		if (!footerRef.current) return;
		const measureFooter = () => {
			const footer = footerRef.current;
			if (!footer) return;
			setFooterHeight(footer.getBoundingClientRect().height);
		};

		measureFooter();
		const ro = new ResizeObserver(measureFooter);
		ro.observe(footerRef.current);
		return () => ro.disconnect();
	}, []);

	// Auto-fit tile size in normal (non-detail) mode only
	useEffect(() => {
		if (detailMode) return;
		if (!containerRef.current || !gridContainerRef.current) return;
		const compute = () => {
			const gridContainer = gridContainerRef.current;
			if (!gridContainer) return;
			const gridRect = gridContainer.getBoundingClientRect();
			const availableW = gridRect.width;
			const availableH = gridRect.height;
			if (width <= 0 || length <= 0 || availableW <= 0 || availableH <= 0) return;

			const gapTotalW = GRID_GAP * (width - 1);
			const gapTotalH = GRID_GAP * (length - 1);
			const maxTileW = (availableW - gapTotalW) / width;
			const maxTileH = (availableH - gapTotalH) / length;
			const px = clamp(
				Math.floor(Math.min(maxTileW, maxTileH)),
				MIN_TILE_PX,
				MAX_TILE_PX
			);
			setTilePx((prev) => (px !== prev ? px : prev));
		};

		compute();
		const ro = new ResizeObserver(compute);
		ro.observe(containerRef.current);
		return () => ro.disconnect();
	}, [detailMode, footerHeight, length, toolbarHeight, width]);

	const isPointerDownRef = useRef(false);
	const touchedRef = useRef<Set<string>>(new Set());
	const workHeightsRef = useRef<number[][] | null>(null);
	const workColorsRef = useRef<number[][] | null>(null);
	const workVoxelMapRef = useRef<Map<number, number> | null>(null);
	const rafRef = useRef<number | null>(null);
	const hasChangedRef = useRef(false);

	const beginStroke = useCallback(() => {
		touchedRef.current = new Set();
		workHeightsRef.current = clone2DNumber(maps.heightMap);
		workColorsRef.current = clone2DNumber(maps.colorMap);
		// Detail+normal mode also operates on voxel data directly (per-column operations)
		workVoxelMapRef.current =
			mode === "sculpt" || (mode === "normal" && detailMode)
				? cloneVoxelMap(draftTerrainRef.current.Voxels)
				: null;
		hasChangedRef.current = false;
		pushToHistory();
	}, [detailMode, maps.colorMap, maps.heightMap, mode, pushToHistory]);

	const schedulePreview = useCallback(() => {
		if (rafRef.current != null) return;
		rafRef.current = requestAnimationFrame(() => {
			rafRef.current = null;
			// Sculpt and detail+normal both work from the voxel map
			if (mode === "sculpt" || (mode === "normal" && detailMode)) {
				if (!workVoxelMapRef.current) return;
				const nextTerrain = {
					...draftTerrainRef.current,
					Voxels: encodeVoxelMap(workVoxelMapRef.current),
				};
				commitDraftTerrain(nextTerrain, false);
				return;
			}

			if (!workHeightsRef.current || !workColorsRef.current) return;
			setMaps({
				heightMap: workHeightsRef.current,
				colorMap: workColorsRef.current,
			});
		});
	}, [commitDraftTerrain, detailMode, mode]);

	const finishStroke = useCallback(() => {
		const didChange = hasChangedRef.current;
		const finalHeightMap = workHeightsRef.current;
		const finalColorMap = workColorsRef.current;
		const finalVoxelMap = workVoxelMapRef.current;

		isPointerDownRef.current = false;
		if (rafRef.current != null) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}

		if (didChange) {
			// Sculpt and detail+normal both commit via voxel map
			if ((mode === "sculpt" || (mode === "normal" && detailMode)) && finalVoxelMap) {
				commitDraftTerrain({
					...draftTerrainRef.current,
					Voxels: encodeVoxelMap(finalVoxelMap),
				});
			} else if (finalHeightMap && finalColorMap) {
				const touchedTiles = Array.from(touchedRef.current)
					.map(parseTileKey)
					.filter((tile): tile is { x: number; y: number } => tile != null);
				const nextMaps = {
					heightMap: finalHeightMap,
					colorMap: finalColorMap,
				};
				commitDraftTerrain(
					normalTool === "paint"
						? recolorExistingVoxels(
								draftTerrainRef.current,
								touchedTiles,
								selectedColorIndex
							)
						: replaceVoxelTerrainColumns(
								draftTerrainRef.current,
								nextMaps,
								touchedTiles
							)
				);
			}
		} else {
			setUndoStack((prev) => prev.slice(0, -1));
		}

		touchedRef.current.clear();
		workHeightsRef.current = null;
		workColorsRef.current = null;
		workVoxelMapRef.current = null;
	}, [commitDraftTerrain, detailMode, mode, normalTool, selectedColorIndex]);

	// Sculpt: apply to all subcells of a tile
	const applySculptTile = useCallback(
		(tileX: number, tileZ: number) => {
			const voxelMap = workVoxelMapRef.current;
			if (!voxelMap) return false;

			let changed = false;
			const heights = getSelectedVoxelHeights(heightSelection, clampedMaxHeight);
			for (let subZ = 0; subZ < resolution; subZ++) {
				for (let subX = 0; subX < resolution; subX++) {
					const vx = tileX * resolution + subX;
					const vz = tileZ * resolution + subZ;
					for (const vy of heights) {
						const key = getVoxelPositionKey(vx, vy, vz);
						const existingColor = voxelMap.get(key);

						if (sculptTool === "clear") {
							if (existingColor == null) continue;
							voxelMap.delete(key);
							changed = true;
						} else if (sculptTool === "set") {
							if (existingColor === selectedColorIndex) continue;
							voxelMap.set(key, selectedColorIndex);
							changed = true;
						} else if (existingColor != null && existingColor !== selectedColorIndex) {
							voxelMap.set(key, selectedColorIndex);
							changed = true;
						}
					}
				}
			}

			return changed;
		},
		[clampedMaxHeight, heightSelection, resolution, sculptTool, selectedColorIndex]
	);

	// Sculpt in detail mode: apply to a single voxel column (vx, vz)
	const applySculptVoxelColumn = useCallback(
		(vx: number, vz: number) => {
			const voxelMap = workVoxelMapRef.current;
			if (!voxelMap) return false;

			let changed = false;
			const heights = getSelectedVoxelHeights(heightSelection, clampedMaxHeight);
			for (const vy of heights) {
				const key = getVoxelPositionKey(vx, vy, vz);
				const existingColor = voxelMap.get(key);

				if (sculptTool === "clear") {
					if (existingColor == null) continue;
					voxelMap.delete(key);
					changed = true;
				} else if (sculptTool === "set") {
					if (existingColor === selectedColorIndex) continue;
					voxelMap.set(key, selectedColorIndex);
					changed = true;
				} else if (existingColor != null && existingColor !== selectedColorIndex) {
					voxelMap.set(key, selectedColorIndex);
					changed = true;
				}
			}

			return changed;
		},
		[clampedMaxHeight, heightSelection, sculptTool, selectedColorIndex]
	);

	// Detail+normal: operate on a single voxel column (vx, vz) as a whole unit.
	// raise/lower adjust the column height; set assigns an exact height; paint recolors.
	const applyDetailNormalColumn = useCallback(
		(vx: number, vz: number) => {
			const voxelMap = workVoxelMapRef.current;
			if (!voxelMap) return false;

			let changed = false;

			if (normalTool === "paint") {
				for (let y = 0; y < clampedMaxHeight; y++) {
					const key = getVoxelPositionKey(vx, y, vz);
					const existing = voxelMap.get(key);
					if (existing != null && existing !== selectedColorIndex) {
						voxelMap.set(key, selectedColorIndex);
						changed = true;
					}
				}
			} else if (normalTool === "raise") {
				// Find current top voxel, add one above it using its color
				let topY = -1;
				let topColor = selectedColorIndex;
				for (let y = 0; y < clampedMaxHeight; y++) {
					const col = voxelMap.get(getVoxelPositionKey(vx, y, vz));
					if (col != null) { topY = y; topColor = col; }
				}
				const nextY = topY + 1;
				if (nextY < clampedMaxHeight) {
					voxelMap.set(getVoxelPositionKey(vx, nextY, vz), topColor);
					changed = true;
				}
			} else if (normalTool === "lower") {
				// Remove the top voxel
				let topY = -1;
				for (let y = 0; y < clampedMaxHeight; y++) {
					if (voxelMap.has(getVoxelPositionKey(vx, y, vz))) topY = y;
				}
				if (topY >= 0) {
					voxelMap.delete(getVoxelPositionKey(vx, topY, vz));
					changed = true;
				}
			} else if (normalTool === "set") {
				const target = clamp(targetHeight, 0, clampedMaxHeight);
				// Preserve topmost color for filling; fall back to selectedColorIndex
				let fillColor = selectedColorIndex;
				for (let y = 0; y < clampedMaxHeight; y++) {
					const col = voxelMap.get(getVoxelPositionKey(vx, y, vz));
					if (col != null) fillColor = col;
				}
				for (let y = 0; y < clampedMaxHeight; y++) {
					const key = getVoxelPositionKey(vx, y, vz);
					const has = voxelMap.has(key);
					const want = y < target;
					if (has && !want) { voxelMap.delete(key); changed = true; }
					else if (!has && want) { voxelMap.set(key, fillColor); changed = true; }
				}
			}

			return changed;
		},
		[clampedMaxHeight, normalTool, selectedColorIndex, targetHeight]
	);

	// applyAt receives display-grid coords.
	// In detail mode the brush always operates at subcell resolution regardless of mode.
	// For normal-mode ops the subcell coord is mapped to its parent tile, and the
	// touchedRef deduplicates by tile key so the op is only applied once per tile.
	const applyAt = useCallback(
		(gx: number, gy: number) => {
			if (!workHeightsRef.current || !workColorsRef.current) return;

			// Brush always works in the display space (subcell in detail, tile otherwise)
			const workWidth = detailMode ? width * resolution : width;
			const workLength = detailMode ? length * resolution : length;

			let changed = false;
			applyBrush(gx, gy, brushSize, brushShape, workWidth, workLength, (bx, by) => {
				for (const coord of getMirroredTileCoords(
					bx,
					by,
					workWidth,
					workLength,
					mirrorHorizontal,
					mirrorVertical
				)) {
					if (mode === "sculpt") {
						// Sculpt: track subcell keys; each subcell painted once
						const cellKey = getTileKey(coord.x, coord.y);
						if (touchedRef.current.has(cellKey)) continue;
						touchedRef.current.add(cellKey);
						if (detailMode) {
							changed = applySculptVoxelColumn(coord.x, coord.y) || changed;
						} else {
							changed = applySculptTile(coord.x, coord.y) || changed;
						}
						continue;
					}

					if (detailMode) {
						// Detail+normal: each subcell is an independent column; deduplicate by subcell
						const cellKey = getTileKey(coord.x, coord.y);
						if (touchedRef.current.has(cellKey)) continue;
						touchedRef.current.add(cellKey);
						changed = applyDetailNormalColumn(coord.x, coord.y) || changed;
						continue;
					}

					// Non-detail normal mode: tile-level heightmap operations
					const tileKey = getTileKey(coord.x, coord.y);
					if (touchedRef.current.has(tileKey)) continue;
					touchedRef.current.add(tileKey);

					if (normalTool === "paint") {
						if (workColorsRef.current![coord.y][coord.x] === selectedColorIndex) continue;
						workColorsRef.current![coord.y][coord.x] = selectedColorIndex;
						changed = true;
					} else if (normalTool === "raise") {
						const next = clamp(workHeightsRef.current![coord.y][coord.x] + 1, 0, clampedMaxHeight);
						if (next === workHeightsRef.current![coord.y][coord.x]) continue;
						workHeightsRef.current![coord.y][coord.x] = next;
						changed = true;
					} else if (normalTool === "lower") {
						const next = clamp(workHeightsRef.current![coord.y][coord.x] - 1, 0, clampedMaxHeight);
						if (next === workHeightsRef.current![coord.y][coord.x]) continue;
						workHeightsRef.current![coord.y][coord.x] = next;
						changed = true;
					} else if (normalTool === "set") {
						const next = clamp(targetHeight, 0, clampedMaxHeight);
						if (next === workHeightsRef.current![coord.y][coord.x]) continue;
						workHeightsRef.current![coord.y][coord.x] = next;
						changed = true;
					}
				}
			});

			if (!changed) return;
			hasChangedRef.current = true;
			schedulePreview();
		},
		[
			applyDetailNormalColumn,
			applySculptTile,
			applySculptVoxelColumn,
			brushShape,
			brushSize,
			clampedMaxHeight,
			detailMode,
			length,
			mirrorHorizontal,
			mirrorVertical,
			mode,
			normalTool,
			resolution,
			schedulePreview,
			selectedColorIndex,
			targetHeight,
			width,
		]
	);



	const eventToGridXY = useCallback(
		(clientX: number, clientY: number) => {
			const grid = gridRef.current;
			if (!grid) return null;
			const rect = grid.getBoundingClientRect();
			const relX = clientX - rect.left;
			const relY = clientY - rect.top;
			const stepX = activeTilePx + GRID_GAP;
			const stepY = activeTilePx + GRID_GAP;
			if (stepX <= 0 || stepY <= 0 || relX < 0 || relY < 0) return null;
			const x = Math.floor(relX / stepX);
			const y = Math.floor(relY / stepY);
			if (x >= displayCols || y >= displayRows) return null;
			return { x, y };
		},
		[activeTilePx, displayCols, displayRows]
	);

	const pickColorAt = useCallback(
		(gx: number, gy: number) => {
			const picked = maps.colorMap[gy]?.[gx];
			if (picked == null) return;
			setSelectedColorIndex(picked);
		},
		[maps.colorMap]
	);

	const onGridPointerDown = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (readOnly) return;
			const pt = eventToGridXY(e.clientX, e.clientY);

			if (
				pt &&
				mode === "normal" &&
				(normalTool === "eyedropper" || (normalTool === "paint" && e.altKey))
			) {
				// Always pick from tile coords
				const tx = detailMode ? Math.floor(pt.x / resolution) : pt.x;
				const ty = detailMode ? Math.floor(pt.y / resolution) : pt.y;
				pickColorAt(tx, ty);
				if (normalTool === "eyedropper") setNormalTool("paint");
				return;
			}

			isPointerDownRef.current = true;
			beginStroke();
			if (pt) applyAt(pt.x, pt.y);
		},
		[applyAt, beginStroke, detailMode, eventToGridXY, mode, normalTool, pickColorAt, readOnly, resolution]
	);

	const onGridPointerMove = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			const pt = eventToGridXY(e.clientX, e.clientY);
			setHoverTile(pt);
			if (!isPointerDownRef.current || readOnly) return;
			if (pt) applyAt(pt.x, pt.y);
		},
		[applyAt, eventToGridXY, readOnly]
	);

	const onGridPointerLeave = useCallback(() => {
		setHoverTile(null);
		if (!isPointerDownRef.current) return;
		finishStroke();
	}, [finishStroke]);

	const onGridPointerUp = useCallback(() => {
		if (!isPointerDownRef.current) return;
		finishStroke();
	}, [finishStroke]);

	// Mouse wheel zooms in detail mode
	const onGridContainerWheel = useCallback(
		(e: React.WheelEvent<HTMLDivElement>) => {
			if (!detailMode) return;
			// Don't prevent default here -- let scroll happen naturally
			// Only update zoom if ctrl/meta held (pinch-to-zoom gesture or ctrl+scroll)
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			const delta = e.deltaY < 0 ? 2 : -2;
			setDetailTilePx((prev) => clamp(prev + delta, DETAIL_MIN_TILE_PX, DETAIL_MAX_TILE_PX));
		},
		[detailMode]
	);

	const hoveredTiles = useMemo(() => {
		if (!hoverTile || readOnly) return new Set<string>();

		// Brush always operates in the display space (subcell in detail, tile otherwise)
		const workWidth = detailMode ? width * resolution : width;
		const workLength = detailMode ? length * resolution : length;

		if (mode === "normal" && normalTool === "eyedropper") {
			if (detailMode) {
				// Highlight the whole tile the cursor is over
				const tx = Math.floor(hoverTile.x / resolution);
				const ty = Math.floor(hoverTile.y / resolution);
				const cells = new Set<string>();
				for (let sz = 0; sz < resolution; sz++) {
					for (let sx = 0; sx < resolution; sx++) {
						cells.add(getTileKey(tx * resolution + sx, ty * resolution + sz));
					}
				}
				return cells;
			}
			return new Set([getTileKey(hoverTile.x, hoverTile.y)]);
		}

		const baseTiles = getBrushTiles(hoverTile.x, hoverTile.y, brushSize, brushShape, workWidth, workLength);
		const mirroredSet = new Set<string>();
		for (const tile of baseTiles) {
			const [tx, ty] = tile.split(",").map(Number);
			for (const coord of getMirroredTileCoords(tx, ty, workWidth, workLength, mirrorHorizontal, mirrorVertical)) {
				mirroredSet.add(getTileKey(coord.x, coord.y));
			}
		}
		return mirroredSet;
	}, [
		brushShape,
		brushSize,
		detailMode,
		hoverTile,
		length,
		mirrorHorizontal,
		mirrorVertical,
		mode,
		normalTool,
		readOnly,
		resolution,
		width,
	]);

	// Subcell display data for detail mode.
	// Sculpt: colors at the selected height range.
	// Normal detail: topmost voxel color + height per subcell column.
	const subcellDetailData = useMemo(() => {
		if (!detailMode) return null;
		const colors = new Map<string, number>();
		const heights = new Map<string, number>(); // only populated for normal mode

		if (mode === "sculpt") {
			const selectedHeights = new Set(getSelectedVoxelHeights(heightSelection, clampedMaxHeight));
			for (const voxel of decodeVoxels(draftTerrain.Voxels)) {
				if (selectedHeights.has(voxel.y)) {
					colors.set(getTileKey(voxel.x, voxel.z), voxel.color);
				}
			}
		} else {
			// Normal detail: track topmost voxel per subcell column
			const topY = new Map<string, number>();
			for (const voxel of decodeVoxels(draftTerrain.Voxels)) {
				const key = getTileKey(voxel.x, voxel.z);
				const cur = topY.get(key) ?? -1;
				if (voxel.y > cur) {
					topY.set(key, voxel.y);
					colors.set(key, voxel.color);
				}
			}
			for (const [key, y] of topY) heights.set(key, y + 1);
		}

		return { colors, heights };
	}, [clampedMaxHeight, detailMode, draftTerrain.Voxels, heightSelection, mode]);

	const handlePreset = useCallback(
		(preset: "hills" | "trees" | "smooth") => {
			if (readOnly) return;
			pushToHistory();

			let heightMap: number[][];
			if (preset === "hills") {
				heightMap = applyRandomHills(maps.heightMap, width, length, clampedMaxHeight);
			} else if (preset === "trees") {
				heightMap = applyRandomTrees(maps.heightMap, width, length, clampedMaxHeight);
			} else {
				heightMap = applySmooth(maps.heightMap, width, length, 1);
			}

			commitDraftTerrain(
				editorMapsToVoxelTerrain(draftTerrainRef.current, {
					heightMap,
					colorMap: maps.colorMap,
				})
			);
		},
		[clampedMaxHeight, commitDraftTerrain, length, maps.colorMap, maps.heightMap, pushToHistory, readOnly, width]
	);

	const handleFlatten = useCallback(() => {
		if (readOnly) return;
		if (!flattenConfirm) {
			setFlattenConfirm(true);
			setTimeout(() => setFlattenConfirm(false), 3000);
			return;
		}

		pushToHistory();
		commitDraftTerrain(
			editorMapsToVoxelTerrain(draftTerrainRef.current, {
				heightMap: applyFlatten(maps.heightMap, width, length),
				colorMap: maps.colorMap,
			})
		);
		setFlattenConfirm(false);
	}, [commitDraftTerrain, flattenConfirm, length, maps.colorMap, maps.heightMap, pushToHistory, readOnly, width]);

	const doFillAll = useCallback(() => {
		if (readOnly) return;
		pushToHistory();

		if (mode === "sculpt") {
			const voxelMap = cloneVoxelMap(draftTerrainRef.current.Voxels);
			const heights = getSelectedVoxelHeights(heightSelection, clampedMaxHeight);
			for (let tileZ = 0; tileZ < length; tileZ++) {
				for (let tileX = 0; tileX < width; tileX++) {
					for (let subZ = 0; subZ < resolution; subZ++) {
						for (let subX = 0; subX < resolution; subX++) {
							const vx = tileX * resolution + subX;
							const vz = tileZ * resolution + subZ;
							for (const vy of heights) {
								const key = getVoxelPositionKey(vx, vy, vz);
								if (sculptTool === "clear") {
									voxelMap.delete(key);
								} else if (sculptTool === "set") {
									voxelMap.set(key, selectedColorIndex);
								} else if (voxelMap.has(key)) {
									voxelMap.set(key, selectedColorIndex);
								}
							}
						}
					}
				}
			}

			commitDraftTerrain({
				...draftTerrainRef.current,
				Voxels: encodeVoxelMap(voxelMap),
			});
			return;
		}

		if (normalTool === "set") {
			const nextHeights = maps.heightMap.map((row) =>
				row.map(() => clamp(targetHeight, 0, clampedMaxHeight))
			);
			commitDraftTerrain(
				editorMapsToVoxelTerrain(draftTerrainRef.current, {
					heightMap: nextHeights,
					colorMap: maps.colorMap,
				})
			);
			return;
		}

		commitDraftTerrain(
			recolorExistingVoxels(
				draftTerrainRef.current,
				getAllTileCoords(width, length),
				selectedColorIndex
			)
		);
	}, [
		clampedMaxHeight,
		commitDraftTerrain,
		heightSelection,
		length,
		maps.colorMap,
		maps.heightMap,
		mode,
		normalTool,
		pushToHistory,
		readOnly,
		resolution,
		sculptTool,
		selectedColorIndex,
		targetHeight,
		width,
	]);

	const heightFontSize = useMemo(() => {
		const maxDim = Math.max(width, length);
		if (maxDim > 40 || activeTilePx < 12) return 8;
		if (maxDim > 32 || activeTilePx < 16) return 12;
		if (maxDim > 24 || activeTilePx < 20) return 16;
		return 20;
	}, [activeTilePx, length, width]);

	const gridStyle: React.CSSProperties = useMemo(
		() => ({
			display: "grid",
			gridTemplateColumns: `repeat(${displayCols}, ${activeTilePx}px)`,
			gridTemplateRows: `repeat(${displayRows}, ${activeTilePx}px)`,
			gap: GRID_GAP,
			width: Math.max(0, displayCols * activeTilePx + (displayCols - 1) * GRID_GAP),
			height: Math.max(0, displayRows * activeTilePx + (displayRows - 1) * GRID_GAP),
			userSelect: "none",
			touchAction: detailMode ? "pan-x pan-y" : "none",
			pointerEvents: readOnly ? "none" : "auto",
		}),
		[activeTilePx, detailMode, displayCols, displayRows, readOnly]
	);

	return (
		<div
			ref={containerRef}
			className="w-full h-full flex flex-col min-h-0"
			style={{ minHeight: editorMinHeight }}
		>
			{/* Toolbar */}
			<div ref={toolbarStackRef} className="shrink-0 space-y-2">

				{/* Row 1: history + tools + height selector + brush + fill all */}
				<div className="flex flex-wrap items-center gap-2 rounded-lg border border-base-300 bg-base-200/60 p-2">

					{/* Undo / Redo */}
					<div className="flex items-center gap-1" aria-label="History">
						<button
							type="button"
							className="btn btn-sm btn-square btn-ghost"
							onClick={undo}
							disabled={readOnly || undoStack.length === 0}
							title="Undo (Ctrl+Z)"
						>
							<span className="icon-[mdi--undo]" />
						</button>
						<button
							type="button"
							className="btn btn-sm btn-square btn-ghost"
							onClick={redo}
							disabled={readOnly || redoStack.length === 0}
							title="Redo (Ctrl+Shift+Z)"
						>
							<span className="icon-[mdi--redo]" />
						</button>
					</div>

					<div className="h-8 w-px bg-base-300" />

					{/* Tools (no label) */}
					<div className="join">
						{mode === "normal"
							? NORMAL_TOOL_OPTIONS.map((option) => (
									<button
										key={option.value}
										type="button"
										className={`btn btn-sm join-item gap-1 ${
											normalTool === option.value ? "btn-primary" : ""
										}`}
										onClick={() => setNormalTool(option.value)}
										disabled={readOnly}
										title={option.title}
									>
										<span className={option.icon} />
										<span className="hidden 2xl:inline">{option.label}</span>
									</button>
								))
							: SCULPT_TOOL_OPTIONS.map((option) => (
									<button
										key={option.value}
										type="button"
										className={`btn btn-sm join-item gap-1 ${
											sculptTool === option.value ? "btn-primary" : ""
										}`}
										onClick={() => setSculptTool(option.value)}
										disabled={readOnly}
										title={option.title}
									>
										<span className={option.icon} />
										<span className="hidden 2xl:inline">{option.label}</span>
									</button>
								))}
					</div>

					{/* Height input for normal "set" tool */}
					{mode === "normal" && normalTool === "set" && (
						<div className="flex items-center gap-1">
							<span className="text-sm font-medium opacity-70">Height</span>
							<input
								type="number"
								min={0}
								max={clampedMaxHeight}
								step={1}
								value={targetHeight}
								onChange={(e) =>
									setTargetHeight(clamp(Number(e.target.value) || 0, 0, clampedMaxHeight))
								}
								className="input input-sm input-bordered w-16 text-center"
								disabled={readOnly}
							/>
						</div>
					)}
					{/* Height range selector only shown in sculpt mode */}
					{mode === "sculpt" && (
						<HeightRangeInput
							maxHeight={clampedMaxHeight}
							value={heightSelection}
							onChange={setHeightSelection}
							disabled={readOnly}
						/>
					)}

					<div className="h-8 w-px bg-base-300" />

					{/* Brush palette */}
					<div className="flex flex-wrap items-center gap-1">
						<span className="text-sm font-medium opacity-70 mr-1">Brush</span>
						{BRUSH_OPTIONS.map(({ size, shape }) => {
							const footprint = size * 2 - 1;
							const isSelected = brushSize === size && brushShape === shape;
							const previewCells = getBrushPreviewCells(size, shape);
							return (
								<button
									key={`${shape}-${size}`}
									type="button"
									className={`btn btn-sm h-12 min-h-0 px-2 ${
										isSelected ? "btn-primary" : "btn-ghost"
									}`}
									onClick={() => {
										setBrushSize(size);
										setBrushShape(shape);
									}}
									disabled={readOnly}
									title={`${shape === "round" ? "Round" : "Square"} brush ${footprint}x${footprint}`}
								>
									<span className="flex flex-col items-center gap-0.5">
										<span
											className="grid h-6 w-6 place-items-center"
											style={{
												gridTemplateColumns: `repeat(${footprint}, minmax(0, 1fr))`,
												gridTemplateRows: `repeat(${footprint}, minmax(0, 1fr))`,
												gap: footprint > 5 ? 1 : 2,
											}}
										>
											{previewCells.map((isActiveCell, idx) => (
												<span
													key={idx}
													className={`block h-full w-full rounded-[1px] ${
														isActiveCell
															? isSelected
																? "bg-primary-content"
																: "bg-base-content/60"
															: isSelected
																? "bg-primary-content/20"
																: "bg-base-content/10"
													}`}
												/>
											))}
										</span>
										<span className="text-[10px] leading-none tabular-nums">
											{footprint}x{footprint}
										</span>
									</span>
								</button>
							);
						})}

						{/* Fill All at end of brush palette */}
						<button
							type="button"
							className="btn btn-sm btn-ghost gap-1 h-12 min-h-0 px-2"
							onClick={doFillAll}
							disabled={readOnly}
							title={mode === "sculpt" ? "Apply tool to all tiles" : normalTool === "set" ? "Set height for all tiles" : "Fill all tiles with selected color"}
						>
							<span className="flex flex-col items-center gap-0.5">
								<span className="icon-[mdi--format-color-fill] text-lg" />
								<span className="text-[10px] leading-none">all</span>
							</span>
						</button>
					</div>
				</div>

				{/* Row 2: Color palette */}
				<div
					className={`flex flex-wrap items-center gap-3 rounded-lg border border-base-300 bg-base-100 p-2 transition-opacity ${
						isColorTool ? "" : "opacity-45"
					}`}
					aria-disabled={!isColorTool}
				>
					<span className="text-sm font-medium opacity-70">Color</span>
					<div className="flex flex-wrap items-center gap-1">
						{TERRAIN_PALETTE_FAMILIES.map((family, familyIndex) => {
							const displayLevel =
								familyIndex === selectedFamilyIndex
									? selectedLevelIndex
									: middlePaletteLevel;
							const displayIndex = getTerrainPaletteIndex(familyIndex, displayLevel);
							const isSelectedFamily = familyIndex === selectedFamilyIndex;

							return (
								<div key={family.id} className="group relative">
									<button
										type="button"
										className={`h-7 w-7 rounded ${
											isSelectedFamily
												? "ring-2 ring-offset-2 ring-primary"
												: "ring-1 ring-base-300"
										}`}
										style={{ backgroundColor: getTerrainColorByIndex(displayIndex) }}
										onClick={() => setSelectedColorIndex(displayIndex)}
										disabled={readOnly || !isColorTool}
										title={family.label}
									/>
									{isColorTool && !readOnly && (
										<div className="pointer-events-none absolute left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-1 rounded-md border border-base-300 bg-base-100 p-1 opacity-0 shadow-lg transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
											{family.colors.map((_, levelIndex) => {
												const idx = getTerrainPaletteIndex(familyIndex, levelIndex);
												return (
													<button
														key={idx}
														type="button"
														className={`h-6 w-6 rounded ${
															selectedColorIndex === idx
																? "ring-2 ring-primary"
																: "ring-1 ring-base-300"
														}`}
														style={{ backgroundColor: getTerrainColorByIndex(idx) }}
														onClick={() => setSelectedColorIndex(idx)}
														title={`${family.label} ${levelIndex + 1}`}
													/>
												);
											})}
										</div>
									)}
								</div>
							);
						})}
					</div>
				</div>

				{/* Row 3: Presets (normal mode only) */}
				{mode === "normal" && (
					<div className="flex flex-wrap items-center gap-2 rounded-lg border border-base-300 bg-base-100 p-2">
						<span className="text-sm font-medium opacity-70">Presets</span>
						<div className="flex flex-wrap gap-1">
							<button
								type="button"
								className="btn btn-sm"
								onClick={() => handlePreset("hills")}
								disabled={readOnly}
								title="Add random hills to the terrain"
							>
								<span className="icon-[mdi--terrain]" /> Hills
							</button>
							<button
								type="button"
								className="btn btn-sm"
								onClick={() => handlePreset("trees")}
								disabled={readOnly}
								title="Add random tree-like pillars"
							>
								<span className="icon-[mdi--pine-tree]" /> Trees
							</button>
							<button
								type="button"
								className="btn btn-sm"
								onClick={() => handlePreset("smooth")}
								disabled={readOnly}
								title="Smooth jagged terrain edges"
							>
								<span className="icon-[mdi--blur]" /> Smooth
							</button>
							<div className="mx-1 hidden min-h-8 w-px bg-base-300 sm:block" />
							<button
								type="button"
								className={`btn btn-sm ${flattenConfirm ? "btn-warning" : ""}`}
								onClick={handleFlatten}
								disabled={readOnly}
								title="Reset all heights to 0"
							>
								<span className="icon-[mdi--eraser]" /> {flattenConfirm ? "Confirm?" : "Flatten"}
							</button>
						</div>
					</div>
				)}
			</div>

			{/* Grid container */}
			{/* TODO: exiting detail mode doesn't shrink the parent card if it expanded to fit the larger grid -- requires a fixed-height layout ancestor to solve properly */}
			<div
				ref={gridContainerRef}
				className={`flex-1 w-full ${
					detailMode
						? "overflow-auto"
						: "flex items-center justify-center overflow-hidden"
				}`}
				style={
					!detailMode
						? { minWidth: minGridWidth, minHeight: minGridHeight }
						: undefined
				}
				onWheel={detailMode ? onGridContainerWheel : undefined}
			>
				<div
					ref={gridRef}
					className="bg-base-300 relative"
					style={gridStyle}
					onPointerDown={onGridPointerDown}
					onPointerMove={onGridPointerMove}
					onPointerUp={onGridPointerUp}
					onPointerLeave={onGridPointerLeave}
				>
					{Array.from({ length: displayRows }, (_, dy) =>
						Array.from({ length: displayCols }, (_, dx) => {
							// Derive display color/height from tile or subcell data
							const tx = detailMode ? Math.floor(dx / resolution) : dx;
							const ty = detailMode ? Math.floor(dy / resolution) : dy;

							let colorIndex = maps.colorMap[ty]?.[tx] ?? DEFAULT_TERRAIN_COLOR_INDEX;
							let h = clamp(maps.heightMap[ty]?.[tx] ?? 0, 0, clampedMaxHeight);

							// In detail mode: use per-subcell voxel data for color and height
							if (detailMode && subcellDetailData) {
								const cellKey = getTileKey(dx, dy);
								const voxelColor = subcellDetailData.colors.get(cellKey);
								if (voxelColor != null) colorIndex = voxelColor;
								const subcellH = subcellDetailData.heights.get(cellKey);
								if (subcellH != null) h = subcellH;
							}

							const color = getTerrainColorByIndex(colorIndex);
							const overlay = Math.round((h / clampedMaxHeight - 0.5) * 30);
							const adjustedColor = adjustHexBrightness(color, 100 + overlay * 2);
							const heightTextStyle = getReadableTextStyle(adjustedColor);
							const isHovered = hoveredTiles.has(getTileKey(dx, dy));

							// In detail mode: draw a subtle boundary between tiles
							const isTileBoundaryX = detailMode && resolution > 1 && dx % resolution === 0;
							const isTileBoundaryY = detailMode && resolution > 1 && dy % resolution === 0;
							const hasTileBorder = isTileBoundaryX || isTileBoundaryY;

							return (
								<div
									key={`${dx}-${dy}`}
									style={{
										width: activeTilePx,
										height: activeTilePx,
										backgroundColor: adjustedColor,
										borderRadius: detailMode ? 0 : 1,
										position: "relative",
										boxShadow: isHovered
											? activeTool === "clear"
												? "inset 0 0 0 1px rgba(248,113,113,0.9)"
												: "inset 0 0 0 1px rgba(255,255,255,0.8)"
											: hasTileBorder
												? "inset 1px 1px 0 rgba(0,0,0,0.18)"
												: undefined,
									}}
								>
									{showHeights && heightFontSize > 0 && !detailMode && (
										<span
											style={{
												position: "absolute",
												inset: 0,
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												fontSize: heightFontSize,
												fontWeight: 600,
												color: heightTextStyle.color,
												textShadow: heightTextStyle.textShadow,
												pointerEvents: "none",
											}}
										>
											{h}
										</span>
									)}
								</div>
							);
						})
					)}
				</div>
			</div>

			{/* Footer */}
			<div ref={footerRef} className="shrink-0 pt-2 flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-2">
					{/* Sculpt toggle */}
					<button
						type="button"
						className={`btn btn-sm gap-1 ${mode === "sculpt" ? "btn-primary" : "btn-ghost"}`}
						onClick={() => setMode((m) => m === "sculpt" ? "normal" : "sculpt")}
						disabled={readOnly}
						title={mode === "sculpt" ? "Switch to normal mode" : "Switch to sculpt mode"}
					>
						<span className="icon-[mdi--cube-scan]" />
						Sculpt
					</button>
					{/* Detail toggle */}
					<button
						type="button"
						className={`btn btn-sm gap-1 ${detailMode ? "btn-info" : "btn-ghost"}`}
						onClick={() => setDetailMode((v) => !v)}
						disabled={readOnly}
						title={detailMode ? "Switch to standard grid" : "Switch to fine detail grid (subcell resolution)"}
					>
						<span className="icon-[mdi--magnify-plus-outline]" />
						Detail
					</button>

					<div className="join" aria-label="Mirror mode">
						<button
							type="button"
							className={`btn btn-sm join-item gap-1 ${mirrorHorizontal ? "btn-info" : "btn-ghost"}`}
							onClick={() => setMirrorHorizontal((value) => !value)}
							disabled={readOnly}
							title="Mirror horizontally"
						>
							<span className="icon-[mdi--reflect-horizontal]" />
							<span className="hidden sm:inline">Mirror X</span>
						</button>
						<button
							type="button"
							className={`btn btn-sm join-item gap-1 ${mirrorVertical ? "btn-info" : "btn-ghost"}`}
							onClick={() => setMirrorVertical((value) => !value)}
							disabled={readOnly}
							title="Mirror vertically"
						>
							<span className="icon-[mdi--reflect-vertical]" />
							<span className="hidden sm:inline">Mirror Y</span>
						</button>
					</div>

					{detailMode && (
						<div className="flex items-center gap-1 text-xs opacity-60">
							<span className="icon-[mdi--magnify]" />
							<span>{activeTilePx}px</span>
							<span className="hidden sm:inline">(Ctrl+scroll to zoom)</span>
						</div>
					)}
				</div>

				<button
					type="button"
					className={`btn btn-sm gap-1 ${showHeights ? "btn-info" : "btn-ghost"}`}
					onClick={() => setShowHeights((v) => !v)}
					title="Toggle height numbers"
					disabled={detailMode}
				>
					<span className="icon-[mdi--numeric]" />
					<span>Heights</span>
				</button>
			</div>
		</div>
	);
}

export default VoxelTerrainEditor;
