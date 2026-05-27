// utils/UrlParser.ts

const GUID_LENGTH = 36;

/**
 * Route segments that are reserved by the app router and must not be used as
 * room codes. If a room code collides with one of these, navigating to it
 * loads the wrong page instead of CampaignView.
 *
 * Keep in sync with the static <Route> entries in App.tsx.
 */
export const RESERVED_ROUTE_KEYWORDS = ["campaigns", "settings", "wiki"] as const;

/**
 * Returns true if the given string is a reserved app route keyword.
 */
export function isReservedRouteKeyword(code: string): boolean {
	return (RESERVED_ROUTE_KEYWORDS as readonly string[]).includes(code.toLowerCase());
}

/**
 * Gets the URL identifier from hash (room code or campaign ID)
 * Extracts only the first segment, ignoring nested routes
 * Examples:
 * - /#/dragon-cave → "dragon-cave"
 * - /#/dragon-cave/character → "dragon-cave"
 * - /#/550e8400-e29b-41d4-a716-446655440000 → "550e8400-e29b-41d4-a716-446655440000"
 * - /#/550e8400-e29b-41d4-a716-446655440000/character → "550e8400-e29b-41d4-a716-446655440000"
 */
export function getUrlIdentifier(): string {
	const hash = window.location.hash;
	// Remove leading #/ and split by /
	const path = hash.replace(/^#\/?/, "");
	const segments = path.split("/");
	// Return only the first segment (the campaign identifier)
	return segments[0] || "";
}

/**
 * Determines if a string is a GUID (36 characters)
 * Room codes are limited to 32 characters or less
 */
export function isGUID(str: string): boolean {
	return str.length === GUID_LENGTH;
}

/**
 * Determines if the current user is accessing as DM (using campaign ID)
 * or as a player (using room code)
 */
export function isDmAccess(): boolean {
	const identifier = getUrlIdentifier();
	return isGUID(identifier);
}
