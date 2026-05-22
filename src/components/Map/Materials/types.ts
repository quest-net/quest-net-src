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
