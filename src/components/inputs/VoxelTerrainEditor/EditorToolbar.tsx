// The toolbar above the editor canvas.
//
// Grouped left-to-right: tools (place/erase/paint/sample), selection modes
// (color/box select), selection tools (smooth/fill -- act on the current
// selection), then -- separated by dividers -- brush controls (tile/voxel
// granularity + size), the stamp picker, and undo/redo + shortcuts help. The
// edit/preview tab, .vox import and camera dropdown sit on the right.

import type { RefObject } from "react";
import type {
	EditableVoxelTerrain,
	VoxelTerrain,
} from "../../../domains/VoxelTerrain/VoxelTerrain";
import type {
	CameraMode,
	EditorView,
	EditorTool,
	EditGranularityType,
} from "./editorTypes";
import { CameraModeDropdown } from "../../Map/CameraModeDropdown";
import {
	MAX_BRUSH_SIZE,
	MIN_BRUSH_SIZE,
} from "../../../utils/terrain/editor/VoxelBrushUtils";

interface ToolButtonDef {
	id: EditorTool;
	label: string;
	icon: string;
	shortcut: string;
}

const TOOL_BUTTONS: ToolButtonDef[] = [
	{ id: "place",  label: "Place",  icon: "icon-[mdi--cube-outline]", shortcut: "P" },
	{ id: "erase",  label: "Erase",  icon: "icon-[mdi--eraser]",       shortcut: "R" },
	{ id: "paint",  label: "Paint",  icon: "icon-[mdi--palette]",      shortcut: "G" },
	{ id: "sample", label: "Sample", icon: "icon-[mdi--eyedropper]",   shortcut: "I" },
];

const SELECTION_MODE_BUTTONS: ToolButtonDef[] = [
	{ id: "colorSelect", label: "Color Select", icon: "icon-[mdi--palette-swatch]", shortcut: "C" },
	{ id: "boxSelect",   label: "Box Select",   icon: "icon-[mdi--selection-drag]", shortcut: "B" },
];

function ToolbarDivider() {
	return <div className="h-8 w-px bg-base-300 mx-0.5 self-center" aria-hidden="true" />;
}

interface EditorToolbarProps {
	tool: EditorTool;
	activeSelectionTool: "boxSelect" | "colorSelect" | null;
	onToolClick: (tool: EditorTool) => void;
	/** Fill the current selection (one shot). */
	onFillSelection: () => void;
	/** Apply one smoothing pass to the current box selection (one shot). */
	onSmoothSelection: () => void;
	canFillSelection: boolean;
	canSmoothSelection: boolean;
	brushSize: number;
	onBrushSizeChange: (size: number) => void;
	granularity: EditGranularityType;
	onGranularityChange: (g: EditGranularityType) => void;
	readOnly: boolean;
	stampSources?: VoxelTerrain[];
	loadStampVoxels?: (terrainId: string) => Promise<EditableVoxelTerrain | null>;
	stampLoadingId: string | null;
	onSelectStamp: (terrainId: string) => Promise<void> | void;
	onExitStampMode: () => void;
	/** Opens the door-placement flow. Omitted when door placement is unavailable. */
	onOpenDoorPlacement?: () => void;
	/** Whether door placement is allowed (false until the terrain is saved). */
	canPlaceDoors?: boolean;
	undoDepth: number;
	redoDepth: number;
	onUndo: () => void;
	onRedo: () => void;
	modKeyLabel: string;
	activeView: EditorView;
	onShowEdit: () => void;
	onShowPreview: () => void;
	onVoxFileSelected: (file: File) => void;
	voxFileInputRef: RefObject<HTMLInputElement | null>;
	cameraMode: CameraMode;
	onSelectCameraMode: (mode: CameraMode) => void;
	/** Current freecam movement-speed multiplier (1 = base). Shown in the
	 *  camera dropdown while in freecam mode. */
	freecamSpeedMult: number;
}

