// Ping.ts
// Ephemeral map highlight used for tactical communication between players.
//
// Pings are not persisted as their own collection — they ride on top of the
// existing Log system as entries with Category === "ping". The clicked
// tile and height are stored in LogEntry.Details as a JSON string so that
// the existing replication / migration pipeline does not need to change.

export interface PingDetails {
	x: number;
	y: number;
	h: number;
}

export const PING_DURATION_MS = 4000;

/**
 * Serializes the clicked ping surface for storage in LogEntry.Details.
 */
export function serializePingDetails(details: PingDetails): string {
	return JSON.stringify(details);
}

/**
 * Parses the clicked ping surface from LogEntry.Details. Returns null if invalid.
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
			if (typeof parsed.h === "number" && Number.isFinite(parsed.h)) {
				return { x: parsed.x, y: parsed.y, h: parsed.h };
			}
		}
	} catch {
		// fall through
	}
	return null;
}
