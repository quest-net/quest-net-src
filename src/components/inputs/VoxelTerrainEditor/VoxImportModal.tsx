// Modal dialog presented after the user opens a .vox file via the toolbar.
// Either lets them pick a resolution (when multiple resolutions fit), or
// reports an import error.

import type {
	VoxParseResult,
	VoxResolutionOption,
} from "../../../utils/terrain/import/VoxImportUtils";

export type VoxImportModalState =
	| { kind: "pick"; parsed: VoxParseResult; options: VoxResolutionOption[]; selected: number }
	| { kind: "error"; message: string };

const VOX_RESOLUTION_LABELS: Record<number, string> = {
	1: "Basic",
	2: "Detailed",
	3: "Very Detailed",
	4: "Extreme",
};

interface VoxImportModalProps {
	state: VoxImportModalState;
	onSelectResolution: (resolution: number) => void;
	onConfirm: (parsed: VoxParseResult, resolution: number) => void;
	onClose: () => void;
}

export function VoxImportModal({
	state,
	onSelectResolution,
	onConfirm,
	onClose,
}: VoxImportModalProps) {
	return (
		<dialog className="modal modal-open">
			<div className="modal-box max-w-md">
				{state.kind === "error" ? (
					<>
						<h3 className="font-bold text-lg mb-3">Import .vox — Error</h3>
						<p className="text-sm text-error">{state.message}</p>
						<div className="modal-action">
							<button type="button" className="btn" onClick={onClose}>
								Close
							</button>
						</div>
					</>
				) : (
					<>
						<h3 className="font-bold text-lg mb-1">Import .vox</h3>
						<p className="text-sm text-base-content/60 mb-4">
							File dimensions:{" "}
							<span className="font-medium text-base-content">
								{state.parsed.voxWidth}x{state.parsed.voxLength}x{state.parsed.voxHeight} voxels
							</span>
							. Choose a world scale:
						</p>
						<div className="flex flex-col gap-2">
							{state.options.map((opt) => (
								<button
									key={opt.resolution}
									type="button"
									disabled={!opt.fits}
									onClick={() => onSelectResolution(opt.resolution)}
									className={[
										"btn btn-sm w-full justify-between text-left normal-case",
										!opt.fits
											? "btn-disabled opacity-40"
											: opt.resolution === state.selected
											? "btn-primary"
											: "btn-outline",
									].join(" ")}
								>
									<span className="font-semibold">
										{VOX_RESOLUTION_LABELS[opt.resolution] ?? `Resolution ${opt.resolution}`}
									</span>
									<span className="text-xs opacity-75">
										{opt.fits
											? `${opt.tacticalWidth}x${opt.tacticalLength}x${opt.tacticalHeight} tiles`
											: "Too large"}
									</span>
								</button>
							))}
						</div>
						<p className="text-xs text-base-content/50 mt-3">
							This will replace the current terrain. The previous state is saved to undo.
						</p>
						<div className="modal-action">
							<button
								type="button"
								className="btn btn-ghost"
								onClick={onClose}
							>
								Cancel
							</button>
							<button
								type="button"
								className="btn btn-primary"
								onClick={() => onConfirm(state.parsed, state.selected)}
							>
								Import
							</button>
						</div>
					</>
				)}
			</div>
			<div className="modal-backdrop" onClick={onClose} />
		</dialog>
	);
}
