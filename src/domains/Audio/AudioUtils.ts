// domains/Audio/AudioUtils.ts

const PATH_TAG_PREFIX = "path:";
const PATH_SEPARATOR = "/";

/**
 * Builds a full path tag string from path segments
 * @param pathSegments - Array of path segments
 * @returns Full tag string (e.g., "path:Knights/Elite")
 */
export function buildPathTag(pathSegments: string[]): string {
	return PATH_TAG_PREFIX + pathSegments.join(PATH_SEPARATOR);
}