export function EditorToolbar(props: EditorToolbarProps) {
	const {
		tool,
		activeSelectionTool,
		onToolClick,
		onFillSelection,
		onSmoothSelection,
		canFillSelection,
		canSmoothSelection,
		brushSize,
		onBrushSizeChange,
		granularity,
		onGranularityChange,
		readOnly,
		stampSources,
		loadStampVoxels,
		stampLoadingId,
		onSelectStamp,
		onExitStampMode,
		onOpenDoorPlacement,
		canPlaceDoors,
		undoDepth,
		redoDepth,
		onUndo,
		onRedo,
		modKeyLabel,
		activeView,
		onShowEdit,
		onShowPreview,
		onVoxFileSelected,
		voxFileInputRef,
		cameraMode,
		onSelectCameraMode,
		freecamSpeedMult,
	} = props;

	const fileRef = voxFileInputRef;

	const getToolButtonClass = (buttonId: EditorTool): string => {
		const base = "btn btn-square btn-sm join-item";
		const isSelectButton = buttonId === "boxSelect" || buttonId === "colorSelect";
		const hasActiveSelection = activeSelectionTool === buttonId;
		if (hasActiveSelection) {
			return `${base} btn-primary hover:bg-error hover:border-error hover:text-error-content`;
		}
		if (isSelectButton && tool === buttonId) return `${base} btn-primary`;
		return `${base} ${tool === buttonId ? "btn-neutral" : "btn-outline"}`;
	};

	return (
		<div className="min-h-16 shrink-0 border-b-2 bg-base-100 px-3 py-2 flex flex-wrap items-center justify-between gap-3">
			<div className="flex flex-wrap items-center gap-2">
				{/* Tools */}
				<div className="join">
					{TOOL_BUTTONS.map((button) => (
						<button
							key={button.id}
							type="button"
							className={getToolButtonClass(button.id)}
							onClick={() => onToolClick(button.id)}
							title={`${button.label} (${button.shortcut})`}
							aria-label={`${button.label} (shortcut ${button.shortcut})`}
						>
							<span className={`${button.icon} w-5 h-5`} />
						</button>
					))}
				</div>

				{/* Selection modes */}
				<div className="join">
					{SELECTION_MODE_BUTTONS.map((button) => (
						<button
							key={button.id}
							type="button"
							className={getToolButtonClass(button.id)}
							onClick={() => onToolClick(button.id)}
							title={
								activeSelectionTool === button.id
									? `Clear ${button.label.toLowerCase()} selection`
									: `${button.label} (${button.shortcut})`
							}
							aria-label={`${button.label} (shortcut ${button.shortcut})`}
						>
							<span className={`${button.icon} w-5 h-5`} />
						</button>
					))}
				</div>

				{/* Selection tools (operate on the current selection) */}
				<div className="join">
					<button
						type="button"
						className="btn btn-square btn-sm join-item btn-outline"
						onClick={onSmoothSelection}
						disabled={readOnly || !canSmoothSelection}
						title="Smooth selection surface (click again to smooth more)"
						aria-label="Smooth selection"
					>
						<span className="icon-[mdi--blur] w-5 h-5" />
					</button>
					<button
						type="button"
						className="btn btn-square btn-sm join-item btn-outline"
						onClick={onFillSelection}
						disabled={readOnly || !canFillSelection}
						title="Fill selection (L)"
						aria-label="Fill selection"
					>
						<span className="icon-[mdi--format-color-fill] w-5 h-5" />
					</button>
				</div>

				<ToolbarDivider />

				{/* Brush controls: granularity + size */}
				<div className="join">
					<button
						type="button"
						className={`btn btn-square btn-sm join-item ${granularity === "tactical" ? "btn-primary" : "btn-outline"}`}
						onClick={() => onGranularityChange("tactical")}
						title="Tile Brush (1)"
						aria-label="Tile brush"
					>
						<span className="icon-[mdi--grid-large] w-5 h-5" />
					</button>
					<button
						type="button"
						className={`btn btn-square btn-sm join-item ${granularity === "voxel" ? "btn-primary" : "btn-outline"}`}
						onClick={() => onGranularityChange("voxel")}
						title="Voxel Brush (2)"
						aria-label="Voxel brush"
					>
						<span className="icon-[mdi--grid] w-5 h-5" />
					</button>
				</div>

				<div className="flex items-center gap-2">
					<input
						type="range"
						min={MIN_BRUSH_SIZE}
						max={MAX_BRUSH_SIZE}
						value={brushSize}
						onChange={(e) => onBrushSizeChange(Number(e.target.value))}
						className="range range-sm range-primary w-24"
						disabled={readOnly}
						title="Brush size"
						aria-label="Brush size"
					/>
					<input
						type="number"
						min={MIN_BRUSH_SIZE}
						max={MAX_BRUSH_SIZE}
						value={brushSize}
						onChange={(e) => onBrushSizeChange(Number(e.target.value))}
						className="input input-bordered input-sm w-14"
						disabled={readOnly}
						readOnly={readOnly}
						aria-label="Brush size"
					/>
				</div>

				{/* Stamp picker */}
				{!readOnly && loadStampVoxels && (
					<>
						<ToolbarDivider />
						{tool === "stamp" ? (
							<button
								type="button"
								className="btn btn-sm btn-warning"
								onClick={onExitStampMode}
								title="Stop stamping (Esc)"
							>
								<span className="icon-[mdi--stamper] w-5 h-5" />
								ESC to stop
							</button>
						) : (
							<div className="dropdown dropdown-bottom">
								<div
									tabIndex={0}
									role="button"
									className="btn btn-square btn-sm btn-outline"
									title="Insert a stamp terrain (R rotate, M mirror, Esc stop)"
									aria-label="Insert stamp"
								>
									<span className="icon-[mdi--stamper] w-5 h-5" />
								</div>
								<div
									tabIndex={0}
									className="dropdown-content z-50 mt-2 w-64 max-h-80 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
								>
									{stampSources && stampSources.length > 0 ? (
										<ul className="menu menu-sm p-0">
											{stampSources.map((source) => {
												const isLoading = stampLoadingId === source.Id;
												return (
													<li key={source.Id}>
														<button
															type="button"
															onClick={() => {
																void onSelectStamp(source.Id);
																(document.activeElement as HTMLElement | null)?.blur();
															}}
															disabled={isLoading}
															className="flex items-center gap-2"
														>
															{isLoading && (
																<span className="loading loading-spinner loading-xs" />
															)}
															<span className="truncate">{source.Name}</span>
															<span className="ml-auto text-xs opacity-60 whitespace-nowrap">
																{source.Width}×{source.Height}×{source.Length}
															</span>
														</button>
													</li>
												);
											})}
										</ul>
									) : (
										<div className="px-2 py-1 text-xs opacity-70 leading-relaxed">
											No stamps available. Tag a terrain{" "}
											<code className="text-[0.7rem]">path:stamps</code>{" "}
											to see it here.
										</div>
									)}
								</div>
							</div>
						)}
					</>
				)}

				{/* Door placement (next to the stamp control) */}
				{!readOnly && onOpenDoorPlacement && (
					<>
						<ToolbarDivider />
						<button
							type="button"
							className="btn btn-square btn-sm btn-outline"
							onClick={onOpenDoorPlacement}
							disabled={!canPlaceDoors}
							title={
								canPlaceDoors
									? "Place a door (link this terrain to another)"
									: "Save the terrain before adding doors"
							}
							aria-label="Place a door"
						>
							<span className="icon-[mdi--door] w-5 h-5" />
						</button>
					</>
				)}

				<ToolbarDivider />

				{/* Undo / redo + shortcuts help */}
				<div className="join">
					<button
						type="button"
						className="btn btn-square btn-sm join-item btn-outline"
						onClick={onUndo}
						disabled={undoDepth === 0 || readOnly}
						title={`Undo (${modKeyLabel}+Z)`}
						aria-label={`Undo (${modKeyLabel}+Z)`}
					>
						<span className="icon-[mdi--undo] w-5 h-5" />
					</button>
					<button
						type="button"
						className="btn btn-square btn-sm join-item btn-outline"
						onClick={onRedo}
						disabled={redoDepth === 0 || readOnly}
						title={`Redo (${modKeyLabel}+Shift+Z or ${modKeyLabel}+Y)`}
						aria-label={`Redo (${modKeyLabel}+Shift+Z or ${modKeyLabel}+Y)`}
					>
						<span className="icon-[mdi--redo] w-5 h-5" />
					</button>
				</div>

				<ShortcutsHelpDropdown modKeyLabel={modKeyLabel} />
			</div>

			<div className="flex items-center gap-2">
				{!readOnly && (
					<>
						<button
							type="button"
							className="btn btn-sm btn-outline"
							onClick={() => fileRef.current?.click()}
							title="Import a MagicaVoxel .vox file"
						>
							<span className="icon-[mdi--cube-send] w-4 h-4" />
							Import .vox
						</button>
						<input
							ref={fileRef}
							type="file"
							accept=".vox"
							className="hidden"
							onChange={(e) => {
								const file = e.target.files?.[0];
								e.target.value = "";
								if (file) onVoxFileSelected(file);
							}}
						/>
					</>
				)}
				{activeView === "edit" && (
					<CameraModeDropdown
						value={cameraMode}
						onChange={onSelectCameraMode}
						freecamSpeedMult={freecamSpeedMult}
						dropdownEnd
					/>
				)}
				<div className="join">
					<button
						type="button"
						className={`btn btn-sm join-item ${activeView === "edit" ? "btn-neutral" : "btn-outline"}`}
						onClick={onShowEdit}
					>
						Edit
					</button>
					<button
						type="button"
						className={`btn btn-sm join-item ${activeView === "preview" ? "btn-neutral" : "btn-outline"}`}
						onClick={onShowPreview}
					>
						Preview
					</button>
				</div>
			</div>
		</div>
	);
}

