import { Context } from "../Context/Context";
import { Campaign } from "./Campaign";
import { CampaignLoadingService } from "../../services/CampaignLoadingService";
import { assertUsableRoomCode } from "./CampaignUtils";

export const CampaignActions = {
	/**
	 * Edits campaign metadata (name, room code, settings). If the campaign
	 * is currently active, updates the live payload; otherwise loads the
	 * stored payload, applies the patch, and saves it back. Always refreshes
	 * the CampaignInfo metadata.
	 */
	async edit(
		params: { campaignId: string; updates: Partial<Campaign> },
		context: Context
	): Promise<void> {
		assertUsableRoomCode(params.updates.RoomCode);
		const info = context.Campaigns.find((c) => c.Id === params.campaignId);

		if (!info) {
			console.warn(`Campaign not found: ${params.campaignId}`);
			return;
		}

		let campaign: Campaign | null = null;

		if (
			context.ActiveCampaign &&
			(context.ActiveCampaign.Id === params.campaignId ||
				context.ActiveCampaign.RoomCode === params.campaignId)
		) {
			campaign = context.ActiveCampaign;
			Object.assign(campaign, params.updates);
		} else {
			campaign = await CampaignLoadingService.loadCampaign(
				params.campaignId
			);
			if (!campaign) {
				console.warn(
					`Campaign payload missing in IndexedDB: ${params.campaignId}`
				);
				return;
			}
			Object.assign(campaign, params.updates);
			await CampaignLoadingService.saveCampaign(campaign);
		}

		// Sync metadata fields that the user might have edited (Name,
		// RoomCode) so the campaigns list stays accurate.
		info.Name = campaign.Name;
		info.RoomCode = campaign.RoomCode;
		info.CharacterCount =
			(campaign.CharacterRoster?.length ?? 0) +
			(campaign.GameState?.Characters?.length ?? 0);
	},
};
