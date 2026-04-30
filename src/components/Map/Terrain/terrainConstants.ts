// components/Map/Terrain/terrainConstants.ts
// Terrain rendering constants and configuration

// Highlight colors
export const RANGE_COLOR = 0xfa4398; // movement range highlight (full move budget from current position)
export const REMAINING_COLOR = 0x06b6d4; // remaining movement range during a combat turn (cyan, distinct from hover blue)
export const HOVER_COLOR = 0x002bff; // hovered tile highlight

// Elevation shading configuration
export type ElevationStyle = "off" | "bright";
export const ELEVATION_STYLE: ElevationStyle = "bright";

// Elevation tinting strength (0-1 range)
export const ELEV_TOP_STRENGTH = 0.45; // Top face elevation tint
export const ELEV_SIDE_STRENGTH = 0.3; // Side face elevation tint

// Height normalization range
export const HEIGHT_MIN = 0;
export const HEIGHT_MAX = 16;

// Face darkening multipliers (applied to base color)
export const EAST_FACE_MULTIPLIER = 0.82; // Slightly darker
export const SOUTH_FACE_MULTIPLIER = 0.68; // More darker

// Stroke styling
export const TILE_STROKE_WIDTH = 1;
export const EAST_FACE_STROKE_ALPHA = 0.08;
export const SOUTH_FACE_STROKE_ALPHA = 0.1;

// Meaningful surface boundaries: map perimeter, material changes, and height drops.
export const SURFACE_EDGE_ALPHA = 0.22;
export const SURFACE_EDGE_WIDTH = 1.25;

// Very subtle per-tile material variation so broad areas do not look flat when
// interior grid strokes are suppressed.
export const SURFACE_VARIATION_STRENGTH = 0.025;

// Highlight styling
export const HOVER_OUTLINE_WIDTH = 4;
export const RANGE_OUTLINE_WIDTH = 2;
export const HIGHLIGHT_ALPHA = 0.5;
export const HIGHLIGHT_MITER_LIMIT = 2;

export const TILE_W = 64;
export const TILE_H = 32;
export const V_SCALE = 20;
