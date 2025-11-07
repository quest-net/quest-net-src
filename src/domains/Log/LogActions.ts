// LogActions.ts - Updated
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

	/**
	 * Determines if a user can see a specific log entry
	 * Centralized visibility logic used by both LogDisplay and LogAlerts
	 */
	canUserSeeEntry(
		entry: LogEntry,
		userRole: "dm" | "player" | undefined,
		selectedCharacterId: string | undefined
	): boolean {
		// Everyone can see "all" visibility
		if (entry.Visibility.includes("all")) return true;

		// DMs can see DM-only entries
		if (userRole === "dm" && entry.Visibility.includes("dm")) return true;

		// Players have special rules
		if (userRole === "player") {
			// Players can see player-visible entries
			if (entry.Visibility.includes("player")) return true;

			// Players can see entries where they own the actor
			if (
				entry.Visibility.includes("owner") &&
				selectedCharacterId &&
				entry.ActorId === selectedCharacterId
			) {
				return true;
			}
		}

		return false;
	},
};