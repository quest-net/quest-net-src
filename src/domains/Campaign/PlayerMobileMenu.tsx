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
import {
	getCameraModeDisabledReason,
	PLAYER_CAMERA_MODES,
} from "../../utils/camera/CameraModes";
import {
	CAMERA_MODE_ICONS,
	CAMERA_MODE_LABELS,
} from "../../components/Map/CameraModeDropdown";

interface PlayerMobileMenuProps {
	/** Whether a character is selected (gates the "change character" item). */
	hasSelectedCharacter: boolean;
	onChangeCharacter: () => void;
	onExit: () => void;
}

export function PlayerMobileMenu({
	hasSelectedCharacter,
	onChangeCharacter,
	onExit,
}: PlayerMobileMenuProps) {
	const context = useQuestContext();
	const cameraMode = AppSettingUtils.getCameraMode(context);
	// This menu only ever renders on a touch-sized layout, for a player.
	const availability = {
		isDM: false,
		hasControlledActor: hasSelectedCharacter,
		isTouchLayout: true,
	};

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
				{PLAYER_CAMERA_MODES.map((mode) => {
					const disabledReason = getCameraModeDisabledReason(
						mode,
						availability
					);
					return (
						<li key={mode}>
							<button
								type="button"
								className={cameraMode === mode ? "active" : ""}
								disabled={disabledReason !== undefined}
								title={disabledReason}
								onClick={() =>
									runAndClose(() =>
										AppSettingUtils.setCameraMode({ mode }, contextStore)
									)
								}
							>
								<span className={`${CAMERA_MODE_ICONS[mode]} w-5 h-5`} />
								{CAMERA_MODE_LABELS[mode]}
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
