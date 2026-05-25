import type { ActorSize, Position } from "../../../domains/Actor/Actor";

export const ACTOR_TOKEN_DESCRIPTOR_DEFAULTS = {
	POSITION: { x: 0, y: 0, h: 0 } satisfies Position,
	MOVE_SPEED: 5,
	SIZE: "small" as ActorSize,
} as const;

export const ACTOR_TOKEN_TEXTURE = {
	SIZE: 512,
	OUTER_CORNER_RADIUS: 56,
	SELECTED_OUTLINE_COLOR: "#2563eb",
	SELECTED_OUTLINE_LINE_WIDTH: 14,
	DEFAULT_OUTLINE_COLOR: "#1f2937",
	DEFAULT_OUTLINE_LINE_WIDTH: 8,
	TEXT_FILL: "#ffffff",
} as const;

export const ACTOR_TOKEN_PLACEHOLDER = {
	FILL: "#4b5563",
	CHARACTER_FILL: "#1d4ed8",
	ENTITY_FILL: "#92400e",
	TEXT_MAX_WIDTH_RATIO: 0.78,
	TEXT_MAX_LINES: 3,
	TEXT_MAX_FONT_SIZE: 42,
	TEXT_MIN_FONT_SIZE: 20,
	TEXT_LINE_HEIGHT_MULTIPLIER: 1.08,
	TEXT_MAX_HEIGHT_RATIO: 0.72,
	TEXT_SHADOW_COLOR: "rgba(0, 0, 0, 0.35)",
	TEXT_SHADOW_BLUR: 8,
	TEXT_SHADOW_OFFSET_Y: 2,
} as const;

export const ACTOR_TOKEN_SIZE_SCALE: Record<ActorSize, number> = {
	"extra-small": 0.65,
	small: 1,
	medium: 1.35,
	large: 1.7,
};

export const ACTOR_TOKEN_WORLD_SIZE = {
	BASE_WIDTH: 0.95,
	BASE_HEIGHT: 0.95,
	CUTOUT_SCALE_MULTIPLIER: 1.15,
} as const;

export const ACTOR_TOKEN_RENDER_ORDER = {
	SHADOW: 99,
	NORMAL: 101,
	SELECTION: 101.5,
	PICK: 102,
	X_RAY: 110,
} as const;

export const ACTOR_TOKEN_PLACEMENT = {
	BASE_Y_OFFSET: 0.01,
	STANDEE_BASE_GAP: 0.05,
	CUTOUT_STANDEE_BASE_GAP: 0.01,
	AIRBORNE_THRESHOLD: 0.05,
	AIRBORNE_HALO_HEIGHT: 0.03,
	AIRBORNE_STANDEE_HALO_GAP: 0.02,
	CUTOUT_AIRBORNE_STANDEE_HALO_GAP: 0.01,
	TERRAIN_WORLD_Y_OFFSET: -0.5,
} as const;

export const ACTOR_TOKEN_COLORS = {
	CHARACTER_BASE: 0x2563eb,
	ENTITY_BASE: 0xb45309,
	SELECTED_RING: 0x60a5fa,
	BASE: 0x1f2937,
} as const;

export const ACTOR_TOKEN_SHADOW = {
	TEXTURE_SIZE: 128,
	GRADIENT_INNER_RADIUS: 8,
	GRADIENT_OUTER_RADIUS: 58,
	GRADIENT_INNER_COLOR: "rgba(0, 0, 0, 0.45)",
	GRADIENT_MID_STOP: 0.55,
	GRADIENT_MID_COLOR: "rgba(0, 0, 0, 0.2)",
	GRADIENT_OUTER_COLOR: "rgba(0, 0, 0, 0)",
	BASE_OPACITY: 0.34,
	MIN_OPACITY: 0.18,
	AIRBORNE_BASE_OPACITY: 0.58,
	AIRBORNE_MIN_OPACITY: 0.32,
	GROUNDED_Z_SCALE: 0.65,
	AIRBORNE_Z_SCALE: 0.95,
	WIDTH_SCALE: 0.9,
	GROUNDED_MIN_SCALE: 0.55,
	GROUNDED_FALLOFF: 0.12,
	AIRBORNE_MIN_SCALE: 0.7,
	AIRBORNE_FALLOFF: 0.08,
	Y_OFFSET: 0.006,
} as const;

