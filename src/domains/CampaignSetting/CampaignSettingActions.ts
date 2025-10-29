import { Context } from "../Context/Context";
import { CampaignSettings } from "./CampaignSetting";
import { CampaignActions } from "../Campaign/CampaignActions";

export const CampaignSettingActions = {
	/**
	 * Creates default campaign settings
	 */
	createDefault(): CampaignSettings {
		return {
			StatDefinitions: [
				{ Id: "health", Name: "Health", Color: "#ff0000", Max: 50 },
				{ Id: "mana", Name: "Mana", Color: "#0066ff", Max: 20 },
			],
			VisibilitySettings: {
				playersSeeDMRolls: false,
				playersSeePeerRolls: true,
			},
			MapSettings: {
				is3D: true,
			},
		};
	},

	/**
	 * Updates campaign settings
	 * Replaces the entire Settings object or merges partial updates
	 */
	edit(params: { updates: Partial<CampaignSettings> }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		Object.assign(campaign.Settings, params.updates);
	},
};
