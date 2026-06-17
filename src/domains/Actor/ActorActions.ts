import { CampaignUtils } from "../Campaign/CampaignUtils";
import { Context } from "../Context/Context";
import { LogActions } from "../Log/LogActions";

/**
 * Shared actor logic for both Characters and Entities
 * Domain-specific spawn/remove logic belongs in CharacterActions/EntityActions
 */
export const ActorActions = {
	/**
	 * Transfers a stat amount from an actor to another actor or shared inventory
	 */
	transferStat(
		params: {
			sourceActorId: string;
			sourceStatId: string;
			targetId: string;
			targetStatId: string;
			amount: number;
		},
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		// Look up stat name from campaign templates
		const statTemplate = campaign.Settings.StatDefinitions.find(
			(d) => d.Id === params.sourceStatId
		);
		const statName = statTemplate?.Name ?? params.sourceStatId;

		// Resolve source
		const allActors = [
			...campaign.GameState.Characters,
			...campaign.GameState.Entities,
		];
		const sourceActor = allActors.find((a) => a.Id === params.sourceActorId);
		if (!sourceActor) return;

		const sourceStat = sourceActor.Stats.find((s) => s.Id === params.sourceStatId);
		if (!sourceStat) return;
		// Refuse transfers from unset stats -- the actor doesn't have this stat.
		if (sourceStat.Current === null) return;

		// Ensure source has enough points
		const availableAmount = Math.min(sourceStat.Current, params.amount);
		if (availableAmount <= 0) return;

		// Resolve target
		const targetActor = allActors.find((a) => a.Id === params.targetId);
		const targetSharedInv = campaign.Settings.SharedInventories?.find(
			(i) => i.Id === params.targetId
		);

		let targetName = "Unknown";
		let transferSuccess = false;

		if (targetActor) {
			targetName = targetActor.Name;
			const tStat = targetActor.Stats.find((s) => s.Id === params.targetStatId);
			// Refuse transfers into unset stats -- target doesn't have this stat.
			if (tStat && tStat.Current !== null) {
				tStat.Current = Math.min(tStat.Max, tStat.Current + availableAmount);
				transferSuccess = true;
			}
		} else if (targetSharedInv) {
			targetName = targetSharedInv.Name;
			const tStat = targetSharedInv.Stats.find((s) => s.Id === params.targetStatId);
			if (tStat && tStat.Current !== null) {
				tStat.Current = Math.min(tStat.Max, tStat.Current + availableAmount);
				transferSuccess = true;
			}
		}

		if (transferSuccess) {
			// Deduct from source (sourceStat.Current guaranteed non-null above)
			sourceStat.Current = Math.max(0, sourceStat.Current - availableAmount);

			LogActions.create(
				{
					action: "Stat Transferred",
					details: `${availableAmount} ${statName} was transferred from ${sourceActor.Name} to ${targetName}.`,
					category: "character",
					level: "info",
					visibility: ["all"],
					actorId: params.sourceActorId,
				},
				context
			);
		}
	},
};
