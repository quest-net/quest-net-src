// components/Map/Terrain/terrainHelpers.ts
// Helper functions for terrain rendering

import {
	ELEVATION_STYLE,
	HEIGHT_MIN,
	HEIGHT_MAX,
	type ElevationStyle,
} from "./terrainConstants";

/**
 * Clamp a value between 0 and 1
 */
function clamp01(v: number): number {
	return Math.max(0, Math.min(1, v));
}

/**
 * Normalize a height value to 0-1 range based on min/max heights
 */
export function normalizeHeight(h: number): number {
	return clamp01((h - HEIGHT_MIN) / (HEIGHT_MAX - HEIGHT_MIN));
}

/**
 * Linearly interpolate between two colors
 * @param rgb - Base color as hex number (e.g., 0xFF0000)
 * @param target - Target color as hex number
 * @param t - Interpolation factor (0-1)
 * @returns Interpolated color as hex number
 */
export function lerpColor(rgb: number, target: number, t: number): number {
	const r = (rgb >> 16) & 0xff;
	const g = (rgb >> 8) & 0xff;
	const b = rgb & 0xff;
	
	const tr = (target >> 16) & 0xff;
	const tg = (target >> 8) & 0xff;
	const tb = target & 0xff;
	
	const nr = Math.round(r + (tr - r) * t);
	const ng = Math.round(g + (tg - g) * t);
	const nb = Math.round(b + (tb - b) * t);
	
	return (nr << 16) | (ng << 8) | nb;
}

/**
 * Apply elevation-based tinting to a base color
 * Low elevation → darker (toward black)
 * High elevation → lighter (toward white)
 * 
 * @param base - Base color as hex number
 * @param hNorm - Normalized height (0-1, where 0=lowest, 1=highest)
 * @param strength - Tinting strength (0-1)
 * @returns Tinted color as hex number
 */
export function applyElevationTint(
	base: number,
	hNorm: number,
	strength: number,
	style: ElevationStyle = ELEVATION_STYLE
): number {
	if (style === "off") return base;
	
	// Map normalized height to -1..1 range (centered at 0.5)
	// -1 = lowest (toward black), +1 = highest (toward white)
	const x = (hNorm - 0.5) * 2;
	
	if (x >= 0) {
		// High elevation → lerp toward white
		return lerpColor(base, 0xffffff, Math.min(1, x * strength));
	} else {
		// Low elevation → lerp toward black
		return lerpColor(base, 0x000000, Math.min(1, -x * strength));
	}
}

/**
 * Calculate diamond tile corners in screen space
 * @param cx - Center x
 * @param cy - Center y
 * @param halfW - Half tile width
 * @param halfH - Half tile height
 */
export function getDiamondCorners(
	cx: number,
	cy: number,
	halfW: number,
	halfH: number
) {
	return {
		top: { x: cx, y: cy - halfH },
		right: { x: cx + halfW, y: cy },
		bottom: { x: cx, y: cy + halfH },
		left: { x: cx - halfW, y: cy },
	};
}

/**
 * Calculate inset diamond corners for highlight outlines
 * @param cx - Center x
 * @param cy - Center y
 * @param halfW - Half tile width
 * @param halfH - Half tile height
 * @param inset - Inset amount (typically half the stroke width)
 */
export function getInsetDiamondCorners(
	cx: number,
	cy: number,
	halfW: number,
	halfH: number,
	inset: number
) {
	const iHalfW = Math.max(1, halfW - inset);
	const iHalfH = Math.max(1, halfH - inset);
	
	return {
		top: { x: cx, y: cy - iHalfH },
		right: { x: cx + iHalfW, y: cy },
		bottom: { x: cx, y: cy + iHalfH },
		left: { x: cx - iHalfW, y: cy },
	};
}