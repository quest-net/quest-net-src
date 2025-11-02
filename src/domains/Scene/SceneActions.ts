// domains/Scene/SceneActions.ts

import { Context } from "../Context/Context";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";

export const SceneActions = {
	/**
	 * Sets the environment (background) image for the scene
	 */
	setEnvironmentImage(params: { imageId: string }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		
		campaign.GameState.Scene.EnvironmentImageId = params.imageId;

		// Find image name for logging
		const image = campaign.Images.find((img) => img.Id === params.imageId);
		const imageName = image ? image.Name : params.imageId;

		LogActions.create(
			{
				action: "Scene environment updated",
				details: `Environment set to: ${imageName}`,
				category: "system",
				level: "info",
				visibility: ["all"],
			},
			context
		);
	},

	/**
	 * Sets the focus (foreground) image for the scene
	 */
	setFocusImage(params: { imageId: string }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		
		campaign.GameState.Scene.FocusImageId = params.imageId;

		// Find image name for logging
		const image = campaign.Images.find((img) => img.Id === params.imageId);
		const imageName = image ? image.Name : params.imageId;

		LogActions.create(
			{
				action: "Scene focus updated",
				details: `Focus set to: ${imageName}`,
				category: "system",
				level: "info",
				visibility: ["all"],
			},
			context
		);
	},
};