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
				<p className="text-base-content/60">
					Configure the environment and focus images for the scene display
				</p>
			</div>

			{/* Environment Image */}
			<div className="card bg-base-100 border-2">
				<div className="card-body">
					<h3 className="card-title">Environment Image</h3>
					<p className="text-sm text-base-content/60 mb-4">
						The main background image for the scene
					</p>
					<ImagePicker
						value={scene.EnvironmentImageId}
						onChange={handleEnvironmentChange}
						label="Environment"
					/>
				</div>
			</div>

			{/* Focus Image */}
			<div className="card bg-base-100 border-2">
				<div className="card-body">
					<h3 className="card-title">Focus Image</h3>
					<p className="text-sm text-base-content/60 mb-4">
						A smaller image displayed in the bottom-right corner
					</p>
					<ImagePicker
						value={scene.FocusImageId}
						onChange={handleFocusChange}
						label="Focus"
					/>
				</div>
			</div>
		</div>
	);
}