import { Context } from "../Context/Context";
import { CampaignSettings } from "./CampaignSetting";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { propagateTemplatesToActors } from "./CampaignSettingUtils";

// ============================================================================
// CAMPAIGN SETTING ACTIONS
// ============================================================================

export const CampaignSettingActions = {
	/**
	 * Updates campaign settings
	 * Replaces the entire Settings object or merges partial updates
	 */
	edit(params: { updates: Partial<CampaignSettings> }, context: Context): void {
		const campaign = CampaignUtils.getActiveCampaign(context);
		Object.assign(campaign.Settings, params.updates);
		propagateTemplatesToActors(campaign);
	},
};
