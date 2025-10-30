// components/Map/Token/tokenHelpers.ts
// Helper functions for token rendering

import {
	SHADOW_SCALE_K,
	SHADOW_SCALE_MIN,
	SHADOW_ALPHA_BASE,
	SHADOW_ALPHA_MIN,
} from "./tokenConstants";

/**
 * Calculate shadow scale and alpha based on height difference
 * between actor and the ground
 */
export function calculateShadowParams(heightDelta: number): {
	scale: number;
	alpha: number;
} {
	const d = Math.max(0, heightDelta);
	const scale = Math.max(SHADOW_SCALE_MIN, 1 / (1 + SHADOW_SCALE_K * d));
	const alpha = Math.max(SHADOW_ALPHA_MIN, SHADOW_ALPHA_BASE * scale);
	return { scale, alpha };
}