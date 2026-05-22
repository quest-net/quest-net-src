// src/components/Map/Materials/SpecialMaterialRegistry.ts
//
// Registry for special voxel materials (palette indices 240-255).
//
// Each material registers itself by importing this module and calling
// SPECIAL_MATERIAL_REGISTRY.register(def).  The registry is then consumed
// by installTerrainShaderExtensions in 3DMap.tsx, which:
//   - injects per-material GLSL functions and a slot dispatcher into the
//     terrain MeshStandardMaterial via onBeforeCompile
//   - keeps a uTime uniform that is updated every animation frame
//
// Slot numbering:  slot = paletteIndex - 239
//   e.g. index 240 -> slot 1, index 241 -> slot 2, ...
// Slot 0 means "no special material" (normal solid voxel) and is a no-op.

import type { SpecialMaterialDefinition } from './types';

export const SPECIAL_MATERIAL_SLOT_OFFSET = 239;
export const SPECIAL_MATERIAL_MIN_INDEX   = 240;
export const SPECIAL_MATERIAL_MAX_INDEX   = 255;

class SpecialMaterialRegistry {
	private readonly defs: Map<number, SpecialMaterialDefinition> = new Map();

	/**
	 * Register a special material definition.
	 * Call this once per material at module load time (e.g. in water_240/index.ts).
	 */
	register(def: SpecialMaterialDefinition): void {
		if (def.paletteIndex < SPECIAL_MATERIAL_MIN_INDEX || def.paletteIndex > SPECIAL_MATERIAL_MAX_INDEX) {
			console.warn(`SpecialMaterialRegistry: paletteIndex ${def.paletteIndex} is outside reserved range 240-255`);
			return;
		}
		this.defs.set(def.paletteIndex, def);
	}

	get all(): SpecialMaterialDefinition[] {
		return [...this.defs.values()];
	}

	hasAny(): boolean {
		return this.defs.size > 0;
	}

	/**
	 * Returns the slot number for a given palette index.
	 * Slot 0 = normal solid voxel (no special material).
	 */
	getSlot(paletteIndex: number): number {
		if (paletteIndex >= SPECIAL_MATERIAL_MIN_INDEX && paletteIndex <= SPECIAL_MATERIAL_MAX_INDEX) {
			return paletteIndex - SPECIAL_MATERIAL_SLOT_OFFSET;
		}
		return 0;
	}

	/**
	 * Assembles the GLSL declarations to inject into the fragment shader.
	 * Produces one function per registered material, plus a dispatcher:
	 *
	 *   void specialMaterial_N(vec3 worldPos, vec3 normal, float time, inout vec4 fragColor) { ... }
	 *   ...
	 *   void applySpecialMaterial(float slot, vec3 worldPos, vec3 normal, float time, inout vec4 fragColor) { ... }
	 *
	 * If no materials are registered, returns an empty-dispatcher stub so the
	 * call site in the shader compiles without changes.
	 */
	buildFragmentGLSL(): string {
		const functions: string[] = [];
		const dispatchLines: string[] = [];

		for (const def of this.defs.values()) {
			const slot = this.getSlot(def.paletteIndex);
			if (def.helperGLSL) {
				functions.push(def.helperGLSL);
			}
			functions.push(
				`void specialMaterial_${slot}(vec3 worldPos, vec3 normal, float time, inout vec4 fragColor) {`,
				def.fragmentGLSL,
				`}`
			);
			dispatchLines.push(
				`  if (abs(slot - ${slot}.0) < 0.5) { specialMaterial_${slot}(worldPos, normal, time, fragColor); return; }`
			);
		}

		const dispatcher = [
			`void applySpecialMaterial(float slot, vec3 worldPos, vec3 normal, float time, inout vec4 fragColor) {`,
			`  if (slot < 0.5) return;`,
			...dispatchLines,
			`}`,
		];

		return [...functions, ...dispatcher].join('\n');
	}
}

export const SPECIAL_MATERIAL_REGISTRY = new SpecialMaterialRegistry();
