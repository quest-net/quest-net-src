import type { MapCameraMode } from "../../utils/camera/CameraModes";

export const CAMERA_MODE_LABELS: Record<MapCameraMode, string> = {
	"first-person": "First person",
	follow: "Follow",
	ortho: "Isometric",
	perspective: "Perspective",
	freecam: "Free camera",
};

export const CAMERA_MODE_ICONS: Record<MapCameraMode, string> = {
	"first-person": "icon-[mdi--eye]",
	follow: "icon-[mdi--camera-account]",
	ortho: "icon-[iconoir--orthogonal-view]",
	perspective: "icon-[iconoir--perspective-view]",
	freecam: "icon-[mdi--camera-iris]",
};

/** Trigger-button tooltip per mode. Free camera's is a prefix: when freecam is
 *  active the live speed multiplier is appended to it. */
const CAMERA_MODE_TOOLTIPS: Record<MapCameraMode, string> = {
	"first-person": "Camera: First person — hold Right to look and move.",
	follow: "Camera: Follow — orbits your actor. Hold Right to look and move.",
	ortho: "Camera: Isometric (F toggles freecam)",
	perspective: "Camera: Perspective (F toggles freecam)",
	freecam: "Camera: Free camera (F toggles freecam)",
};

/** Where the map's camera control sits over the canvas, and the offsets an
 *  overlay uses to clear it. Exported so HUD elements do not each hardcode a
 *  guess at this control's footprint -- resize the trigger and they follow. */
export const CAMERA_CONTROL_LAYOUT = {
	/** The control's own absolute position. */
	anchor: "left-3 top-3",
	/** An overlay row sharing its line, starting to its right. */
	beside: "left-20 top-3",
	/** An overlay row on the next line down, under a full-width toolbar. */
	below: "left-3 top-14",
	/** Vertical offset only, for overlays that set their own horizontal rule. */
	belowTop: "top-14",
} as const;

interface CameraModeDropdownProps<TMode extends MapCameraMode> {
	value: TMode;
	onChange: (mode: TMode) => void;
	/** Modes to render, in display order. */
	modes: readonly TMode[];
	/** A returned message disables the mode and explains why it is unavailable. */
	getDisabledReason?: (mode: TMode) => string | undefined;
	/** Shown in the freecam tooltip when freecam is active. */
	freecamSpeedMult?: number;
	/** Adds join-item to the trigger button (use inside a DaisyUI join group). */
	joinItem?: boolean;
	/** Aligns the dropdown menu to the right (dropdown-end). */
	dropdownEnd?: boolean;
}

export function CameraModeDropdown<TMode extends MapCameraMode>({
	value,
	onChange,
	modes,
	getDisabledReason,
	freecamSpeedMult,
	joinItem = false,
	dropdownEnd = false,
}: CameraModeDropdownProps<TMode>) {
	const select = (mode: TMode) => {
		onChange(mode);
		// Defer blur past React's commit so :focus-within cannot be
		// re-established on the rerendered menu.
		requestAnimationFrame(() => {
			(document.activeElement as HTMLElement | null)?.blur();
		});
	};

	const tooltip =
		value === "freecam" && freecamSpeedMult !== undefined
			? `Free camera — hold Right to look + WASD to fly, Space/Shift up/down, scroll to change speed (${freecamSpeedMult.toFixed(2)}×). F to toggle.`
			: CAMERA_MODE_TOOLTIPS[value];

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
				<span className="icon-[mdi--chevron-down] w-3 h-3 opacity-70" />
			</button>
			<ul
				tabIndex={0}
				className="dropdown-content menu bg-base-200 border border-base-300 rounded-box z-50 w-44 p-1 shadow-lg mt-1"
			>
				{modes.map((mode) => {
					const disabledReason = getDisabledReason?.(mode);
					return (
						<li key={mode}>
							<button
								type="button"
								className={value === mode ? "active" : ""}
								disabled={disabledReason !== undefined}
								title={disabledReason}
								onClick={() => select(mode)}
							>
								<span className={`${CAMERA_MODE_ICONS[mode]} w-4 h-4`} />
								{CAMERA_MODE_LABELS[mode]}
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
