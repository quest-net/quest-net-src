// LogActions.ts
import { Context } from "../Context/Context";
import {
	LogEntry,
	LogCategory,
	LogLevel,
	LogVisibility,
} from "../Log/LogEntry";
import { CampaignActions } from "../Campaign/CampaignActions";

const MAX_LOG_SIZE = 1000; // Configurable

export const LogActions = {
	/**
	 * Creates and adds a log entry to the campaign
	 * Automatically manages log size by removing oldest entries
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
		},
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);

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
		};

		// Add new entry
		campaign.Log.push(entry);

		// Enforce max size - remove oldest entries
		if (campaign.Log.length > MAX_LOG_SIZE) {
			const excess = campaign.Log.length - MAX_LOG_SIZE;
			campaign.Log.splice(0, excess);
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

	isCommand(params: any, command: string): boolean {
		// Must be a log:create action with an Action field
		if (!params || typeof params.action !== "string") {
			return false;
		}

		// Check for the specific command, trimming whitespace
		return params.action.trim() === command;
	},
};
