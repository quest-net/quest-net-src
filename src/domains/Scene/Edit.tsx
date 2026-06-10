// domains/Scene/SceneEdit.tsx

import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { ImagePicker } from "../../components/inputs/ImagePicker";

export function SceneEdit() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignActions.getActiveCampaign(context);
	const scene = campaign.GameState.Scene;
	const hasEnvironmentImage = !!scene.EnvironmentImageId;
	const hasFocusImage = !!scene.FocusImageId;

	const handleEnvironmentChange = (imageId: string | undefined) => {
		if (!actionService) return;
		// Allow clearing by passing empty string when imageId is undefined
		actionService.execute("scene:setEnvironmentImage", { 
			imageId: imageId || "" 
		});
	};

	const handleFocusChange = (imageId: string | undefined) => {
		if (!actionService) return;
		// Allow clearing by passing empty string when imageId is undefined
		actionService.execute("scene:setFocusImage", { 
			imageId: imageId || "" 
		});
	};

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-2xl font-bold mb-2">Scene Settings</h2>
				<p className="opacity-70">
					Configure the environment and focus images for the scene display
				</p>
			</div>

			{/* Environment Image */}
			<div className="card bg-base-100 border-2">
				<div className="card-body">
					<div className="flex items-start justify-between gap-3">
						<h3 className="card-title">Environment Image</h3>
						{hasEnvironmentImage && (
							<button
								type="button"
								onClick={() => handleEnvironmentChange(undefined)}
								className="btn btn-ghost btn-sm btn-circle"
								title="Clear environment image"
								aria-label="Clear environment image"
							>
								<span className="icon-[mdi--image-remove] h-5 w-5" />
							</button>
						)}
					</div>
					<p className="text-sm opacity-70 mb-4">
						The main background image for the scene
					</p>
					<ImagePicker
						value={scene.EnvironmentImageId}
						onChange={handleEnvironmentChange}
					/>
				</div>
			</div>

			{/* Focus Image */}
			<div className="card bg-base-100 border-2">
				<div className="card-body">
					<div className="flex items-start justify-between gap-3">
						<h3 className="card-title">Focus Image</h3>
						{hasFocusImage && (
							<button
								type="button"
								onClick={() => handleFocusChange(undefined)}
								className="btn btn-ghost btn-sm btn-circle"
								title="Clear focus image"
								aria-label="Clear focus image"
							>
								<span className="icon-[mdi--image-remove] h-5 w-5" />
							</button>
						)}
					</div>
					<p className="text-sm opacity-70 mb-4">
						A smaller image displayed over the environment image
					</p>
					{hasFocusImage && !hasEnvironmentImage && (
						<div className="alert alert-warning mb-4 py-2 text-sm">
							<span className="icon-[mdi--alert] h-5 w-5" />
							<span>Focus image is hidden until an environment image is set.</span>
						</div>
					)}
					<ImagePicker
						value={scene.FocusImageId}
						onChange={handleFocusChange}
					/>
				</div>
			</div>
		</div>
	);
}
