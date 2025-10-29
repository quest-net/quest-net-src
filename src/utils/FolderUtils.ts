// utils/FolderUtils.ts

/**
 * Utilities for virtual folder system based on path tags
 * Path tags format: "path:FolderA/NestedFolder/DeepFolder"
 */

const PATH_TAG_PREFIX = "path:";
const PATH_SEPARATOR = "/";

export interface FolderInfo {
	name: string;
	fullPath: string;
}

/**
 * Extracts all path tags from an item's tags array
 * @param tags - Array of tag strings
 * @returns Array of path strings (without "path:" prefix)
 */
export function extractPathTags(tags: string[] | undefined): string[] {
	if (!tags) return [];

	return tags
		.filter((tag) => tag.startsWith(PATH_TAG_PREFIX))
		.map((tag) => tag.substring(PATH_TAG_PREFIX.length));
}

/**
 * Gets all folders that should be displayed at the current path level
 * @param items - All items with tags
 * @param currentPath - Current path segments (e.g., ["Knights", "Elite"])
 * @returns Array of unique folder info at the next level
 */
export function getFoldersAtPath<T extends { tags?: string[] }>(
	items: T[],
	currentPath: string[]
): FolderInfo[] {
	const folderSet = new Set<string>();

	for (const item of items) {
		const pathTags = extractPathTags(item.tags);

		for (const pathTag of pathTags) {
			const segments = pathTag.split(PATH_SEPARATOR);

			// Check if this path matches current path up to currentPath.length
			const matchesCurrentPath = currentPath.every(
				(segment, index) => segments[index] === segment
			);

			if (matchesCurrentPath && segments.length > currentPath.length) {
				// There's a next level folder
				const nextFolder = segments[currentPath.length];
				folderSet.add(nextFolder);
			}
		}
	}

	// Convert to FolderInfo array with full paths
	return Array.from(folderSet).map((name) => ({
		name,
		fullPath: [...currentPath, name].join(PATH_SEPARATOR),
	}));
}

/**
 * Filters items to show only those at the exact current path level
 * (not in subfolders)
 * @param items - All items
 * @param currentPath - Current path segments
 * @returns Items that should be displayed at this level
 */
export function getItemsAtPath<T extends { tags?: string[] }>(
	items: T[],
	currentPath: string[]
): T[] {
	// Root level: show items without path tags OR with path tags that don't go deeper
	if (currentPath.length === 0) {
		return items.filter((item) => {
			const pathTags = extractPathTags(item.tags);

			// No path tags = show at root
			if (pathTags.length === 0) return true;

			// Has path tags = don't show at root (they're in folders)
			return false;
		});
	}

	// Deeper levels: show items whose path exactly matches current path
	return items.filter((item) => {
		const pathTags = extractPathTags(item.tags);

		return pathTags.some((pathTag) => {
			const segments = pathTag.split(PATH_SEPARATOR);

			// Path must match current path exactly (same length and values)
			return (
				segments.length === currentPath.length &&
				segments.every((segment, index) => segment === currentPath[index])
			);
		});
	});
}

/**
 * Validates a folder name
 * @param name - Folder name to validate
 * @returns Error message if invalid, null if valid
 */
export function validateFolderName(name: string): string | null {
	if (!name || name.trim().length === 0) {
		return "Folder name cannot be empty";
	}

	if (name.includes(" ")) {
		return "Folder name cannot contain spaces (use hyphens or camelCase)";
	}

	// Check for special characters (allow alphanumeric, hyphens, underscores, and forward slash for nested)
	const validPattern = /^[a-zA-Z0-9_\-\/]+$/;
	if (!validPattern.test(name)) {
		return "Folder name can only contain letters, numbers, hyphens, underscores, and forward slashes";
	}

	// No leading/trailing slashes
	if (name.startsWith(PATH_SEPARATOR) || name.endsWith(PATH_SEPARATOR)) {
		return "Folder name cannot start or end with a forward slash";
	}

	// No double slashes
	if (name.includes("//")) {
		return "Folder name cannot contain consecutive forward slashes";
	}

	return null;
}

/**
 * Builds a full path tag string from path segments
 * @param pathSegments - Array of path segments
 * @returns Full tag string (e.g., "path:Knights/Elite")
 */
export function buildPathTag(pathSegments: string[]): string {
	return PATH_TAG_PREFIX + pathSegments.join(PATH_SEPARATOR);
}

/**
 * Normalizes folder name (lowercase for consistency)
 * @param name - Folder name
 * @returns Normalized name
 */
export function normalizeFolderName(name: string): string {
	return name.toLowerCase();
}

/**
 * Replaces any existing path tags on an item with a new one
 * @param tags - Current tags array
 * @param newPath - New path segments
 * @returns Updated tags array
 */
export function replacePathTag(
	tags: string[] | undefined,
	newPath: string[]
): string[] {
	const currentTags = tags || [];

	// Remove all existing path tags
	const nonPathTags = currentTags.filter(
		(tag) => !tag.startsWith(PATH_TAG_PREFIX)
	);

	// Add new path tag
	const newPathTag = buildPathTag(newPath);

	return [...nonPathTags, newPathTag];
}

/**
 * Removes all path tags from an item's tags
 * @param tags - Current tags array
 * @returns Tags array with path tags removed
 */
export function removePathTag(tags: string[] | undefined): string[] {
	const currentTags = tags || [];

	// Remove all existing path tags
	return currentTags.filter((tag) => !tag.startsWith(PATH_TAG_PREFIX));
}

export function applyPathToTags(
	tags: string[] | undefined,
	currentPath: string[]
): string[] {
	if (currentPath.length === 0) {
		return tags || [];
	}

	const pathTag = buildPathTag(currentPath);
	return [...(tags || []), pathTag];
}
