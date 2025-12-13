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

type Tool = "paint" | "raise" | "lower" | "set";

export interface TerrainEditorProps {
	width: number;
	length: number;
	heightMap: number[][];
	colorMap: number[][]; // Color indices into TERRAIN_TYPES
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
	const [selectedColorIndex, setSelectedColorIndex] = useState<number>(0); // Index into TERRAIN_TYPES
	const [targetHeight, setTargetHeight] = useState<number>(8);

	// Layout: calculate tile size to fill container
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

			// Available space for the grid (subtract toolbar height from container)
			const availableW = gridRect.width;
			const availableH = gridRect.height;

			if (width <= 0 || length <= 0 || availableW <= 0 || availableH <= 0)
				return;

			// Calculate tile size that fills the available space
			// Account for gaps between tiles
			const gapTotalW = GRID_GAP * (width - 1);
			const gapTotalH = GRID_GAP * (length - 1);

			const maxTileW = (availableW - gapTotalW) / width;
			const maxTileH = (availableH - gapTotalH) / length;

			// Use the smaller dimension to keep tiles square, then floor it
			const px = Math.floor(Math.min(maxTileW, maxTileH));

			// Only update if changed and within reasonable bounds
			if (px >= 4 && px !== tilePx) {
				setTilePx(px);
			}
		};

		// Initial calculation
		compute();

		// Recalculate on resize
		const ro = new ResizeObserver(compute);
		ro.observe(containerRef.current);

		return () => {
			ro.disconnect();
		};
	}, [width, length, tilePx]);

	// Stroke batching & deduplication
	const isPointerDownRef = useRef(false);
	const touchedRef = useRef<Set<string>>(new Set());
	const workHeightsRef = useRef<number[][] | null>(null);
	const workColorsRef = useRef<number[][] | null>(null);
	const rafRef = useRef<number | null>(null);

	const beginStroke = useCallback(() => {
		touchedRef.current = new Set();
		workHeightsRef.current = clone2DNumber(heightMap);
		workColorsRef.current = clone2DNumber(colorMap);
	}, [heightMap, colorMap]);

	const scheduleCommit = useCallback(() => {
		if (rafRef.current != null) return;
		rafRef.current = requestAnimationFrame(() => {
			rafRef.current = null;
			if (!workHeightsRef.current || !workColorsRef.current) return;
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
	}, []);

	// Apply tool at grid position
	const applyAt = useCallback(
		(gx: number, gy: number) => {
			if (!workHeightsRef.current || !workColorsRef.current) return;

			applySquareBrush(gx, gy, brushSize, width, length, (x, y) => {
				const key = `${x},${y}`;
				if (touchedRef.current.has(key)) return; // Dedupe
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
		[
			brushSize,
			width,
			length,
			selectedColorIndex,
			tool,
			targetHeight,
			scheduleCommit,
		]
	);

	// Grid-level pointer handling
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

			const x = clamp(Math.floor(relX / stepX), 0, width - 1);
			const y = clamp(Math.floor(relY / stepY), 0, length - 1);
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
			if (!isPointerDownRef.current || isReadOnly) return;
			const pt = eventToGridXY(e.clientX, e.clientY);
			if (pt) applyAt(pt.x, pt.y);
		},
		[applyAt, eventToGridXY, isReadOnly]
	);

	const onGridPointerUpOrLeave = useCallback(() => {
		if (!isPointerDownRef.current) return;
		endStroke();
	}, [endStroke]);

	// Actions
	const doFillAll = useCallback(() => {
		if (isReadOnly) return;
		if (tool === "set") {
			// Fill the entire grid with the target height, keep colors as-is
			const nextHeights = heightMap.map((row) =>
				row.map(() => clamp(targetHeight, 0, 16))
			);
			onChange({ width, length, heightMap: nextHeights, colorMap });
		} else {
			// Paint mode behavior - fill with selected color index
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
	]);

	const palette: TerrainType[] = useMemo(
		() => [...TERRAIN_TYPES],
		[]
	);

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
			{/* Main Toolbar */}
			<div className="flex flex-wrap items-center gap-3 mb-2">
				<div className="flex items-center gap-2">
					<span className="text-sm opacity-70">Tool</span>
					<div className="join">
						<button
							type="button"
							className={`btn btn-sm join-item ${tool === "paint" ? "btn-primary" : ""
								}`}
							onClick={() => setTool("paint")}
							disabled={isReadOnly}
							title="Paint color"
						>
							<span className="icon-[mdi--brush]" />
						</button>
						<button
							type="button"
							className={`btn btn-sm join-item ${tool === "raise" ? "btn-primary" : ""
								}`}
							onClick={() => setTool("raise")}
							disabled={isReadOnly}
							title="Raise terrain"
						>
							<span className="icon-[mdi--arrow-up-bold]" />
						</button>
						<button
							type="button"
							className={`btn btn-sm join-item ${tool === "lower" ? "btn-primary" : ""
								}`}
							onClick={() => setTool("lower")}
							disabled={isReadOnly}
							title="Lower terrain"
						>
							<span className="icon-[mdi--arrow-down-bold]" />
						</button>
						<button
							type="button"
							className={`btn btn-sm join-item ${tool === "set" ? "btn-primary" : ""
								}`}
							onClick={() => setTool("set")}
							disabled={isReadOnly}
							title="Set fixed height"
						>
							<span className="icon-[mdi--ruler]" />
						</button>
					</div>
				</div>
				{/* Set Height input */}
				<div className="flex items-center gap-2">
					<input
						type="number"
						min={0}
						max={16}
						step={1}
						value={targetHeight}
						onChange={(e) =>
							setTargetHeight(clamp(Number(e.target.value) || 0, 0, 16))
						}
						className="input input-sm input-bordered w-12 text-center"
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
					<span className="text-xs tabular-nums w-6 text-center">
						{brushSize}
					</span>
				</div>

				<div className="flex items-center gap-2">
					<span className="text-sm opacity-70">Color</span>
					<div className="flex items-center gap-1">
						{palette.map((c, idx) => (
							<button
								key={c}
								type="button"
								className={`w-6 h-6 rounded ${selectedColorIndex === idx
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
				</div>
			</div>

			{/* Presets Toolbar */}
			<div className="flex items-center gap-2 mb-3">
				<span className="text-sm opacity-70">Presets</span>
				<div className="join">
					<button className="btn btn-sm join-item btn-disabled">
						Random Hills
					</button>
					<button className="btn btn-sm join-item btn-disabled">
						Random Trees
					</button>
					<button className="btn btn-sm join-item btn-disabled">
						Random Islands
					</button>
					<button className="btn btn-sm join-item btn-disabled">
						Random Valley
					</button>
					<button className="btn btn-sm join-item btn-disabled">
						Reset (Flatten)
					</button>
				</div>
			</div>

			{/* Grid Container - grows to fill remaining space */}
			<div
				ref={gridContainerRef}
				className="flex-1 w-full flex items-center justify-center overflow-hidden"
			>
				<div
					ref={gridRef}
					className="bg-base-300"
					style={gridStyle}
					onPointerDown={onGridPointerDown}
					onPointerMove={onGridPointerMove}
					onPointerUp={onGridPointerUpOrLeave}
					onPointerLeave={onGridPointerUpOrLeave}
				>
					{Array.from({ length }, (_, y) =>
						Array.from({ length: width }, (_, x) => {
							const colorIndex = colorMap[y][x] ?? 0;
							const color = getTerrainColorByIndex(colorIndex);
							const h = clamp(heightMap[y][x] ?? 0, 0, 16);
							const overlay = Math.round((h / 16 - 0.5) * 30);
							const filter = `brightness(${100 + overlay * 2}%)`;

							return (
								<div
									key={`${x}-${y}`}
									style={{
										width: tilePx,
										height: tilePx,
										backgroundColor: color,
										filter,
										borderRadius: 1,
									}}
								/>
							);
						})
					)}
				</div>
			</div>
		</div>
	);
}

export default TerrainEditor;
