// components/Map/Token/tokenConstants.ts
// Token rendering constants and configuration

import { TILE_W } from "../Terrain";

// Token base dimensions (for "small" size)
export const TOKEN_W = TILE_W * 0.8;
export const TOKEN_H = TILE_W * 0.8;
export const CORNER_RADIUS = Math.min(TOKEN_W, TOKEN_H) * 0.45;

// Actor size types and scaling factors
export type ActorSize = "small" | "medium" | "large";

export const SIZE_SCALE: Record<ActorSize, number> = {
	small: 1.0,   // Default size (current)
	medium: 1.5,  // 50% larger
	large: 2.0,   // 2x larger
};

// Outline styling
export const OUTLINE_OUTER_WIDTH = 2;
export const OUTLINE_SELECTED_WIDTH = 3;
export const OUTLINE_DEFAULT_COLOR = 0x323333;
export const OUTLINE_SELECTED_COLOR = 0x002bff;

// Token opacity levels
export const MAIN_ALPHA = 1.0;
export const GHOST_ALPHA = 0.15;

// Shadow parameters (note: shadows don't scale with token size)
export const SHADOW_SCALE_K = 0.35;
export const SHADOW_SCALE_MIN = 0.25;
export const SHADOW_ALPHA_BASE = 0.2;
export const SHADOW_ALPHA_MIN = 0.12;

/**
 * Get scaled token dimensions based on actor size
 */
export function getTokenDimensions(size: ActorSize = "small") {
	const scale = SIZE_SCALE[size];
	return {
		width: TOKEN_W * scale,
		height: TOKEN_H * scale,
		cornerRadius: CORNER_RADIUS * scale,
		scale, // Also export the raw scale factor
	};
}