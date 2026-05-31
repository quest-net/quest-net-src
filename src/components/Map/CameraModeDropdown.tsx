import type { CameraPreference } from "./3DMap";

const CAMERA_MODE_LABELS: Record<CameraPreference, string> = {
	ortho:       "Isometric",
	perspective: "Perspective",
	freecam:     "Free camera",
};

const CAMERA_MODE_ICONS: Record<CameraPreference, string> = {
	ortho:       "icon-[iconoir--orthogonal-view]",
	perspective: "icon-[iconoir--perspective-view]",
	freecam:     "icon-[mdi--camera-iris]",
};

interface CameraModeDropdownProps {
	value: CameraPreference;
	onChange: (mode: CameraPreference) => void;
	/** Whether to include the freecam option. Defaults to true. */
	showFreecam?: boolean;
	/** Shown in the freecam tooltip when freecam is active. */
	freecamSpeedMult?: number;
	/** Adds join-item to the trigger button (use inside a DaisyUI join group). */
	joinItem?: boolean;
	/** Aligns the dropdown menu to the right (dropdown-end). */
	dropdownEnd?: boolean;
}

export function CameraModeDropdown({
	value,
	onChange,
	showFreecam = true,
	freecamSpeedMult,
	joinItem = false,
	dropdownEnd = false,
}: CameraModeDropdownProps) {
	const select = (mode: CameraPreference) => {
		onChange(mode);
		// Defer blur past React's commit so :focus-within can't be
		// re-established on the rerendered menu.
		requestAnimationFrame(() => {
			(document.activeElement as HTMLElement | null)?.blur();
		});
	};

	const modes: CameraPreference[] = showFreecam
		? ["ortho", "perspective", "freecam"]
		: ["ortho", "perspective"];

	const tooltip =
		value === "freecam" && freecamSpeedMult !== undefined
			? `Free camera — hold Right to look + WASD to fly, Space/Shift up/down, scroll to change speed (${freecamSpeedMult.toFixed(2)}×). F to toggle.`
			: value === "freecam"
			? `Camera: Free camera (F toggles freecam)`
			: `Camera: ${CAMERA_MODE_LABELS[value]} (F toggles freecam)`;

	return (
		<div className={`dropdown dropdown-bottom${dropdownEnd ? " dropdown-end" : ""}`}>
			<button
				tabIndex={0}
				type="button"
				role="button"
				className={`btn btn-sm btn-neutral${joinItem ? " join-item" : ""}`}
				title={tooltip}
				aria-label="Camera mode"
			>
				<span className={`${CAMERA_MODE_ICONS[value]} w-5 h-5`} />
				<span className="icon-[mdi--chevron-down] w-3 h-3 opacity-60" />
			</button>
			<ul
				tabIndex={0}
				className="dropdown-content menu bg-base-200 border border-base-300 rounded-box z-50 w-44 p-1 shadow-lg mt-1"
			>
				{modes.map((mode) => (
					<li key={mode}>
						<button
							type="button"
							className={value === mode ? "active" : ""}
							onClick={() => select(mode)}
						>
							<span className={`${CAMERA_MODE_ICONS[mode]} w-4 h-4`} />
							{CAMERA_MODE_LABELS[mode]}
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}
