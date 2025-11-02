// domains/Scene/SceneDisplay.tsx

import { useState, useEffect, useRef } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { ImageDisplay } from "../Image/ImageDisplay";

// ============================================================================
// SIZE CONFIGURATION - Easily adjust these values
// ============================================================================
const SIZES = {
	// Default (not hovered)
	default: {
		maxWidth: "max-w-md", // ~448px (28rem)
		maxHeight: "max-h-64", // 256px (16rem)
		opacity: "opacity-70",
	},
	// Hovered (expanded)
	hovered: {
		maxWidth: "max-w-2xl", // ~672px (42rem)
		maxHeight: "max-h-96", // 384px (24rem)
		opacity: "opacity-100",
	},
	// Focus image - percentage of environment container
	focus: {
		maxWidthPercent: 35, // % of environment container width
		maxHeightPercent: 50, // % of environment container height
		padding: "p-2", // Padding from corner
	},
	// Collapsed button
	collapsed: {
		size: "w-12 h-12",
	},
};

export function SceneDisplay() {
	const context = useQuestContext();
	const campaign = CampaignActions.getActiveCampaign(context);
	const scene = campaign.GameState.Scene;

	// State
	const [isCollapsed, setIsCollapsed] = useState(false);
	const [isHovered, setIsHovered] = useState(false);

	// Track previous scene IDs to detect changes
	const prevSceneRef = useRef({
		environmentId: scene.EnvironmentImageId,
		focusId: scene.FocusImageId,
	});

	// Auto-reveal when scene changes
	useEffect(() => {
		const hasEnvironmentChanged =
			scene.EnvironmentImageId !== prevSceneRef.current.environmentId;
		const hasFocusChanged =
			scene.FocusImageId !== prevSceneRef.current.focusId;

		if (hasEnvironmentChanged || hasFocusChanged) {
			setIsCollapsed(false);
		}

		// Update ref
		prevSceneRef.current = {
			environmentId: scene.EnvironmentImageId,
			focusId: scene.FocusImageId,
		};
	}, [scene.EnvironmentImageId, scene.FocusImageId]);

	// Handlers
	const handleCollapse = () => {
		setIsCollapsed(true);
	};

	const handleExpand = () => {
		setIsCollapsed(false);
	};

	// Check if scene has images
	const hasEnvironment = !!scene.EnvironmentImageId;
	const hasFocus = !!scene.FocusImageId;

	// Don't render anything if no environment image (not even for DM)
	if (!hasEnvironment) {
		return null;
	}

	// Collapsed state - show button only
	if (isCollapsed) {
		return (
			<div className="absolute top-2 right-2 z-20">
				<button
					onClick={handleExpand}
					className={`btn btn-square btn-primary ${SIZES.collapsed.size} shadow-lg`}
					title="Show scene"
				>
					<span className="icon-[mdi--image] w-6 h-6" />
				</button>
			</div>
		);
	}

	// Get current size based on hover state
	const currentSize = isHovered ? SIZES.hovered : SIZES.default;

	return (
		<>
			{/* Scene Display */}
			<div
				className={`absolute top-2 right-2 z-20 ${currentSize.maxWidth} ${currentSize.maxHeight} ${currentSize.opacity} transition-all duration-300 ease-in-out`}
				onMouseEnter={() => setIsHovered(true)}
				onMouseLeave={() => setIsHovered(false)}
			>
				<div className="relative w-full h-full rounded-lg overflow-hidden shadow-xl border-2 border-base-300">
					{/* Environment Image Container */}
					<div className="w-full h-full bg-base-200 flex items-center justify-center">
						<ImageDisplay
							imageId={scene.EnvironmentImageId}
							className="max-w-full max-h-full object-contain"
							alt="Scene environment"
						/>
					</div>

					{/* Focus Image - Bottom Right Corner (only if it exists) */}
					{hasFocus && (
						<div
							className={`absolute bottom-0 right-0 ${SIZES.focus.padding} pointer-events-none`}
							style={{
								maxWidth: `${SIZES.focus.maxWidthPercent}%`,
								maxHeight: `${SIZES.focus.maxHeightPercent}%`,
							}}
						>
							<ImageDisplay
								imageId={scene.FocusImageId}
								className="max-w-full max-h-full object-contain rounded-lg border-2 border-base-300 bg-base-200/90 shadow-lg"
								alt="Scene focus"
							/>
						</div>
					)}

					{/* Collapse Button */}
					<button
						onClick={handleCollapse}
						className="absolute top-2 right-2 btn btn-circle btn-ghost btn-xs bg-base-100/50 hover:bg-base-100 z-10"
						title="Hide scene"
					>
						<span className="icon-[mdi--close] w-4 h-4" />
					</button>
				</div>
			</div>
		</>
	);
}