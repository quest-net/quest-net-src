// components/Map/Token/tokenConstants.ts
// Token rendering constants and configuration

import { TILE_W } from "../Terrain";
import type { ActorSize } from "../../../domains/Actor/Actor";

// Re-export ActorSize for convenience
export type { ActorSize };

// Token base dimensions (for "small" size)
export const TOKEN_W = TILE_W * 0.8;
export const TOKEN_H = TILE_W * 0.8;
export const CORNER_RADIUS = Math.min(TOKEN_W, TOKEN_H) * 0.45;

// Actor size scaling factors
export const SIZE_SCALE: Record<ActorSize, number> = {
	"extra-small": 0.6, // 60% of default, used for ground items
	small: 1.0, // Default size (current)
	medium: 1.5, // 50% larger
	large: 2.0, // 2x larger
};

// Outline styling
export const OUTLINE_OUTER_WIDTH = 2;
export const OUTLINE_SELECTED_WIDTH = 3;
export const OUTLINE_DEFAULT_COLOR = 0x323333;
export const OUTLINE_SELECTED_COLOR = 0x002bff;

// Token opacity levels
export const MAIN_ALPHA = 1.0;
export const GHOST_ALPHA = 0.15;

// Shadow scaling constants
export const SHADOW_SCALE_K = 0.1;
export const SHADOW_SCALE_MIN = 0.5;

// Shadow opacity constants
export const SHADOW_ALPHA_BASE = 0.3;
export const SHADOW_ALPHA_MIN = 0.15;

// Fixed bottom offset from the tile anchor point.
// The token's bottom edge always sits this far above (cx, cy),
// so tokens grow upward as they get larger instead of floating.
export const TOKEN_GROUND_OFFSET = -TOKEN_H * 0.25;

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

/**
 * Get token positioning relative to (cx, cy) tile anchor.
 * Bottom edge is anchored at TOKEN_GROUND_OFFSET; token grows upward with size.
 */
export function getTokenPosition(size: ActorSize = "small") {
	const { width, height, cornerRadius, scale } = getTokenDimensions(size);
	const rx = -width * 0.5;                       // left edge
	const ry = TOKEN_GROUND_OFFSET - height;        // top edge (grows upward)
	const centerY = TOKEN_GROUND_OFFSET - height * 0.5; // vertical center of the token
	const stickerY = ry - height * 0.15;            // just above the top edge
	return { rx, ry, centerY, stickerY, width, height, cornerRadius, scale };
}
