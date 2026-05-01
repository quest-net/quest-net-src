import { Context } from "../Context/Context";
import {
	LogEntry,
	LogCategory,
	LogLevel,
	LogVisibility,
} from "../Log/LogEntry";
import { CampaignActions } from "../Campaign/CampaignActions";

const MAX_LOG_SIZE = 1000;

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
		},
		context: Context
	): void {
		if (context.IsOptimistic) return;

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
	 * Returns log entries in chronological order (oldest to newest).
	 * This handles the ring buffer's non-sequential storage.
	 */
	getChronologicalLog(campaign: { Log: LogEntry[]; LogHead?: number }): LogEntry[] {
		if (!campaign.Log || campaign.Log.length === 0) {
			return [];
		}

		// If buffer isn't full or LogHead is undefined, just sort by timestamp
		if (campaign.LogHead === undefined || campaign.Log.length < MAX_LOG_SIZE) {
			return [...campaign.Log].sort((a, b) => a.Timestamp - b.Timestamp);
		}

		// Ring buffer is full - reconstruct chronological order
		// LogHead points to the NEXT slot to write (i.e., the oldest entry)
		const head = campaign.LogHead;
		const result: LogEntry[] = [];

		// Read from head (oldest) to end, then from 0 to head-1 (newest)
		for (let i = 0; i < MAX_LOG_SIZE; i++) {
			const index = (head + i) % MAX_LOG_SIZE;
			if (campaign.Log[index]) {
				result.push(campaign.Log[index]);
			}
		}

		return result;
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
		if (!params || typeof params.action !== "string") {
			return false;
		}
		return params.action.trim() === command;
	},

	canUserSeeEntry(
		entry: LogEntry,
		userRole: "dm" | "player" | undefined,
	): boolean {
		if (userRole === "dm" && (entry.Visibility.includes("dm") || entry.Visibility.includes("all"))) return true;
		let visibilityCheck = entry.Visibility.includes("all") || (entry.Visibility.includes("player"));
		let categoryCheck = entry.Category.includes("chat") || entry.Category.includes("dice") || entry.Category.includes("sticker") || entry.Category.includes("ping");
		if (visibilityCheck && categoryCheck) {
			return true;
		}
		return false;
	},

	// Export for migration and other uses
	MAX_LOG_SIZE,
};