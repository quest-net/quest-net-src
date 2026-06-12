export const THREE_D_MAP_RENDERER = {
	MAX_PIXEL_RATIO: 1.5,
	PERFORMANCE_MAX_PIXEL_RATIO: 0.85,
	CAMERA_NEAR: 0.1,
	// Orthographic cameras have no foreshortening, so the near plane is a flat
	// slice sitting this far in front of the camera. A positive value knife-cuts
	// terrain when the camera orbits close; a negative near puts the clip plane
	// behind the camera so nothing in front ever clips (same trick the terrain
	// editor uses). Symmetric with FAR for a uniform linear-depth slab.
	ORTHO_CAMERA_NEAR: -2000,
	CAMERA_FAR: 2000,
} as const;

export const THREE_D_MAP_CAMERA = {
	FRAMING_MULTIPLIER: 0.85,
	DISTANCE_MULTIPLIER: 2.5,
	PERSPECTIVE_FOV: 75,
	// Perspective/freecam initial distance from target, as a multiple of halfSize.
	// ~1/tan(FOV/2) so the terrain fills the viewport vertically at startup.
	PERSPECTIVE_DISTANCE_MULTIPLIER: 1.3,
} as const;

export const THREE_D_MAP_FREECAM = {
	MOVE_SPEED: 10,
} as const;

export const THREE_D_MAP_LIGHTING = {
	HEMISPHERE_SKY_COLOR: 0xffffff,
	HEMISPHERE_GROUND_COLOR: 0x8899aa,
	HEMISPHERE_INTENSITY_MULTIPLIER: 0.6,
	DIRECTIONAL_COLOR: 0xffffff,
	DIRECTIONAL_INTENSITY_MULTIPLIER: 1.15,
	DIRECTIONAL_POSITION_X_SCALE: -0.65,
	DIRECTIONAL_POSITION_Y_SCALE: 1.25,
	DIRECTIONAL_POSITION_Z_SCALE: 0.8,
} as const;

export const THREE_D_MAP_SHADOW = {
	MIN_CAMERA_HALF_SIZE: 4,
	CAMERA_HALF_SIZE_PADDING: 2,
	MIN_CAMERA_DEPTH: 40,
	CAMERA_DEPTH_EXTENT_MULTIPLIER: 3,
	CAMERA_DEPTH_ELEVATION_MULTIPLIER: 3,
	CAMERA_DEPTH_PADDING: 10,
	CAMERA_NEAR: 0.5,
	MAP_SIZE: 4096,
	PERFORMANCE_MAP_SIZE: 1024,
	BIAS: 0.000,
	NORMAL_BIAS: 0.01,
} as const;

export const THREE_D_SURROUNDINGS = {
	// Outer half-extent of the decorative surroundings ring, as a multiple of
	// the terrain's larger horizontal dimension.
	EXTENT_MULTIPLIER: 8,
	// Minimum outer half-extent in world units, so tiny terrains still get a
	// horizon-filling plane.
	MIN_EXTENT: 96,
	// Outward offset of the skirt so it never z-fights the terrain's side faces
	// at the footprint boundary.
	SKIRT_EPSILON: 0.002,
	// Width (world units) of the tessellated "detail band" around the terrain
	// footprint when the surroundings material deforms its surface (water
	// ripples, cloud puffs). Vertex displacement needs real vertices; beyond
	// the band the plane stays mega-quads with zero deform strength.
	DETAIL_MARGIN: 24,
	// Tessellation cell size (world units) inside the detail band and the
	// interior fill. Cuts are aligned to the global integer grid so vertices
	// on shared rectangle borders coincide exactly (no cracks under
	// displacement).
	DETAIL_CELL_SIZE: 1,
} as const;

export const THREE_D_MAP_CONTROLS = {
	DAMPING_FACTOR: 0.05,
	MIN_ZOOM: 0.2,
	// Max orthographic magnification (zoom-in limit). Higher = can zoom in closer.
	MAX_ZOOM: 20,
	MIN_PAN_LIMIT_RADIUS: 4,
	PAN_LIMIT_ELEVATION_SCALE: 0.5,
	PAN_LIMIT_PADDING: 2,
	// Perspective-mode dolly clamp, as multiples of the entry framing distance.
	// minZoom/maxZoom above only bound the ortho camera; these bound how far the
	// perspective camera can dolly in/out.
	PERSPECTIVE_MIN_DISTANCE_MULTIPLIER: 0.12,
	PERSPECTIVE_MAX_DISTANCE_MULTIPLIER: 4,
	// Adaptive orbit sensitivity, applied to BOTH orbit cameras: rotateSpeed
	// ramps from MIN (fully zoomed in) to MAX (at/beyond the default framing) so
	// rotation stays controllable up close instead of twitchy.
	ADAPTIVE_ROTATE_MIN_SPEED: 0.25,
	ADAPTIVE_ROTATE_MAX_SPEED: 1,
} as const;

