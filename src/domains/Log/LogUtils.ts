import { LogEntry } from "./Log";

export const MAX_LOG_SIZE = 1000;

export const LogUtils = {
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
};
