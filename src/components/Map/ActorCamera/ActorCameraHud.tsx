import type { MovementOverlayState } from "./types";
import { formatMovementValue } from "./movement";
import type { TerrainLinkInteractionFocus } from "../TerrainLinks3D/ThreeDTerrainLinkLayer";
import type { ActorCameraMode } from "../../../utils/camera/CameraModes";
import { CAMERA_CONTROL_LAYOUT } from "../CameraModeDropdown";

interface ActorCameraHudProps {
	cameraMode: ActorCameraMode;
	isPointerLocked: boolean;
	movementOverlay: MovementOverlayState;
	canFly?: boolean;
	linkFocus?: TerrainLinkInteractionFocus | null;
}

function MovementOverlayText({
	movementOverlay,
}: {
	movementOverlay: Exclude<MovementOverlayState, null>;
}) {
	const unbounded = movementOverlay.overageUnbounded === true;
	const overage =
		movementOverlay.overage && movementOverlay.overage > 0
			? movementOverlay.overage
			: 0;
	const overageText = unbounded ? (
		<span className="text-error"> (+ a lot)</span>
	) : overage > 0 ? (
		<span className="text-error">
			{" "}
			(+{formatMovementValue(overage)})
		</span>
	) : null;

	if (movementOverlay.kind === "combat") {
		return (
			<>
				Move left: {formatMovementValue(movementOverlay.value)}
				{overageText}
			</>
		);
	}

	// Exploration past the tracked range: distance is unknown, so show the
	// symbolic readout on its own instead of a misleading "Walked 0".
	if (unbounded) {
		return <>Walked a lot</>;
	}

	return (
		<>
			Walked {formatMovementValue(movementOverlay.value)}
			{overageText}
		</>
	);
}

export function ActorCameraHud({
	cameraMode,
	isPointerLocked,
	movementOverlay,
	canFly,
	linkFocus,
}: ActorCameraHudProps) {
	const isFollow = cameraMode === "follow";
	// First Person hides the world toolbars, so the control hint sits beside the
	// camera dropdown. Follow keeps them, so it drops to the next line.
	const hintPlacement = isFollow
		? CAMERA_CONTROL_LAYOUT.below
		: CAMERA_CONTROL_LAYOUT.beside;
	return (
		<>
			<div
				className={`absolute z-20 flex items-center gap-2 ${hintPlacement}`}
			>
				<div className="badge badge-neutral h-8 gap-1 px-3">
					<span className="icon-[mdi--mouse-right-click] w-4 h-4" />
					{isPointerLocked
						? isFollow
							? "Follow movement"
							: "Look mode"
						: "Hold right click"}
				</div>
				{isPointerLocked && (
					<div className="badge badge-neutral gap-2 whitespace-nowrap">
						<span className="flex items-center gap-1">
							<kbd className="kbd kbd-xs text-neutral">W</kbd>
							<kbd className="kbd kbd-xs text-neutral">A</kbd>
							<kbd className="kbd kbd-xs text-neutral">S</kbd>
							<kbd className="kbd kbd-xs text-neutral">D</kbd>
							<span className="opacity-70">move</span>
						</span>
						<span className="opacity-70">·</span>
						{canFly ? (
							<>
								<span className="flex items-center gap-1">
									<kbd className="kbd kbd-xs text-neutral">Space</kbd>
									<span className="opacity-70">up</span>
								</span>
								<span className="opacity-70">·</span>
								<span className="flex items-center gap-1">
									<kbd className="kbd kbd-xs text-neutral">Shift</kbd>
									<span className="opacity-70">down</span>
								</span>
							</>
						) : (
							<span className="flex items-center gap-1">
								<kbd className="kbd kbd-xs text-neutral">Space</kbd>
								<span className="opacity-70">jump</span>
							</span>
						)}
					</div>
				)}
			</div>
			{movementOverlay && (
				<div
					className={`absolute left-1/2 -translate-x-1/2 z-20 ${
						isFollow ? CAMERA_CONTROL_LAYOUT.belowTop : "top-3"
					}`}
				>
					<div className="rounded bg-base-100/90 border border-base-300 px-3 py-1 shadow text-sm font-semibold">
						<MovementOverlayText movementOverlay={movementOverlay} />
					</div>
				</div>
			)}
			{linkFocus?.usable && (
				<div className="pointer-events-none absolute left-1/2 top-[58%] z-20 -translate-x-1/2">
					<div className="rounded bg-base-100/90 border border-base-300 px-3 py-1.5 text-sm font-semibold text-base-content shadow">
						<span className="flex items-center gap-1.5">
							<kbd className="kbd kbd-sm text-neutral">E</kbd>
							{linkFocus.destinationName
								? `Travel to ${linkFocus.destinationName}`
								: "Use link"}
						</span>
					</div>
				</div>
			)}
		</>
	);
}

interface MissingActorMessageProps {
	onLeaveActorCamera?: () => void;
}

export function MissingActorMessage({
	onLeaveActorCamera,
}: MissingActorMessageProps) {
	return (
		<div className="w-full h-full grid place-items-center bg-base-200/60 text-base-content">
			<div className="text-center max-w-sm px-4">
				<div className="font-semibold">This camera mode needs an active actor.</div>
				<div className="text-sm opacity-70 mt-1">
					Players use their selected character. DMs can use impersonation.
				</div>
				{onLeaveActorCamera && (
					<div className="tooltip tooltip-top mt-4" data-tip="Return to world view">
						<button
							className="btn btn-sm btn-square btn-neutral"
							onClick={onLeaveActorCamera}
							aria-label="Return to world view"
						>
							<span className="icon-[mdi--map] w-5 h-5" />
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