export const THREE_D_TERRAIN_MATERIAL = {
	ROUGHNESS: 0.85,
	METALNESS: 0,
} as const;

export const THREE_D_MAP_BLOOM = {
	INTENSITY: 0.72,
	LUMINANCE_THRESHOLD: 1.05,
	LUMINANCE_SMOOTHING: 0.12,
	RADIUS: 0.45,
	LEVELS: 5,
	MULTISAMPLING: 4,
	PERFORMANCE_INTENSITY: 0.5,
	PERFORMANCE_LUMINANCE_THRESHOLD: 1.15,
	PERFORMANCE_LUMINANCE_SMOOTHING: 0.08,
	PERFORMANCE_RADIUS: 0.25,
	PERFORMANCE_LEVELS: 2,
	PERFORMANCE_MULTISAMPLING: 0,
} as const;

export const THREE_D_MAP_DOF = {
	// World-space half-width of the sharp band around the focus point (the
	// terrain center). Blur ramps up linearly beyond it. The actual range is
	// max(MIN_FOCUS_RANGE, largest terrain dimension * FOCUS_RANGE_MULTIPLIER)
	// so the playable area always stays in focus and only the distance blurs.
	FOCUS_RANGE_MULTIPLIER: 1.5,
	MIN_FOCUS_RANGE: 48,
	// Bokeh blur kernel scale; raise for a stronger distance blur.
	BOKEH_SCALE: 2.0,
	// CoC/bokeh buffers render at this fraction of full resolution.
	RESOLUTION_SCALE: 0.75,
	// Focus range used before the scene supplies real terrain extents. Huge on
	// purpose: it keeps the circle of confusion ~0 everywhere so an unfocused
	// scene (no terrain yet) renders sharp instead of fully blurred.
	UNFOCUSED_RANGE: 1e6,
} as const;

export const THREE_D_MOVEMENT_HIGHLIGHT = {
	FULL_RANGE_COLOR: 0xfa4398,
	REMAINING_RANGE_COLOR: 0x06b6d4,
	HOVER_COLOR: 0x2563eb,
	FULL_RANGE_OPACITY: 0.38,
	REMAINING_RANGE_OPACITY: 0.44,
	HOVER_OPACITY: 0.42,
	TILE_SIZE: 0.92,
	Y_OFFSET: 0.018,
	RENDER_ORDER: 80,
	HOVER_RENDER_ORDER: 82,
} as const;

export const THREE_D_STICKER_TEXTURE = {
	SIZE: 256,
	FONT_SIZE: 142,
	BACKDROP_RADIUS: 88,
	BACKDROP_INNER_COLOR: "rgba(15, 23, 42, 0.36)",
	BACKDROP_OUTER_COLOR: "rgba(15, 23, 42, 0)",
	SHADOW_COLOR: "rgba(0, 0, 0, 0.78)",
	SHADOW_BLUR: 16,
	SHADOW_OFFSET_Y: 5,
	FONT_FAMILY: "\"Segoe UI Emoji\", \"Apple Color Emoji\", \"Noto Color Emoji\", sans-serif",
} as const;

export const THREE_D_STICKER_PLACEMENT = {
	BASE_Y_GAP: 0.24,
	WORLD_SIZE_MULTIPLIER: 0.72,
	MIN_WORLD_SIZE: 0.52,
	MAX_WORLD_SIZE: 1.05,
	RENDER_ORDER: 160,
	BOB_HEIGHT: 0.045,
	BOB_SPEED: 4.2,
	POP_DURATION_MS: 180,
	POP_START_SCALE: 0.72,
} as const;

export const THREE_D_PING_MARKER = {
	COLOR: 0x22d3ee,
	ARROW_FILL: "#67e8f9",
	ARROW_STROKE: "#0e7490",
	TILE_Y_OFFSET: 0.018,
	ARROW_BASE_Y_OFFSET: 0.60,
	ARROW_BOUNCE_HEIGHT: 0.16,
	ARROW_BOUNCE_PERIOD_MS: 600,
	PULSE_PERIOD_MS: 700,
	PULSE_SCALE_MULTIPLIER: 0.25,
	FADE_HOLD_PROGRESS: 0.6,
	FILL_OPACITY: 0.18,
	OUTLINE_OPACITY: 0.85,
	OUTLINE_WIDTH: 0.08,
	RENDER_ORDER: 170,
	ARROW_TEXTURE_SIZE: 192,
	ARROW_FONT_SIZE: 136,
	ARROW_FONT_WEIGHT: 800,
	ARROW_FONT_FAMILY: "Inter, system-ui, sans-serif",
	ARROW_LINE_WIDTH: 12,
	ARROW_TEXT: "🡇",
	ARROW_TEXT_Y_OFFSET: 4,
	ARROW_WORLD_SIZE: 0.72,
} as const;

export const THREE_D_PING_INPUT = {
	CLICK_DRAG_THRESHOLD_PX: 5,
} as const;
