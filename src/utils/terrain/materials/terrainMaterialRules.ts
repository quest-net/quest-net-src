// src/utils/terrain/materials/terrainMaterialRules.ts
//
// Pure, zero-dependency data-layer material rules. The rendering layer
// (components/Map/Terrain/materials/index.ts) pushes its derived rule sets
// down here via registerTerrainMaterialRules() at module load. The data layer
// (VoxelTerrainIndex, VoxelTerrainEditorUtils) reads from here instead of
// importing upward into the rendering layer.
//
// Safe defaults before registration: non-passable, no special colors. A
// startup side-effect import of the materials index in index.tsx guarantees
// registration happens before any terrain query runs.

interface TerrainMaterialRules {
	readonly passableIndices: ReadonlySet<number>;
	readonly editorColors: ReadonlyMap<number, number>;
}

let rules: TerrainMaterialRules = {
	passableIndices: new Set(),
	editorColors: new Map(),
};

export function registerTerrainMaterialRules(r: TerrainMaterialRules): void {
	rules = r;
}

export function isPassableMaterial(colorIndex: number): boolean {
	return rules.passableIndices.has(colorIndex);
}

/**
 * Editor render color for a special palette index, as a 0xRRGGBB number, or
 * undefined if the index is not claimed by any registered special material.
 */
export function getSpecialMaterialEditorColor(paletteIndex: number): number | undefined {
	return rules.editorColors.get(paletteIndex);
}
