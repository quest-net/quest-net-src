import type { MovementOverlayState } from "./types";
import { formatMovementValue } from "./movement";

interface FirstPersonHudProps {
	isPointerLocked: boolean;
	movementOverlay: MovementOverlayState;
	canFly?: boolean;
	onExitFirstPerson?: () => void;
}

function MovementOverlayText({
	movementOverlay,
}: {
	movementOverlay: Exclude<MovementOverlayState, null>;
}) {
	const overage =
		movementOverlay.overage && movementOverlay.overage > 0
			? movementOverlay.overage
			: 0;
	const overageText =
		overage > 0 ? (
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

	return (
		<>
			Walked {formatMovementValue(movementOverlay.value)}
			{overageText}
		</>
	);
}

export function FirstPersonHud({
	isPointerLocked,
	movementOverlay,
	canFly,
	onExitFirstPerson,
}: FirstPersonHudProps) {
	return (
		<>
			<div className="absolute left-3 top-3 z-20 flex items-center gap-2">
				<div className="tooltip tooltip-right" data-tip="Return to world view">
					<button
						className="btn btn-sm btn-square btn-neutral"
						onClick={onExitFirstPerson}
						aria-label="Return to world view"
					>
						<span className="icon-[mdi--map] w-5 h-5" />
					</button>
				</div>
				<div className="badge badge-neutral gap-1">
					<span className="icon-[mdi--mouse-right-click] w-4 h-4" />
					{isPointerLocked ? "Look mode" : "Hold right click"}
				</div>
				{isPointerLocked && (
					<div className="badge badge-neutral gap-2 whitespace-nowrap">
						<span className="flex items-center gap-1">
							<kbd className="kbd kbd-xs text-neutral">W</kbd>
							<kbd className="kbd kbd-xs text-neutral">A</kbd>
							<kbd className="kbd kbd-xs text-neutral">S</kbd>
							<kbd className="kbd kbd-xs text-neutral">D</kbd>
							<span className="opacity-80">move</span>
						</span>
						<span className="opacity-50">·</span>
						{canFly ? (
							<>
								<span className="flex items-center gap-1">
									<kbd className="kbd kbd-xs text-neutral">Space</kbd>
									<span className="opacity-80">up</span>
								</span>
								<span className="opacity-50">·</span>
								<span className="flex items-center gap-1">
									<kbd className="kbd kbd-xs text-neutral">Shift</kbd>
									<span className="opacity-80">down</span>
								</span>
							</>
						) : (
							<span className="flex items-center gap-1">
								<kbd className="kbd kbd-xs text-neutral">Space</kbd>
								<span className="opacity-80">jump</span>
							</span>
						)}
					</div>
				)}
			</div>
			{movementOverlay && (
				<div className="absolute left-1/2 top-3 -translate-x-1/2 z-20">
					<div className="rounded bg-base-100/90 border border-base-300 px-3 py-1 shadow text-sm font-semibold">
						<MovementOverlayText movementOverlay={movementOverlay} />
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
					<div className="tooltip tooltip-top mt-4" data-tip="Return to world view">
						<button
							className="btn btn-sm btn-square btn-neutral"
							onClick={onExitFirstPerson}
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
