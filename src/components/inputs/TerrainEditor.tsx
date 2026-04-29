// components/inputs/TerrainEditor.tsx
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { TerrainType, TERRAIN_TYPES, getTerrainColorByIndex } from "../../domains/Terrain/Terrain";
import { useFormReadOnly } from "../Form/Form";
import {
	applyRandomHills,
	applyRandomTrees,
	applyRandomIslands,
	applyRandomValley,
	applyFlatten,
	applySmooth,
} from "../../utils/TerrainUtils";

type Tool = "paint" | "raise" | "lower" | "set";
type BrushShape = "square" | "round";

const TOOL_OPTIONS: Array<{
	value: Tool;
	label: string;
	icon: string;
	title: string;
}> = [
	{
		value: "paint",
		label: "Paint",
		icon: "icon-[mdi--brush]",
		title: "Paint color",
	},
	{
		value: "raise",
		label: "Raise",
		icon: "icon-[mdi--arrow-up-bold]",
		title: "Raise terrain",
	},
	{
		value: "lower",
		label: "Lower",
		icon: "icon-[mdi--arrow-down-bold]",
		title: "Lower terrain",
	},
	{
		value: "set",
		label: "Set",
		icon: "icon-[mdi--ruler]",
		title: "Set fixed height",
	},
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

export interface TerrainEditorProps {
	width: number;
	length: number;
	heightMap: number[][];
	colorMap: number[][];
	readOnly?: boolean;
	onChange(next: {
		width: number;
		length: number;
		heightMap: number[][];
		colorMap: number[][];
	}): void;
}

// ============================================================================
// UTILITIES
// ============================================================================

const GRID_GAP = 1;
const MAX_HISTORY = 50;
const MIN_TILE_PX = 4;
const MAX_TILE_PX = 24;

const clamp = (v: number, min: number, max: number) =>
	Math.max(min, Math.min(max, v));

function clone2DNumber(arr: number[][]): number[][] {
	return arr.map((row) => row.slice());
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

/** Get set of tiles that would be affected by brush at position */
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
		tiles.add(`${x},${y}`);
	});
	return tiles;
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