export const ACTOR_TOKEN_PICK = {
	SCALE_MULTIPLIER: 1.25,
	ALPHA_THRESHOLD: 8,
	BOUNDS_PADDING_PX: 10,
	SUPPORT_U_MIN: 0.27,
	SUPPORT_U_MAX: 0.73,
	SUPPORT_BAND_MAX_V: 0.18,
	FALLBACK_MOVE_SPEED: ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.MOVE_SPEED,
} as const;

export const ACTOR_TOKEN_BASE = {
	HEIGHT: 0.08,
	RADIUS_SCALE: 0.30,
	RADIAL_SEGMENTS: 24,
	ROUGHNESS: 0.65,
	METALNESS: 0,
	ACCENT_RADIUS_SCALE: 0.96,
	ACCENT_TUBE_RADIUS: 0.018,
	ACCENT_TUBE_SEGMENTS: 5,
	ACCENT_RADIAL_SEGMENTS: 24,
	ACCENT_Y_OFFSET: 0.006,
} as const;

export const ACTOR_TOKEN_HALO = {
	RADIUS_SCALE: 0.30,
	OUTER_TUBE_RADIUS: 0.025,
	INNER_TUBE_RADIUS: 0.025,
	TUBE_SEGMENTS: 5,
	OUTER_RADIAL_SEGMENTS: 32,
	INNER_RADIAL_SEGMENTS: 24,
	INNER_RADIUS_SCALE: 0.68,
	INNER_Y_OFFSET: -0.05,
	OUTER_DEFAULT_OPACITY: 0.72,
	OUTER_SELECTED_OPACITY: 0.95,
	INNER_DEFAULT_OPACITY: 0.67,
	INNER_SELECTED_OPACITY: 0.80,
} as const;

export const ACTOR_TOKEN_OCCLUSION = {
	EPSILON: 0.001,
} as const;

export const ACTOR_TOKEN_MOVEMENT_ANIMATION = {
	MIN_DURATION_MS: 180,
	MAX_DURATION_MS: 520,
	MS_PER_WORLD_UNIT: 115,
	POSITION_EPSILON: 0.0001,
} as const;

export const ACTOR_TOKEN_HEIGHT_DRAG = {
	FALLBACK_PIXELS_PER_HEIGHT: 100,
	START_THRESHOLD_PX: 20,
	ANIMATION_DURATION_MS: 110,
	GUIDE_COLOR: 0x38bdf8,
	GUIDE_OPACITY: 0.85,
	GUIDE_RENDER_ORDER: 98,
	GUIDE_Y_OFFSET: 0.035,
} as const;

export const ACTOR_TOKEN_DRAG = {
	// Pixel radius around an actor's projected screen position that
	// counts as "on the actor" for pointerdown. Generous so that a
	// flier sitting high above terrain is still grabbable when the
	// billboard would otherwise be a tiny target.
	PROXIMITY_RADIUS_PX: 36,
	// Pointer movement past this much (in CSS pixels) flips a pending
	// click into an active drag. Below the threshold, pointerup is
	// treated as a click that toggles selection.
	START_THRESHOLD_PX: 5,
	// Animation when the actor visual snaps to a new candidate tile
	// during a drag. Short -- the actor should track the cursor.
	FOLLOW_ANIMATION_DURATION_MS: 90,
	// Animation when a drag is canceled (e.g. release on invalid spot)
	// and the actor returns to its original position.
	CANCEL_ANIMATION_DURATION_MS: 220,
} as const;
