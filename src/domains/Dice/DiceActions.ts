import { Context } from "../Context/Context";
import { LogActions } from "../Log/LogActions";
import type { LogVisibility, RollOutcome } from "../Log/Log";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { ActorUtils } from "../Actor/ActorUtils";

export const DiceActions = {
	/**
	 * Logs an observable roll. `actorId` attributes the roll (optional); `expr` is the
	 * formula; `total` is the already-computed result; `breakdown` is the per-die
	 * breakdown (surfaced in details, like DiceRoller / item / skill rolls);
	 * `rollOutcome` carries the structured crit/fumble facts (computed by the caller
	 * from the full roll result, since the total/breakdown alone can't be re-derived
	 * here without re-rolling) so the crit splash fires off structured data, not
	 * text; `tags` are optional author labels in the summary (e.g. "attack", "save");
	 * `secret: true` forces a DM-only log line.
	 */
	roll(
		params: {
			actorId?: string;
			expr: string;
			total: number;
			breakdown?: string;
			rollOutcome?: RollOutcome;
			tags?: string[];
			secret?: boolean;
		},
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		const actor = params.actorId
			? ActorUtils.getActiveActors(campaign).find((a) => a.Id === params.actorId)
			: undefined;

		const who = actor ? `${actor.Name} rolled` : "Rolled";
		const tagSuffix =
			params.tags && params.tags.length > 0 ? ` [${params.tags.join(", ")}]` : "";

		// A script roll is authored by the DM, so it follows the same visibility as a
		// manual DM roll: shown to all only if the campaign lets players see DM rolls
		// (or hidden when the script opts into a secret roll). Mirrors DiceRoller.
		const playersSeeDMRolls =
			campaign.Settings.VisibilitySettings?.playersSeeDMRolls ?? true;
		const visibility: LogVisibility[] =
			params.secret || !playersSeeDMRolls ? ["dm"] : ["all"];

		LogActions.create(
			{
				action: `${who} ${params.expr}: ${params.total}${tagSuffix}`,
				details: params.breakdown ? `Breakdown: ${params.breakdown}` : undefined,
				category: "dice",
				level: "important",
				visibility,
				actorId: params.actorId,
				rollOutcome: params.rollOutcome,
			},
			context
		);
	},
};
