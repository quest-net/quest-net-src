// src/components/Map/Materials/types.ts
//
// Defines the contract for special voxel material definitions.
// Palette indices 240-255 are reserved for special materials.
// Each one registers a SpecialMaterialDefinition that provides:
//   - its palette index
//   - a placeholder hex color for the terrain editor
//   - GLSL that runs per-fragment for voxels painted with this material

export interface SpecialMaterialDefinition {
	/**
	 * Palette index this material occupies (240-255).
	 */
	paletteIndex: number;

	/**
	 * Human-readable name shown as a tooltip in the terrain editor.
	 * e.g. "Water", "Lava", "Grass"
	 */
	name: string;

	/**
	 * Hex color shown in the terrain editor for this palette slot.
	 * Kept simple so the editor stays fast (no animated shader there).
	 */
	editorColor: string;

	/**
	 * Optional top-level GLSL helper code injected before the material function.
	 * Use this for helper functions (noise, hash, fbm, etc.) that the main
	 * fragmentGLSL body calls. GLSL ES does not allow nested function definitions,
	 * so anything that needs its own function signature goes here.
	 *
	 * Name your helpers with a material-specific prefix (e.g. "water_") to avoid
	 * collisions with other materials' helpers.
	 */
	helperGLSL?: string;

	/**
	 * Optional top-level GLSL helper code injected into the vertex shader.
	 * Same rules as helperGLSL -- use a material-specific prefix.
	 */
	vertexHelperGLSL?: string;

	/**
	 * Optional GLSL snippet that runs in the vertex shader when this material's
	 * slot is active. Use it to displace vertices (e.g. wave deformation).
	 *
	 * The following are already declared and available:
	 *   inout vec3 transformed -- local-space vertex position; modify to displace
	 *   vec3  normal           -- local-space vertex normal (read-only)
	 *   float time             -- elapsed time in seconds
	 *
	 * Example (gentle bob on top faces only):
	 *   float isTop = step(0.5, normal.y);
	 *   transformed.y += sin(transformed.x + time) * 0.05 * isTop;
	 */
	vertexGLSL?: string;

	/**
	 * GLSL function body that runs when vVoxelMaterialSlot matches this slot.
	 *
	 * The following are already declared and available:
	 *   vec3  worldPos   -- world-space position of the fragment
	 *   vec3  normal     -- world-space unit normal of the face
	 *   float time       -- elapsed time in seconds
	 *   inout vec4 fragColor -- current fragment color; write here to override
	 *
	 * World-space UVs ensure seamless tiling across greedy-merged quads.
	 *
	 * Example (solid tint):
	 *   fragColor.rgb = vec3(0.1, 0.4, 0.9);
	 */
	fragmentGLSL: string;
}
