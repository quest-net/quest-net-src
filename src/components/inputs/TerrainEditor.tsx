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

/** Get set of tiles that would be affected by brush at position */
function getBrushTiles(
	cx: number,
	cy: number,
	size: number,
	width: number,
	length: number
): Set<string> {
	const tiles = new Set<string>();
	applySquareBrush(cx, cy, size, width, length, (x, y) => {
		tiles.add(`${x},${y}`);
	});
	return tiles;
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
	const gridContainerRef = useRef<HTMLDivElement | null>(null);
	const [tilePx, setTilePx] = useState<number>(16);

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

			const px = Math.floor(Math.min(maxTileW, maxTileH));

			if (px >= 4 && px !== tilePx) {
				setTilePx(px);
			}
		};

		compute();

		const ro = new ResizeObserver(compute);
		ro.observe(containerRef.current);

		return () => {
			ro.disconnect();
		};
	}, [width, length, tilePx]);

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

			applySquareBrush(gx, gy, brushSize, width, length, (x, y) => {
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
		[brushSize, width, length, selectedColorIndex, tool, targetHeight, scheduleCommit]
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
		return getBrushTiles(hoverTile.x, hoverTile.y, brushSize, width, length);
	}, [hoverTile, brushSize, width, length, isReadOnly]);

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
		if (maxDim > 40 || tilePx < 12) return 0; // Too small, hide numbers
		if (maxDim > 32 || tilePx < 16) return 8;
		if (maxDim > 24 || tilePx < 20) return 10;
		return 12;
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
			className="w-full flex flex-col"
			style={{ height: "65vh", minHeight: 400 }}
		>
			{/* Tools Toolbar */}
			<div className="flex flex-wrap items-center gap-3 mb-2">
				{/* Undo/Redo */}
				<div className="flex items-center gap-1">
					<button
						type="button"
						className="btn btn-sm btn-ghost"
						onClick={undo}
						disabled={isReadOnly || undoStack.length === 0}
						title="Undo (Ctrl+Z)"
					>
						<span className="icon-[mdi--undo]" />
					</button>
					<button
						type="button"
						className="btn btn-sm btn-ghost"
						onClick={redo}
						disabled={isReadOnly || redoStack.length === 0}
						title="Redo (Ctrl+Shift+Z)"
					>
						<span className="icon-[mdi--redo]" />
					</button>
				</div>

				<div className="divider divider-horizontal mx-0" />

				<div className="flex items-center gap-2">
					<span className="text-sm opacity-70">Tool</span>
					<div className="join">
						<button
							type="button"
							className={`btn btn-sm join-item ${tool === "paint" ? "btn-primary" : ""}`}
							onClick={() => setTool("paint")}
							disabled={isReadOnly}
							title="Paint color"
						>
							<span className="icon-[mdi--brush]" />
						</button>
						<button
							type="button"
							className={`btn btn-sm join-item ${tool === "raise" ? "btn-primary" : ""}`}
							onClick={() => setTool("raise")}
							disabled={isReadOnly}
							title="Raise terrain"
						>
							<span className="icon-[mdi--arrow-up-bold]" />
						</button>
						<button
							type="button"
							className={`btn btn-sm join-item ${tool === "lower" ? "btn-primary" : ""}`}
							onClick={() => setTool("lower")}
							disabled={isReadOnly}
							title="Lower terrain"
						>
							<span className="icon-[mdi--arrow-down-bold]" />
						</button>
						<button
							type="button"
							className={`btn btn-sm join-item ${tool === "set" ? "btn-primary" : ""}`}
							onClick={() => setTool("set")}
							disabled={isReadOnly}
							title="Set fixed height"
						>
							<span className="icon-[mdi--ruler]" />
						</button>
					</div>
				</div>

				<div className="flex items-center gap-2">
					<span className="text-sm opacity-70">Height</span>
					<input
						type="number"
						min={0}
						max={16}
						step={1}
						value={targetHeight}
						onChange={(e) =>
							setTargetHeight(clamp(Number(e.target.value) || 0, 0, 16))
						}
						className="input input-sm input-bordered w-14 text-center"
						disabled={isReadOnly || tool !== "set"}
					/>
				</div>

				<div className="flex items-center gap-2">
					<span className="text-sm opacity-70">Brush</span>
					<input
						type="range"
						min={1}
						max={5}
						step={1}
						value={brushSize}
						onChange={(e) => setBrushSize(Number(e.target.value))}
						className="range range-xs w-20"
						disabled={isReadOnly}
					/>
					<span className="text-xs tabular-nums w-4 text-center">
						{brushSize}
					</span>
				</div>

				<button
					type="button"
					onClick={doFillAll}
					className="btn btn-sm"
					disabled={isReadOnly}
					title={
						tool === "set"
							? "Set height for all tiles"
							: "Fill all tiles with selected color"
					}
				>
					Fill All
				</button>

				<div className="divider divider-horizontal mx-0" />

				{/* Height display toggle */}
				<button
					type="button"
					className={`btn btn-sm ${showHeights ? "btn-info" : ""}`}
					onClick={() => setShowHeights((v) => !v)}
					title="Toggle height numbers"
				>
					<span className="icon-[mdi--numeric]" />
				</button>
			</div>

			{/* Color Palette Toolbar */}
			<div className="flex items-center gap-3 mb-2">
				<span className="text-sm opacity-70">Color</span>
				<div className="flex items-center gap-1">
					{palette.map((c, idx) => (
						<button
							key={c}
							type="button"
							className={`w-6 h-6 rounded ${
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
			</div>

			{/* Presets Toolbar */}
			<div className="flex items-center gap-2 mb-3">
				<span className="text-sm opacity-70">Presets</span>
				<div className="join">
					<button
						type="button"
						className="btn btn-sm join-item"
						onClick={() => handlePreset("hills")}
						disabled={isReadOnly}
						title="Add random hills to the terrain"
					>
						<span className="icon-[mdi--terrain]" /> Hills
					</button>
					<button
						type="button"
						className="btn btn-sm join-item"
						onClick={() => handlePreset("trees")}
						disabled={isReadOnly}
						title="Add random tree-like pillars"
					>
						<span className="icon-[mdi--pine-tree]" /> Trees
					</button>
					<button
						type="button"
						className="btn btn-sm join-item"
						onClick={() => handlePreset("islands")}
						disabled={isReadOnly}
						title="Add raised plateau islands"
					>
						<span className="icon-[mdi--island]" /> Islands
					</button>
					<button
						type="button"
						className="btn btn-sm join-item"
						onClick={() => handlePreset("valley")}
						disabled={isReadOnly}
						title="Carve a meandering valley (subtractive)"
					>
						<span className="icon-[mdi--valley]" /> Valley
					</button>
					<button
						type="button"
						className="btn btn-sm join-item"
						onClick={() => handlePreset("smooth")}
						disabled={isReadOnly}
						title="Smooth jagged terrain edges"
					>
						<span className="icon-[mdi--blur]" /> Smooth
					</button>
					<button
						type="button"
						className={`btn btn-sm join-item ${flattenConfirm ? "btn-warning" : ""}`}
						onClick={handleFlatten}
						disabled={isReadOnly}
						title="Reset all heights to 0"
					>
						<span className="icon-[mdi--eraser]" /> {flattenConfirm ? "Confirm?" : "Flatten"}
					</button>
				</div>
			</div>

			{/* Grid Container */}
			<div
				ref={gridContainerRef}
				className="flex-1 w-full flex items-center justify-center overflow-hidden"
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
											? "inset 0 0 0 2px rgba(255,255,255,0.8)"
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
												color: h > 8 ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.9)",
												textShadow:
													h > 8
														? "0 0 2px rgba(255,255,255,0.5)"
														: "0 0 2px rgba(0,0,0,0.5)",
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
		</div>
	);
}

export default TerrainEditor;