function ShortcutsHelpDropdown({ modKeyLabel }: { modKeyLabel: string }) {
	return (
		<div className="dropdown dropdown-bottom dropdown-end">
			<div
				tabIndex={0}
				role="button"
				className="btn btn-square btn-sm btn-outline"
				title="Keyboard shortcuts"
				aria-label="Keyboard shortcuts"
			>
				<span className="icon-[mdi--help-circle-outline] w-5 h-5" />
			</div>
			<div
				tabIndex={0}
				className="dropdown-content z-50 mt-2 w-[30rem] rounded-box border border-base-300 bg-base-100 p-3 shadow-lg text-sm"
			>
				<div className="columns-2 gap-4">
					<section className="break-inside-avoid mb-3">
						<div className="font-semibold mb-2">Tools</div>
						<table className="w-full">
							<tbody>
								<tr><td className="opacity-70 py-0.5">Place</td><td className="text-right"><kbd className="kbd kbd-sm">P</kbd></td></tr>
								<tr><td className="opacity-70 py-0.5">Fill (selection, keeps voxels)</td><td className="text-right"><kbd className="kbd kbd-sm">L</kbd></td></tr>
								<tr><td className="opacity-70 py-0.5">Erase</td><td className="text-right"><kbd className="kbd kbd-sm">R</kbd></td></tr>
								<tr><td className="opacity-70 py-0.5">Paint</td><td className="text-right"><kbd className="kbd kbd-sm">G</kbd></td></tr>
								<tr><td className="opacity-70 py-0.5">Sample (eyedropper)</td><td className="text-right"><kbd className="kbd kbd-sm">I</kbd></td></tr>
								<tr><td className="opacity-70 py-0.5">Box select</td><td className="text-right"><kbd className="kbd kbd-sm">B</kbd></td></tr>
								<tr><td className="opacity-70 py-0.5">Color select</td><td className="text-right"><kbd className="kbd kbd-sm">C</kbd></td></tr>
								<tr><td className="opacity-70 py-0.5">Tile brush</td><td className="text-right"><kbd className="kbd kbd-sm">1</kbd></td></tr>
								<tr><td className="opacity-70 py-0.5">Voxel brush</td><td className="text-right"><kbd className="kbd kbd-sm">2</kbd></td></tr>
								<tr>
									<td className="opacity-70 py-0.5">Undo</td>
									<td className="text-right whitespace-nowrap">
										<kbd className="kbd kbd-sm">{modKeyLabel}</kbd>
										<span className="mx-1 opacity-50">+</span>
										<kbd className="kbd kbd-sm">Z</kbd>
									</td>
								</tr>
								<tr>
									<td className="opacity-70 py-0.5">Redo</td>
									<td className="text-right whitespace-nowrap">
										<kbd className="kbd kbd-sm">{modKeyLabel}</kbd>
										<span className="mx-1 opacity-50">+</span>
										<kbd className="kbd kbd-sm">Y</kbd>
									</td>
								</tr>
							</tbody>
						</table>
					</section>

					<section className="break-inside-avoid mb-3">
						<div className="font-semibold mb-2">Camera</div>
						<table className="w-full">
							<tbody>
								<tr><td className="opacity-70 py-0.5">Paint / pick</td><td className="text-right whitespace-nowrap"><kbd className="kbd kbd-sm">Left&nbsp;click</kbd></td></tr>
								<tr><td className="opacity-70 py-0.5">Orbit / rotate</td><td className="text-right whitespace-nowrap"><kbd className="kbd kbd-sm">Middle&nbsp;drag</kbd></td></tr>
								<tr><td className="opacity-70 py-0.5">Pan</td><td className="text-right whitespace-nowrap"><kbd className="kbd kbd-sm">Right&nbsp;drag</kbd></td></tr>
								<tr><td className="opacity-70 py-0.5">Zoom</td><td className="text-right whitespace-nowrap"><kbd className="kbd kbd-sm">Scroll</kbd></td></tr>
							</tbody>
						</table>
					</section>

					<section className="break-inside-avoid mb-3">
						<div className="font-semibold mb-2">Stamps</div>
						<table className="w-full">
							<tbody>
								<tr>
									<td className="opacity-70 py-0.5">Rotate stamp 90&deg;</td>
									<td className="text-right"><kbd className="kbd kbd-sm">R</kbd></td>
								</tr>
								<tr>
									<td className="opacity-70 py-0.5">Mirror stamp</td>
									<td className="text-right"><kbd className="kbd kbd-sm">M</kbd></td>
								</tr>
								<tr>
									<td className="opacity-70 py-0.5">Stop stamping</td>
									<td className="text-right"><kbd className="kbd kbd-sm">Esc</kbd></td>
								</tr>
							</tbody>
						</table>
						<div className="mt-1 text-xs opacity-70 leading-relaxed">
							Tag a terrain <code className="text-[0.7rem]">path:stamps</code>{" "}
							to use it as a stamp.
						</div>
					</section>

					<section className="break-inside-avoid mb-3">
						<div className="font-semibold mb-2">Freecam</div>
						<table className="w-full">
							<tbody>
								<tr>
									<td className="opacity-70 py-0.5">Toggle freecam</td>
									<td className="text-right"><kbd className="kbd kbd-sm">F</kbd></td>
								</tr>
								<tr>
									<td className="opacity-70 py-0.5">Look around</td>
									<td className="text-right whitespace-nowrap"><kbd className="kbd kbd-sm">Hold&nbsp;Right</kbd></td>
								</tr>
								<tr>
									<td className="opacity-70 py-0.5">Fly</td>
									<td className="text-right whitespace-nowrap">
										<kbd className="kbd kbd-sm">W</kbd>
										<kbd className="kbd kbd-sm">A</kbd>
										<kbd className="kbd kbd-sm">S</kbd>
										<kbd className="kbd kbd-sm">D</kbd>
									</td>
								</tr>
								<tr>
									<td className="opacity-70 py-0.5">Up / Down</td>
									<td className="text-right whitespace-nowrap">
										<kbd className="kbd kbd-sm">Space</kbd>
										<span className="mx-1 opacity-50">/</span>
										<kbd className="kbd kbd-sm">Shift</kbd>
									</td>
								</tr>
								<tr>
									<td className="opacity-70 py-0.5">Adjust fly speed</td>
									<td className="text-right"><kbd className="kbd kbd-sm">Scroll</kbd></td>
								</tr>
							</tbody>
						</table>
						<div className="mt-1 text-xs opacity-70 leading-relaxed">
							Release Right to bring the cursor back for painting.
						</div>
					</section>

					<section className="break-inside-avoid text-xs leading-relaxed">
						<div className="font-semibold mb-1">Mid-stroke modifier</div>
						<div className="opacity-80">
							While dragging a stroke, hold{" "}
							<kbd className="kbd kbd-xs">Shift</kbd> to break out of the
							locked plane and paint across faces.
						</div>
					</section>
				</div>
			</div>
		</div>
	);
}

