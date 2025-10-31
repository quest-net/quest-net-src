// components/Map/Ladder/ladderConstants.ts
// Constants for ladder rendering and interaction

import { V_SCALE } from "../Terrain";

/**
 * Ladder hit-testing radius (world pixels)
 * How close to the ladder's X coordinate the cursor must be to interact
 */
export const LADDER_HIT_RADIUS = 8;

/**
 * Vertical offset to align ladder with token visual position
 * Tokens float above their grid position, so the ladder needs to shift up
 */
export const LADDER_VISUAL_OFFSET = V_SCALE * 1.0; // One V_SCALE unit

/**
 * Visual styling constants for ladder rendering
 */
export const LADDER_VISUAL = {
	/** Width of the ladder shaft (pixels) */
	WIDTH: 2,

	/** Length of regular height tick marks (pixels) */
	TICK_LENGTH: 8,

	/** Length of hovered height tick mark (pixels) */
	HOVER_TICK_LENGTH: 14,

	/** Width of hovered height tick mark (pixels) */
	HOVER_WIDTH: 3,

	/** Opacity of ladder segments within movement range */
	IN_RANGE_ALPHA: 0.8,

	/** Opacity of ladder segments outside movement range */
	OUT_RANGE_ALPHA: 0.4,
} as const;

/**
 * Tolerance value for floating-point comparisons (pixels)
 * Used when checking if a coordinate is within a range
 */
export const LADDER_Y_TOLERANCE = 3;