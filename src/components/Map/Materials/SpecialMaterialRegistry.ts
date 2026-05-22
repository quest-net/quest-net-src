// src/components/Map/Materials/SpecialMaterialRegistry.ts
//
// Registry for special voxel materials (palette indices 240-255).
//
// Construction is declarative: allMaterials.ts hands the full set of material
// definitions to the constructor, and the registry exposes:
//   - lookup by palette index
//   - editor metadata (name + placeholder colour)
//   - GLSL assembly (vertex + fragment per-slot dispatchers)
//
// The assembled GLSL is consumed by createSpecialMaterialsExtension (see
// terrainMaterial.ts), which feeds it into the single onBeforeCompile that
// createTerrainMaterial installs on the terrain MeshStandardMaterial.
//
// Slot numbering:  slot = paletteIndex - 239
//   e.g. index 240 -> slot 1, index 241 -> slot 2, ...
// Slot 0 means "no special material" (normal solid voxel) and is a no-op.

import type { SpecialMaterialDefinition } from './types';

export const SPECIAL_MATERIAL_SLOT_OFFSET = 239;
export const SPECIAL_MATERIAL_MIN_INDEX   = 240;
export const SPECIAL_MATERIAL_MAX_INDEX   = 255;

/**
 * Returns true if the given palette index is reserved for a special material
 * (regardless of whether one has been registered at that index).
 */
export function isSpecialMaterialIndex(index: number): boolean {
	return index >= SPECIAL_MATERIAL_MIN_INDEX && index <= SPECIAL_MATERIAL_MAX_INDEX;
}

/**
 * Converts a palette index to its shader-attribute slot value.
 * Returns 0 for non-special indices.
 */
export function paletteIndexToMaterialSlot(index: number): number {
	return isSpecialMaterialIndex(index) ? index - SPECIAL_MATERIAL_SLOT_OFFSET : 0;
}

export class SpecialMaterialRegistry {
	private readonly defs: Map<number, SpecialMaterialDefinition>;

	constructor(materials: ReadonlyArray<SpecialMaterialDefinition> = []) {
		this.defs = new Map();
		for (const material of materials) {
			if (!isSpecialMaterialIndex(material.paletteIndex)) {
				console.warn(
					`SpecialMaterialRegistry: paletteIndex ${material.paletteIndex} for "${material.name}" ` +
					`is outside reserved range ${SPECIAL_MATERIAL_MIN_INDEX}-${SPECIAL_MATERIAL_MAX_INDEX}`
				);
				continue;
			}
			if (this.defs.has(material.paletteIndex)) {
				console.warn(
					`SpecialMaterialRegistry: paletteIndex ${material.paletteIndex} is registered twice; ` +
					`the second definition ("${material.name}") will overwrite the first.`
				);
			}
			this.defs.set(material.paletteIndex, material);
		}
	}

	get all(): SpecialMaterialDefinition[] {
		return [...this.defs.values()];
	}

	hasAny(): boolean {
		return this.defs.size > 0;
	}

	get(paletteIndex: number): SpecialMaterialDefinition | undefined {
		return this.defs.get(paletteIndex);
	}

	/**
	 * Editor placeholder colour for a palette index in the reserved range.
	 * Returns null if no material is registered at that index (caller decides
	 * what to fall back to).
	 */
	getEditorColor(paletteIndex: number): string | null {
		return this.defs.get(paletteIndex)?.editorColor ?? null;
	}

	/**
	 * Assembles the GLSL declarations to inject into the vertex shader.
	 * Produces one displacement function per material that has vertexGLSL,
	 * plus a dispatcher:
	 *
	 *   void specialMaterialVertex_N(inout vec3 transformed, vec3 normal, float time) { ... }
	 *   void applySpecialMaterialVertex(float slot, inout vec3 transformed, vec3 normal, float time) { ... }
	 *
	 * Always returns a valid dispatcher stub even if no material has vertexGLSL,
	 * so the call site compiles unconditionally.
	 */
	buildVertexGLSL(): string {
		const functions: string[] = [];
		const dispatchLines: string[] = [];

		for (const def of this.defs.values()) {
			if (!def.vertexGLSL) continue;
			const slot = paletteIndexToMaterialSlot(def.paletteIndex);
			if (def.vertexHelperGLSL) {
				functions.push(def.vertexHelperGLSL);
			}
			functions.push(
				`void specialMaterialVertex_${slot}(inout vec3 transformed, vec3 normal, float time) {`,
				def.vertexGLSL,
				`}`
			);
			dispatchLines.push(
				`  if (abs(slot - ${slot}.0) < 0.5) { specialMaterialVertex_${slot}(transformed, normal, time); return; }`
			);
		}

		const dispatcher = [
			`void applySpecialMaterialVertex(float slot, inout vec3 transformed, vec3 normal, float time) {`,
			`  if (slot < 0.5) return;`,
			...dispatchLines,
			`}`,
		];

		return [...functions, ...dispatcher].join('\n');
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
			const slot = paletteIndexToMaterialSlot(def.paletteIndex);
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
