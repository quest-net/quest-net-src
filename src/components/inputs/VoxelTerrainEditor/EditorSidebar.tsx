// The right-hand sidebar shown in Edit mode.
//
// Includes: voxel-count summary, selection panel (with box-select bounds
// editor + smooth controls), color palette, special-material swatches, and
// the actor visibility toggle.

import type { EditorTool } from "./editorTypes";
import {
	TERRAIN_PALETTE,
	TERRAIN_PALETTE_ROWS,
} from "../../../utils/terrain/palette/TerrainPaletteUtils";
import { groupSpecialMaterialSwatches } from "../../Map/Terrain/materials";
import {
	terrainPaletteIndexToVoxelColor,
} from "../../../utils/terrain/editor/VoxelTerrainEditorUtils";
import {
	MAX_SMOOTH_PASSES,
	MIN_SMOOTH_PASSES,
} from "../../../utils/terrain/editor/EditGridOperations";
import type {
	TerrainSelection,
	VoxelCoord,
	VoxelSelectionBounds,
} from "../../../utils/terrain/editor/VoxelTerrainSelectionUtils";
import type { ChunkDims } from "../../../utils/terrain/editor/EditGridChunkUtils";

// Derived once from the static material registry; grouping never changes at runtime.
const MATERIAL_SWATCH_GROUPS = groupSpecialMaterialSwatches();

interface SelectionSummary {
	bounds: VoxelSelectionBounds | null;
	spaceCount: number;
}

interface EditorSidebarProps {
	voxelCount: number;
	tool: EditorTool;
	selection: TerrainSelection | null;
	boxSelectionAnchor: VoxelSelectionBounds | null;
	selectionSummary: SelectionSummary | null;
	dims: ChunkDims | null;
	readOnly: boolean;
	selectedColorIndex: number;
	onChooseColorIndex: (idx: number) => void;
	onUpdateBoxSelectionBound: (edge: "min" | "max", axis: keyof VoxelCoord, value: number) => void;
	smoothPasses: number;
	onSmoothPassesChange: (value: number) => void;
	onSmoothBoxSelection: () => void;
	actors: { id: string; name: string }[] | undefined;
	showActors: boolean;
	onShowActorsChange: (next: boolean) => void;
}