interface HistorySnapshot {
	heightMap: number[][];
	colorMap: number[][];
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function TerrainEditor({
	width,
	length,
	heightMap,
	colorMap,
	readOnly,
	onChange,
}: TerrainEditorProps) {
	const formReadOnly = useFormReadOnly();
	const isReadOnly = readOnly ?? formReadOnly;

	// Tool state
	const [tool, setTool] = useState<Tool>("paint");
	const [brushSize, setBrushSize] = useState<number>(1);
	const [brushShape, setBrushShape] = useState<BrushShape>("square");
	const [selectedColorIndex, setSelectedColorIndex] = useState<number>(0);
	const [targetHeight, setTargetHeight] = useState<number>(8);

	// Display options
	const [showHeights, setShowHeights] = useState(false);

	// Hover state for brush preview
	const [hoverTile, setHoverTile] = useState<{ x: number; y: number } | null>(null);

	// Flatten confirmation state
	const [flattenConfirm, setFlattenConfirm] = useState(false);

	// ========================================================================
	// UNDO / REDO
	// ========================================================================
	const [undoStack, setUndoStack] = useState<HistorySnapshot[]>([]);
	const [redoStack, setRedoStack] = useState<HistorySnapshot[]>([]);

	const pushToHistory = useCallback(() => {
		const snapshot: HistorySnapshot = {
			heightMap: clone2DNumber(heightMap),
			colorMap: clone2DNumber(colorMap),
		};
		setUndoStack((prev) => {
			const next = [...prev, snapshot];
			if (next.length > MAX_HISTORY) next.shift();
			return next;
		});
		setRedoStack([]);
	}, [heightMap, colorMap]);

	const undo = useCallback(() => {
		if (undoStack.length === 0 || isReadOnly) return;

		const currentSnapshot: HistorySnapshot = {
			heightMap: clone2DNumber(heightMap),
			colorMap: clone2DNumber(colorMap),
		};
		setRedoStack((prev) => [...prev, currentSnapshot]);

		const newUndoStack = [...undoStack];
		const snapshot = newUndoStack.pop()!;
		setUndoStack(newUndoStack);

		onChange({
			width,
			length,
			heightMap: snapshot.heightMap,
			colorMap: snapshot.colorMap,
		});
	}, [undoStack, heightMap, colorMap, width, length, onChange, isReadOnly]);

	const redo = useCallback(() => {
		if (redoStack.length === 0 || isReadOnly) return;

		const currentSnapshot: HistorySnapshot = {
			heightMap: clone2DNumber(heightMap),
			colorMap: clone2DNumber(colorMap),
		};
		setUndoStack((prev) => [...prev, currentSnapshot]);

		const newRedoStack = [...redoStack];
		const snapshot = newRedoStack.pop()!;
		setRedoStack(newRedoStack);

		onChange({
			width,
			length,
			heightMap: snapshot.heightMap,
			colorMap: snapshot.colorMap,
		});
	}, [redoStack, heightMap, colorMap, width, length, onChange, isReadOnly]);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (isReadOnly) return;

			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
				e.preventDefault();
				if (e.shiftKey) {
					redo();
				} else {
					undo();
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [undo, redo, isReadOnly]);

	// ========================================================================
	// LAYOUT
	// ========================================================================
	const containerRef = useRef<HTMLDivElement | null>(null);
	const toolbarStackRef = useRef<HTMLDivElement | null>(null);
	const gridContainerRef = useRef<HTMLDivElement | null>(null);
	const footerRef = useRef<HTMLDivElement | null>(null);
	const [tilePx, setTilePx] = useState<number>(16);
	const [toolbarHeight, setToolbarHeight] = useState<number>(0);
	const [footerHeight, setFooterHeight] = useState<number>(0);

	const minGridWidth = Math.max(0, width * MIN_TILE_PX + (width - 1) * GRID_GAP);
	const minGridHeight = Math.max(
		0,
		length * MIN_TILE_PX + (length - 1) * GRID_GAP
	);
	const editorMinHeight = toolbarHeight + footerHeight + minGridHeight + 12;

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

	useEffect(() => {
		if (!containerRef.current || !gridContainerRef.current) return;

		const compute = () => {
			const container = containerRef.current;
			const gridContainer = gridContainerRef.current;
			if (!container || !gridContainer) return;

			const gridRect = gridContainer.getBoundingClientRect();

			const availableW = gridRect.width;
			const availableH = gridRect.height;

			if (width <= 0 || length <= 0 || availableW <= 0 || availableH <= 0)
				return;

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

		return () => {
			ro.disconnect();
		};
	}, [width, length, toolbarHeight, footerHeight]);

	// ========================================================================
	// STROKE HANDLING
	// ========================================================================
	const isPointerDownRef = useRef(false);
	const touchedRef = useRef<Set<string>>(new Set());
	const workHeightsRef = useRef<number[][] | null>(null);
	const workColorsRef = useRef<number[][] | null>(null);
	const rafRef = useRef<number | null>(null);
	const hasChangedRef = useRef(false);

	const beginStroke = useCallback(() => {
		touchedRef.current = new Set();
		workHeightsRef.current = clone2DNumber(heightMap);
		workColorsRef.current = clone2DNumber(colorMap);
		hasChangedRef.current = false;
		pushToHistory();
	}, [heightMap, colorMap, pushToHistory]);

	const scheduleCommit = useCallback(() => {
		if (rafRef.current != null) return;
		rafRef.current = requestAnimationFrame(() => {
			rafRef.current = null;
			if (!workHeightsRef.current || !workColorsRef.current) return;
			hasChangedRef.current = true;
			onChange({
				width,
				length,
				heightMap: workHeightsRef.current,
				colorMap: workColorsRef.current,
			});
		});
	}, [onChange, width, length]);

	const endStroke = useCallback(() => {
		isPointerDownRef.current = false;
		touchedRef.current.clear();
		workHeightsRef.current = null;
		workColorsRef.current = null;
		if (rafRef.current != null) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
		if (!hasChangedRef.current) {
			setUndoStack((prev) => prev.slice(0, -1));
		}
	}, []);

	const applyAt = useCallback(
		(gx: number, gy: number) => {
			if (!workHeightsRef.current || !workColorsRef.current) return;

			applyBrush(gx, gy, brushSize, brushShape, width, length, (x, y) => {
				const key = `${x},${y}`;
				if (touchedRef.current.has(key)) return;
				touchedRef.current.add(key);

				if (tool === "paint") {
					workColorsRef.current![y][x] = selectedColorIndex;
				} else if (tool === "raise") {
					workHeightsRef.current![y][x] = clamp(
						workHeightsRef.current![y][x] + 1,
						0,
						16
					);
				} else if (tool === "lower") {
					workHeightsRef.current![y][x] = clamp(
						workHeightsRef.current![y][x] - 1,
						0,
						16
					);
				} else if (tool === "set") {
					workHeightsRef.current![y][x] = clamp(targetHeight, 0, 16);
				}
			});

			scheduleCommit();
		},
		[brushSize, brushShape, width, length, selectedColorIndex, tool, targetHeight, scheduleCommit]
	);

	// ========================================================================
	// GRID POINTER EVENTS
	// ========================================================================
	const gridRef = useRef<HTMLDivElement | null>(null);

	const eventToGridXY = useCallback(
		(clientX: number, clientY: number) => {
			const grid = gridRef.current;
			if (!grid) return null;
			const rect = grid.getBoundingClientRect();
			const relX = clientX - rect.left;
			const relY = clientY - rect.top;

			const stepX = tilePx + GRID_GAP;
			const stepY = tilePx + GRID_GAP;
			if (stepX <= 0 || stepY <= 0) return null;

			// Allow returning null if completely outside
			if (relX < 0 || relY < 0) return null;
			const x = Math.floor(relX / stepX);
			const y = Math.floor(relY / stepY);
			if (x >= width || y >= length) return null;

			return { x, y };
		},
		[tilePx, width, length]
	);

	const onGridPointerDown = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (isReadOnly) return;
			isPointerDownRef.current = true;
			beginStroke();
			const pt = eventToGridXY(e.clientX, e.clientY);
			if (pt) applyAt(pt.x, pt.y);
		},
		[applyAt, beginStroke, eventToGridXY, isReadOnly]
	);

