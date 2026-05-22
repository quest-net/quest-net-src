// src/components/Map/Materials/types.ts
//
// Two contracts:
//   - SpecialMaterialDefinition: what a single special voxel material declares
//     (palette index, editor swatch colour, and the GLSL it contributes to
//     the per-slot dispatcher inside the terrain fragment shader).
//   - TerrainShaderExtension: what an extension contributes to the single
//     onBeforeCompile that createTerrainMaterial installs. Multiple extensions
//     can layer (special materials, movement highlight, future overlays), all
//     sharing the world-space varyings the composer provides.

import type * as THREE from 'three';

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

/**
 * One layer of GLSL injected into the terrain material's onBeforeCompile.
 *
 * The composer (createTerrainMaterial) always provides two world-space varyings
 * any extension can read:
 *   varying vec3 vTerrainWorldPos;    // world-space position of the fragment
 *   varying vec3 vTerrainWorldNormal; // world-space unit normal of the face
 *
 * Header snippets are inserted immediately after `#include <common>` in their
 * respective stages, so they can declare uniforms, attributes, varyings, and
 * top-level helper functions.
 *
 * Body snippets are inserted at:
 *   - vertex:   right after `#include <begin_vertex>` (operate on `transformed`)
 *   - fragment: right before `#include <dithering_fragment>` (operate on
 *               `gl_FragColor`); extensions earlier in the array run first.
 */
export interface TerrainShaderExtension {
	uniforms?: Record<string, THREE.IUniform>;
	vertexHeaderGLSL?: string;
	vertexBodyGLSL?: string;
	fragmentHeaderGLSL?: string;
	fragmentBodyGLSL?: string;
	/**
	 * Optional per-frame hook. Called once per animation frame with the current
	 * timestamp (ms). Use for ticking time-based uniforms (e.g. water animation).
	 */
	tickTime?: (now: number) => void;
}