export function EditorSidebar(props: EditorSidebarProps) {
	const {
		voxelCount,
		tool,
		selection,
		boxSelectionAnchor,
		selectionSummary,
		dims,
		readOnly,
		selectedColorIndex,
		onChooseColorIndex,
		onUpdateBoxSelectionBound,
		smoothPasses,
		onSmoothPassesChange,
		onSmoothBoxSelection,
		actors,
		showActors,
		onShowActorsChange,
	} = props;

	const showSelectionPanel =
		!!selection || !!boxSelectionAnchor || tool === "boxSelect" || tool === "colorSelect";
	const boxSelectionBounds =
		selection?.kind === "box" ? selectionSummary?.bounds ?? null : null;
	const selectionColorIndex =
		selection?.kind === "mask"
			? selection.colorIndex ?? selectedColorIndex
			: selectedColorIndex;
	const selectionColorHex =
		`#${terrainPaletteIndexToVoxelColor(selectionColorIndex).toString(16).padStart(6, "0")}`;

	return (
		<>
			<div>
				<div className="text-sm font-semibold mb-2">Info</div>
				<div className="space-y-1 text-xs text-base-content/75">
					<div className="flex justify-between gap-3">
						<span>Count</span>
						<span className="font-medium text-base-content">
							{voxelCount.toLocaleString()}
						</span>
					</div>
				</div>
			</div>

			{showSelectionPanel && (
				<div>
					<div className="text-sm font-semibold mb-2">Selection</div>
					<div className="space-y-2 text-xs">
						{selectionSummary && (
							<div className="flex justify-between gap-3 text-base-content/75">
								<span>Selected</span>
								<span className="font-medium text-base-content">
									{selectionSummary.spaceCount.toLocaleString()}
								</span>
							</div>
						)}
						{selection?.kind === "mask" && (
							<div className="flex items-center justify-between gap-3 text-base-content/75">
								<span>Color</span>
								<span className="flex items-center gap-2 font-medium text-base-content">
									<span
										className="inline-block h-4 w-4 rounded-sm border border-base-300"
										style={{ backgroundColor: selectionColorHex }}
									/>
									{selectionColorIndex}
								</span>
							</div>
						)}
						{tool === "colorSelect" && selection?.kind !== "mask" && (
							<div className="flex items-center justify-between gap-3 text-base-content/75">
								<span>Color</span>
								<span className="flex items-center gap-2 font-medium text-base-content">
									<span
										className="inline-block h-4 w-4 rounded-sm border border-base-300"
										style={{ backgroundColor: selectionColorHex }}
									/>
									{selectionColorIndex}
								</span>
							</div>
						)}
						{boxSelectionAnchor && !selection && (
							<div className="rounded border border-warning/40 bg-warning/10 px-2 py-1 text-warning-content">
								Anchor {boxSelectionAnchor.min.x}, {boxSelectionAnchor.min.y}, {boxSelectionAnchor.min.z}
							</div>
						)}
						{boxSelectionBounds && (
							<div className="grid grid-cols-[auto_1fr_1fr_1fr] items-center gap-1">
								<span className="text-base-content/60" />
								<span className="text-center text-base-content/60">X</span>
								<span className="text-center text-base-content/60">Y</span>
								<span className="text-center text-base-content/60">Z</span>
								<span className="text-base-content/60">Min</span>
								{(["x", "y", "z"] as Array<keyof VoxelCoord>).map((axis) => (
									<input
										key={`min-${axis}`}
										type="number"
										className="input input-bordered input-xs min-w-0 px-1 text-center"
										value={boxSelectionBounds.min[axis]}
										min={0}
										max={axisMax(axis, dims)}
										disabled={readOnly || selection?.kind !== "box"}
										readOnly={readOnly || selection?.kind !== "box"}
										onChange={(e) =>
											onUpdateBoxSelectionBound("min", axis, Number(e.target.value))
										}
									/>
								))}
								<span className="text-base-content/60">Max</span>
								{(["x", "y", "z"] as Array<keyof VoxelCoord>).map((axis) => (
									<input
										key={`max-${axis}`}
										type="number"
										className="input input-bordered input-xs min-w-0 px-1 text-center"
										value={boxSelectionBounds.max[axis]}
										min={0}
										max={axisMax(axis, dims)}
										disabled={readOnly || selection?.kind !== "box"}
										readOnly={readOnly || selection?.kind !== "box"}
										onChange={(e) =>
											onUpdateBoxSelectionBound("max", axis, Number(e.target.value))
										}
									/>
								))}
							</div>
						)}
						{selection?.kind === "box" && (
							<div className="border-t border-base-300 pt-2 space-y-2">
								<div className="flex items-center justify-between gap-2">
									<span className="font-medium text-base-content">Smooth</span>
									<button
										type="button"
										className="btn btn-primary btn-xs"
										onClick={onSmoothBoxSelection}
										disabled={readOnly}
										title="Smooth selected surface"
									>
										<span className="icon-[mdi--blur] w-4 h-4" />
										Smooth
									</button>
								</div>
								<div className="flex items-center gap-2">
									<span className="text-base-content/70">Passes</span>
									<input
										type="range"
										min={MIN_SMOOTH_PASSES}
										max={MAX_SMOOTH_PASSES}
										value={smoothPasses}
										onChange={(e) => onSmoothPassesChange(Number(e.target.value))}
										className="range range-xs range-primary flex-1"
										disabled={readOnly}
										title="Smooth passes"
									/>
									<input
										type="number"
										min={MIN_SMOOTH_PASSES}
										max={MAX_SMOOTH_PASSES}
										value={smoothPasses}
										onChange={(e) => onSmoothPassesChange(Number(e.target.value))}
										className="input input-bordered input-xs w-12 px-1 text-center"
										disabled={readOnly}
										readOnly={readOnly}
										aria-label="Smooth passes"
									/>
								</div>
							</div>
						)}
					</div>
				</div>
			)}

			<div>
				<div className="text-sm font-semibold mb-2">Color</div>
				<div
					className="grid"
					style={{ gridTemplateColumns: `repeat(${TERRAIN_PALETTE_ROWS}, 1fr)` }}
				>
					{TERRAIN_PALETTE.map((color, idx) => (
						<button
							key={idx}
							type="button"
							className={`aspect-square${selectedColorIndex === idx ? " ring-2 ring-base-content ring-inset" : ""}`}
							style={{ backgroundColor: color }}
							onClick={() => onChooseColorIndex(idx)}
							title={`Color ${idx}`}
							aria-label={`Color ${idx}`}
						/>
					))}
				</div>
			</div>

			<div>
				<div className="text-sm font-semibold mb-2">Materials</div>
				<div className="flex flex-col gap-2">
					{MATERIAL_SWATCH_GROUPS.map((group) => (
						<div key={group.category}>
							<div className="text-xs text-base-content/60 mb-1">{group.label}</div>
							<div className="flex flex-row flex-wrap gap-1">
								{group.swatches.map((swatch) => (
									<button
										key={swatch.index}
										type="button"
										className={`w-6 h-6${selectedColorIndex === swatch.index ? " ring-2 ring-base-content ring-inset" : ""}`}
										style={{ backgroundColor: swatch.color }}
										onClick={() => onChooseColorIndex(swatch.index)}
										title={swatch.label}
										aria-label={swatch.label}
									/>
								))}
							</div>
						</div>
					))}
				</div>
			</div>

			{actors && actors.length > 0 && (
				<div>
					<div className="text-sm font-semibold mb-2">Actors</div>
					<div className="flex flex-col gap-2">
						<label className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-base-300 px-3 py-2">
							<span className="label-text">Show on map</span>
							<input
								type="checkbox"
								className="toggle toggle-sm toggle-secondary"
								checked={showActors}
								onChange={(e) => onShowActorsChange(e.target.checked)}
							/>
						</label>
					</div>
				</div>
			)}
		</>
	);
}

function axisMax(axis: keyof VoxelCoord, dims: ChunkDims | null): number {
	if (!dims) return 0;
	if (axis === "x") return dims.vW - 1;
	if (axis === "y") return dims.vH - 1;
	return dims.vL - 1;
}