	const onGridPointerMove = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			const pt = eventToGridXY(e.clientX, e.clientY);
			setHoverTile(pt);

			if (!isPointerDownRef.current || isReadOnly) return;
			if (pt) applyAt(pt.x, pt.y);
		},
		[applyAt, eventToGridXY, isReadOnly]
	);

	const onGridPointerLeave = useCallback(() => {
		setHoverTile(null);
		if (!isPointerDownRef.current) return;
		endStroke();
	}, [endStroke]);

	const onGridPointerUp = useCallback(() => {
		if (!isPointerDownRef.current) return;
		endStroke();
	}, [endStroke]);

	// Compute hovered brush tiles
	const hoveredTiles = useMemo(() => {
		if (!hoverTile || isReadOnly) return new Set<string>();
		return getBrushTiles(hoverTile.x, hoverTile.y, brushSize, brushShape, width, length);
	}, [hoverTile, brushSize, brushShape, width, length, isReadOnly]);

	// ========================================================================
	// PRESET HANDLERS
	// ========================================================================
	const handlePreset = useCallback(
		(preset: "hills" | "trees" | "islands" | "valley" | "smooth") => {
			if (isReadOnly) return;

			pushToHistory();

			let newHeightMap: number[][];

			switch (preset) {
				case "hills":
					newHeightMap = applyRandomHills(heightMap, width, length);
					break;
				case "trees":
					newHeightMap = applyRandomTrees(heightMap, width, length);
					break;
				case "islands":
					newHeightMap = applyRandomIslands(heightMap, width, length);
					break;
				case "valley":
					newHeightMap = applyRandomValley(heightMap, width, length);
					break;
				case "smooth":
					newHeightMap = applySmooth(heightMap, width, length, 1);
					break;
				default:
					return;
			}

			onChange({
				width,
				length,
				heightMap: newHeightMap,
				colorMap,
			});
		},
		[isReadOnly, heightMap, colorMap, width, length, onChange, pushToHistory]
	);

	const handleFlatten = useCallback(() => {
		if (isReadOnly) return;

		if (!flattenConfirm) {
			setFlattenConfirm(true);
			setTimeout(() => setFlattenConfirm(false), 3000);
			return;
		}

		pushToHistory();
		const newHeightMap = applyFlatten(heightMap, width, length);
		onChange({
			width,
			length,
			heightMap: newHeightMap,
			colorMap,
		});
		setFlattenConfirm(false);
	}, [isReadOnly, flattenConfirm, heightMap, colorMap, width, length, onChange, pushToHistory]);

	// ========================================================================
	// FILL ALL
	// ========================================================================
	const doFillAll = useCallback(() => {
		if (isReadOnly) return;
		pushToHistory();
		if (tool === "set") {
			const nextHeights = heightMap.map((row) =>
				row.map(() => clamp(targetHeight, 0, 16))
			);
			onChange({ width, length, heightMap: nextHeights, colorMap });
		} else {
			const nextColors = colorMap.map((row) => row.map(() => selectedColorIndex));
			onChange({ width, length, heightMap, colorMap: nextColors });
		}
	}, [
		isReadOnly,
		tool,
		heightMap,
		colorMap,
		targetHeight,
		selectedColorIndex,
		onChange,
		width,
		length,
		pushToHistory,
	]);

	const palette: TerrainType[] = useMemo(() => [...TERRAIN_TYPES], []);

	// Determine font size for height labels based on grid size and tile size
	const heightFontSize = useMemo(() => {
		const maxDim = Math.max(width, length);
		if (maxDim > 40 || tilePx < 12) return 8; // Too small, hide numbers
		if (maxDim > 32 || tilePx < 16) return 12;
		if (maxDim > 24 || tilePx < 20) return 16;
		return 20;
	}, [width, length, tilePx]);

	const gridStyle: React.CSSProperties = useMemo(
		() => ({
			display: "grid",
			gridTemplateColumns: `repeat(${width}, ${tilePx}px)`,
			gridTemplateRows: `repeat(${length}, ${tilePx}px)`,
			gap: GRID_GAP,
			width: Math.max(0, width * tilePx + (width - 1) * GRID_GAP),
			height: Math.max(0, length * tilePx + (length - 1) * GRID_GAP),
			userSelect: "none",
			touchAction: "none",
			pointerEvents: isReadOnly ? "none" : "auto",
		}),
		[width, length, tilePx, isReadOnly]
	);

	return (
		<div
			ref={containerRef}
			className="w-full h-full flex flex-col min-h-0"
			style={{ minHeight: editorMinHeight }}
		>
			<div ref={toolbarStackRef} className="shrink-0 space-y-2">
				<div className="flex flex-wrap items-center gap-3 rounded-lg border border-base-300 bg-base-200/60 p-2">
					<div className="flex items-center gap-1" aria-label="History">
						<button
							type="button"
							className="btn btn-sm btn-square btn-ghost"
							onClick={undo}
							disabled={isReadOnly || undoStack.length === 0}
							title="Undo (Ctrl+Z)"
						>
							<span className="icon-[mdi--undo]" />
						</button>
						<button
							type="button"
							className="btn btn-sm btn-square btn-ghost"
							onClick={redo}
							disabled={isReadOnly || redoStack.length === 0}
							title="Redo (Ctrl+Shift+Z)"
						>
							<span className="icon-[mdi--redo]" />
						</button>
					</div>

					<div className="h-8 w-px bg-base-300" />

					<div className="flex items-center gap-2">
						<span className="text-sm font-medium opacity-70">Tool</span>
						<div className="join">
							{TOOL_OPTIONS.map((option) => (
								<button
									key={option.value}
									type="button"
									className={`btn btn-sm join-item gap-1 ${
										tool === option.value ? "btn-primary" : ""
									}`}
									onClick={() => setTool(option.value)}
									disabled={isReadOnly}
									title={option.title}
								>
									<span className={option.icon} />
									<span className="hidden 2xl:inline">{option.label}</span>
								</button>
							))}
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<span className="text-sm font-medium opacity-70">Brush</span>
						<div className="flex items-center gap-1">
							{BRUSH_OPTIONS.map(({ size, shape }) => {
								const footprint = size * 2 - 1;
								const isSelected =
									brushSize === size && brushShape === shape;
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
										disabled={isReadOnly}
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
						</div>
					</div>

					{tool === "set" && (
						<div className="flex items-center gap-2">
							<span className="text-sm font-medium opacity-70">Height</span>
							<input
								type="number"
								min={0}
								max={16}
								step={1}
								value={targetHeight}
								onChange={(e) =>
									setTargetHeight(clamp(Number(e.target.value) || 0, 0, 16))
								}
								className="input input-sm input-bordered w-16 text-center"
								disabled={isReadOnly}
							/>
						</div>
					)}

					{tool === "set" && (
						<button
							type="button"
							onClick={doFillAll}
							className="btn btn-sm btn-secondary"
							disabled={isReadOnly}
							title="Set height for all tiles"
						>
							<span className="icon-[mdi--format-color-fill]" />
							Fill Height
						</button>
					)}
				</div>

				{tool === "paint" && (
					<div className="flex flex-wrap items-center gap-3 rounded-lg border border-base-300 bg-base-100 p-2">
						<span className="text-sm font-medium opacity-70">Color</span>
						<div className="flex flex-wrap items-center gap-1">
							{palette.map((c, idx) => (
								<button
									key={c}
									type="button"
									className={`h-7 w-7 rounded ${
										selectedColorIndex === idx
											? "ring-2 ring-offset-2 ring-primary"
											: "ring-1 ring-base-300"
									}`}
									style={{ backgroundColor: getTerrainColorByIndex(idx) }}
									onClick={() => setSelectedColorIndex(idx)}
									disabled={isReadOnly}
									title={c}
								/>
							))}
						</div>
						<button
							type="button"
							onClick={doFillAll}
							className="btn btn-sm btn-secondary"
							disabled={isReadOnly}
							title="Fill all tiles with selected color"
						>
							<span className="icon-[mdi--format-color-fill]" />
							Fill Color
						</button>
					</div>
				)}

				<div className="flex flex-wrap items-center gap-2 rounded-lg border border-base-300 bg-base-100 p-2">
					<span className="text-sm font-medium opacity-70">Presets</span>
					<div className="flex flex-wrap gap-1">
						<button
							type="button"
							className="btn btn-sm"
							onClick={() => handlePreset("hills")}
							disabled={isReadOnly}
							title="Add random hills to the terrain"
						>
							<span className="icon-[mdi--terrain]" /> Hills
						</button>
						<button
							type="button"
							className="btn btn-sm"
							onClick={() => handlePreset("trees")}
							disabled={isReadOnly}
							title="Add random tree-like pillars"
						>
							<span className="icon-[mdi--pine-tree]" /> Trees
						</button>
						<button
							type="button"
							className="btn btn-sm"
							onClick={() => handlePreset("islands")}
							disabled={isReadOnly}
							title="Add raised plateau islands"
						>
							<span className="icon-[mdi--island]" /> Islands
						</button>
						<button
							type="button"
							className="btn btn-sm"
							onClick={() => handlePreset("valley")}
							disabled={isReadOnly}
							title="Carve a meandering valley (subtractive)"
						>
							<span className="icon-[game-icons--edge-crack]" /> Valley
						</button>
						<button
							type="button"
							className="btn btn-sm"
							onClick={() => handlePreset("smooth")}
							disabled={isReadOnly}
							title="Smooth jagged terrain edges"
						>
							<span className="icon-[mdi--blur]" /> Smooth
						</button>
						<div className="mx-1 hidden min-h-8 w-px bg-base-300 sm:block" />
						<button
							type="button"
							className={`btn btn-sm ${flattenConfirm ? "btn-warning" : ""}`}
							onClick={handleFlatten}
							disabled={isReadOnly}
							title="Reset all heights to 0"
						>
							<span className="icon-[mdi--eraser]" /> {flattenConfirm ? "Confirm?" : "Flatten"}
						</button>
					</div>
				</div>
			</div>

			{/* Grid Container */}
			<div
				ref={gridContainerRef}
				className="flex-1 w-full flex items-center justify-center overflow-hidden"
				style={{ minWidth: minGridWidth, minHeight: minGridHeight }}
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
					{Array.from({ length }, (_, y) =>
						Array.from({ length: width }, (_, x) => {
							const colorIndex = colorMap[y][x] ?? 0;
							const color = getTerrainColorByIndex(colorIndex);
							const h = clamp(heightMap[y][x] ?? 0, 0, 16);
							const overlay = Math.round((h / 16 - 0.5) * 30);
							const filter = `brightness(${100 + overlay * 2}%)`;
							const isHovered = hoveredTiles.has(`${x},${y}`);

							return (
								<div
									key={`${x}-${y}`}
									style={{
										width: tilePx,
										height: tilePx,
										backgroundColor: color,
										filter,
										borderRadius: 1,
										position: "relative",
										boxShadow: isHovered
											? "inset 0 0 0 1px rgba(255,255,255,0.8)"
											: undefined,
									}}
								>
									{showHeights && heightFontSize > 0 && (
										<span
											style={{
												position: "absolute",
												inset: 0,
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												fontSize: heightFontSize,
												fontWeight: 600,
												color: "rgba(0,0,0,0.9)",
												textShadow: "0 0 2px rgba(0,0,0,0.2)",
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

			<div ref={footerRef} className="shrink-0 pt-2 flex justify-end">
				<button
					type="button"
					className={`btn btn-sm gap-1 ${showHeights ? "btn-info" : "btn-ghost"}`}
					onClick={() => setShowHeights((v) => !v)}
					title="Toggle height numbers"
				>
					<span className="icon-[mdi--numeric]" />
					<span>Heights</span>
				</button>
			</div>
		</div>
	);
}

export default TerrainEditor;
