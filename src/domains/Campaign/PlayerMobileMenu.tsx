// domains/Campaign/PlayerMobileMenu.tsx
//
// Mobile-only header menu for the player campaign view. On small screens the
// header's individual controls (change character, leave campaign) plus the
// map's camera-mode toggle collapse into this single hamburger dropdown. App
// settings are intentionally omitted on mobile — most of their options aren't
// relevant on a touch device.

import { useQuestContext } from "../Context/ContextProvider";
import { contextStore } from "../Context/contextStore";
import { AppSettingUtils } from "../AppSetting/AppSettingUtils";
import type { CameraPreference } from "../../components/Map/MapScene";

interface PlayerMobileMenuProps {
	/** Whether a character is selected (gates the "change character" item). */
	hasSelectedCharacter: boolean;
	onChangeCharacter: () => void;
	onExit: () => void;
}

// Players get the two OrbitControls-backed modes; freecam is DM-only.
const CAMERA_OPTIONS: { mode: CameraPreference; label: string; icon: string }[] = [
	{ mode: "ortho", label: "Isometric", icon: "icon-[iconoir--orthogonal-view]" },
	{
		mode: "perspective",
		label: "Perspective",
		icon: "icon-[iconoir--perspective-view]",
	},
];

export function PlayerMobileMenu({
	hasSelectedCharacter,
	onChangeCharacter,
	onExit,
}: PlayerMobileMenuProps) {
	const context = useQuestContext();
	const preference = AppSettingUtils.getCameraPreference(context);

	// Close the dropdown after a selection: blur past React's commit so
	// :focus-within can't re-open the freshly rendered menu.
	const runAndClose = (fn: () => void) => {
		fn();
		requestAnimationFrame(() => {
			(document.activeElement as HTMLElement | null)?.blur();
		});
	};

	return (
		<div className="dropdown dropdown-end">
			<button
				tabIndex={0}
				type="button"
				role="button"
				className="btn btn-neutral btn-sm"
				aria-label="Menu"
			>
				<span className="icon-[mdi--menu] w-6 h-6" />
			</button>
			<ul
				tabIndex={0}
				className="dropdown-content menu bg-base-200 border border-base-300 rounded-box z-50 w-56 p-1 shadow-lg mt-1"
			>
				{hasSelectedCharacter && (
					<li>
						<button type="button" onClick={() => runAndClose(onChangeCharacter)}>
							<span className="icon-[mdi--account-switch] w-5 h-5" />
							Change character
						</button>
					</li>
				)}
				<li>
					<button type="button" onClick={() => runAndClose(onExit)}>
						<span className="icon-[mdi--exit-run] w-5 h-5" />
						Exit room
					</button>
				</li>

				<li className="menu-title text-xs">Camera</li>
				{CAMERA_OPTIONS.map((opt) => (
					<li key={opt.mode}>
						<button
							type="button"
							className={preference === opt.mode ? "active" : ""}
							onClick={() =>
								runAndClose(() =>
									AppSettingUtils.setCameraPreference(
										{ preference: opt.mode },
										contextStore
									)
								)
							}
						>
							<span className={`${opt.icon} w-5 h-5`} />
							{opt.label}
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}
