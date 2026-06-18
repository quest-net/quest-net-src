import { Context } from "../Context/Context";
import {
	LogEntry,
	LogCategory,
	LogLevel,
	LogVisibility,
} from "../Log/Log";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { MAX_LOG_SIZE } from "./LogUtils";

export const LogActions = {
	/**
	 * Creates and adds a log entry using ring buffer pattern.
	 * Overwrites the oldest entry in-place instead of shifting.
	 */
	create(
		params: {
			action: string;
			details?: string;
			category: LogCategory;
			level: LogLevel;
			visibility?: LogVisibility[];
			actorId?: string;
			targetId?: string;
			mentionedActorIds?: string[];
		},
		context: Context
	): void {
		if (context.IsOptimistic) return;

		const campaign = CampaignUtils.getActiveCampaign(context);

		const entry: LogEntry = {
			Id: crypto.randomUUID(),
			Timestamp: Date.now(),
			Action: params.action,
			Details: params.details,
			Category: params.category,
			Level: params.level,
			Visibility: params.visibility ?? ["all"],
			ActorId: params.actorId,
			TargetId: params.targetId,
			MentionedActorIds:
				params.mentionedActorIds && params.mentionedActorIds.length > 0
					? params.mentionedActorIds
					: undefined,
		};

		// Initialize LogHead if missing (migration safety)
		if (campaign.LogHead === undefined) {
			campaign.LogHead = campaign.Log.length % MAX_LOG_SIZE;
		}

		// Ring buffer write
		if (campaign.Log.length < MAX_LOG_SIZE) {
			// Buffer not full yet - just push
			campaign.Log.push(entry);
			campaign.LogHead = campaign.Log.length % MAX_LOG_SIZE;
		} else {
			// Buffer full - overwrite at head position
			campaign.Log[campaign.LogHead] = entry;
			campaign.LogHead = (campaign.LogHead + 1) % MAX_LOG_SIZE;
		}
	},

	/**
	 * Helper to create a quick log entry with common defaults
	 */
	log(
		params: {
			action: string;
			category: LogCategory;
			details?: string;
		},
		context: Context
	): void {
		LogActions.create(
			{
				action: params.action,
				details: params.details,
				category: params.category,
				level: "info",
				visibility: ["all"],
			},
			context
		);
	},
};
