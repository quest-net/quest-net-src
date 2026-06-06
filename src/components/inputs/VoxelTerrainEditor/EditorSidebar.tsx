// The right-hand sidebar shown in Edit mode.
//
// Includes: voxel-count summary, selection summary panel, color palette,
// special-material swatches, and the actor visibility toggle. Box-bounds
// tweaking and smoothing now live on the map (drag gizmo) and in the toolbar.

import type { EditorTool } from "./editorTypes";
import {
	TERRAIN_PALETTE,
	TERRAIN_PALETTE_ROWS,
} from "../../../utils/terrain/palette/TerrainPaletteUtils";
import { groupSpecialMaterialSwatches } from "../../Map/Terrain/materials";
import {
	terrainPaletteIndexToVoxelColor,
} from "../../../utils/terrain/editor/VoxelTerrainEditorUtils";
import type {
	TerrainSelection,
	VoxelSelectionBounds,
} from "../../../utils/terrain/editor/VoxelTerrainSelectionUtils";

// Derived once from the static material registry; grouping never changes at runtime.
const MATERIAL_SWATCH_GROUPS = groupSpecialMaterialSwatches();

interface SelectionSummary {
	bounds: VoxelSelectionBounds | null;
	spaceCount: number;
}

export interface TerrainLinkSidebarEntry {
	linkId: string;
	destinationName: string;
	locked: boolean;
}

interface EditorSidebarProps {
	voxelCount: number;
	tool: EditorTool;
	selection: TerrainSelection | null;
	boxSelectionAnchor: VoxelSelectionBounds | null;
	selectionSummary: SelectionSummary | null;
	selectedColorIndex: number;
	onChooseColorIndex: (idx: number) => void;
	actors: { id: string; name: string }[] | undefined;
	showActors: boolean;
	onShowActorsChange: (next: boolean) => void;
	linkCount: number;
	links: TerrainLinkSidebarEntry[];
	selectedLinkId: string | null;
	showLinks: boolean;
	onShowLinksChange: (next: boolean) => void;
	onSelectLink: (linkId: string) => void;
	onToggleLinkLocked?: (linkId: string, locked: boolean) => void;
	onDeleteLink?: (linkId: string) => void;
}

export function EditorSidebar(props: EditorSidebarProps) {
	const {
		voxelCount,
		tool,
		selection,
		boxSelectionAnchor,
		selectionSummary,
		selectedColorIndex,
		onChooseColorIndex,
		actors,
		showActors,
		onShowActorsChange,
		linkCount,
		links,
		selectedLinkId,
		showLinks,
		onShowLinksChange,
		onSelectLink,
		onToggleLinkLocked,
		onDeleteLink,
	} = props;

	const showSelectionPanel =
		!!selection || !!boxSelectionAnchor || tool === "boxSelect" || tool === "colorSelect";
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

			<div>
				<div className="text-sm font-semibold mb-2">
					Links
					{linkCount > 0 && (
						<span className="ml-1 text-xs font-normal text-base-content/60">
							({linkCount})
						</span>
					)}
				</div>
				<div className="flex flex-col gap-2">
					<label className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-base-300 px-3 py-2">
						<span className="label-text">Show on map</span>
						<input
							type="checkbox"
							className="toggle toggle-sm toggle-secondary"
							checked={showLinks}
							onChange={(e) => onShowLinksChange(e.target.checked)}
						/>
					</label>
					{links.length > 0 && (
						<div className="flex flex-col gap-1">
							{links.map((link) => {
								const selected = selectedLinkId === link.linkId;
								const selectLink = () => {
									onSelectLink(link.linkId);
									onShowLinksChange(true);
								};
								return (
									<div
										key={link.linkId}
										role="button"
										tabIndex={0}
										className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-xs transition-colors ${
											selected ? "border-primary bg-primary/10" : "border-base-300"
										}`}
										onClick={selectLink}
										onKeyDown={(event) => {
											if (event.key !== "Enter" && event.key !== " ") return;
											event.preventDefault();
											selectLink();
										}}
									>
										<span className="icon-[mdi--link-variant] h-4 w-4 text-primary" />
										<div className="min-w-0 flex-1">
											<div className="truncate font-medium">
												{link.destinationName}
											</div>
										</div>
										<button
											type="button"
											className={`btn btn-xs btn-square ${link.locked ? "btn-neutral" : "btn-ghost"}`}
											onClick={(event) => {
												event.stopPropagation();
												onToggleLinkLocked?.(link.linkId, !link.locked);
											}}
											disabled={!onToggleLinkLocked}
											title={link.locked ? "Unlock link" : "Lock link"}
											aria-label={link.locked ? "Unlock link" : "Lock link"}
										>
											<span className={`${link.locked ? "icon-[mdi--lock]" : "icon-[mdi--lock-open-variant]"} w-4 h-4`} />
										</button>
										<button
											type="button"
											className="btn btn-xs btn-square btn-ghost text-error"
											onClick={(event) => {
												event.stopPropagation();
												onDeleteLink?.(link.linkId);
											}}
											disabled={!onDeleteLink}
											title="Delete link"
											aria-label="Delete link"
										>
											<span className="icon-[mdi--trash-can] w-4 h-4" />
										</button>
									</div>
								);
							})}
						</div>
					)}
				</div>
			</div>
		</>
	);
}
