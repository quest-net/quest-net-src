// Ping.ts
// Ephemeral map highlight used for tactical communication between players.
//
// Pings are not persisted as their own collection — they ride on top of the
// existing Log system as entries with Category === "ping". The tile
// coordinates are stored in LogEntry.Details as a JSON string so that the
// existing replication / migration pipeline does not need to change.

export interface PingDetails {
	x: number;
	y: number;
}

export const PING_DURATION_MS = 4000;

/**
 * Serializes ping coordinates for storage in LogEntry.Details.
 */
export function serializePingDetails(details: PingDetails): string {
	return JSON.stringify(details);
}

/**
 * Parses ping coordinates from LogEntry.Details. Returns null if invalid.
 */
export function parsePingDetails(raw: string | undefined): PingDetails | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (
			parsed &&
			typeof parsed.x === "number" &&
			typeof parsed.y === "number" &&
			Number.isFinite(parsed.x) &&
			Number.isFinite(parsed.y)
		) {
			return { x: parsed.x, y: parsed.y };
		}
	} catch {
		// fall through
	}
	return null;
}
