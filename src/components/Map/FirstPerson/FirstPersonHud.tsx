import type { MovementOverlayState } from "./types";
import { formatMovementValue } from "./movement";

interface FirstPersonHudProps {
	isPointerLocked: boolean;
	movementOverlay: MovementOverlayState;
	onExitFirstPerson?: () => void;
}

export function FirstPersonHud({
	isPointerLocked,
	movementOverlay,
	onExitFirstPerson,
}: FirstPersonHudProps) {
	return (
		<>
			<div className="absolute left-3 top-3 z-20 flex items-center gap-2">
				<button className="btn btn-sm btn-neutral" onClick={onExitFirstPerson}>
					<span className="icon-[mdi--map] w-4 h-4" />
					World view
				</button>
				<div className="badge badge-neutral gap-1">
					<span className="icon-[mdi--mouse-right-click] w-4 h-4" />
					{isPointerLocked ? "Look mode" : "Hold right click"}
				</div>
			</div>
			{movementOverlay && (
				<div className="absolute left-1/2 top-3 -translate-x-1/2 z-20">
					<div className="rounded bg-base-100/90 border border-base-300 px-3 py-1 shadow text-sm font-semibold">
						{movementOverlay.kind === "combat"
							? `Move left: ${formatMovementValue(movementOverlay.value)}`
							: `Walked: ${formatMovementValue(movementOverlay.value)}`}
					</div>
				</div>
			)}
		</>
	);
}

interface MissingActorMessageProps {
	onExitFirstPerson?: () => void;
}

export function MissingActorMessage({
	onExitFirstPerson,
}: MissingActorMessageProps) {
	return (
		<div className="w-full h-full grid place-items-center bg-base-200/60 text-base-content">
			<div className="text-center max-w-sm px-4">
				<div className="font-semibold">First-person mode needs an active actor.</div>
				<div className="text-sm opacity-70 mt-1">
					Players use their selected character. DMs can use impersonation.
				</div>
				{onExitFirstPerson && (
					<button className="btn btn-sm btn-neutral mt-4" onClick={onExitFirstPerson}>
						Return to world view
					</button>
				)}
			</div>
		</div>
	);
}
