// src/components/Map/Materials/allMaterials.ts
//
// Single declarative listing of every special voxel material in the game.
// To add a new material:
//   1. Create its folder (e.g. grass_241/) with an index.ts that exports a
//      SpecialMaterialDefinition.
//   2. Import it here and add it to ALL_SPECIAL_MATERIALS.
//
// No side-effect imports: the registry is constructed once with the full list,
// and everything else (terrain editor, geometry slot encoding, shader
// extension) reads from the same singleton.

import { SpecialMaterialRegistry } from './SpecialMaterialRegistry';
import type { SpecialMaterialDefinition } from './types';
import { WATER_MATERIAL } from './water_240';

export const ALL_SPECIAL_MATERIALS: ReadonlyArray<SpecialMaterialDefinition> = [
	WATER_MATERIAL,
];

export const SPECIAL_MATERIAL_REGISTRY = new SpecialMaterialRegistry(ALL_SPECIAL_MATERIALS);

export {
	SPECIAL_MATERIAL_MIN_INDEX,
	SPECIAL_MATERIAL_MAX_INDEX,
	SPECIAL_MATERIAL_SLOT_OFFSET,
	isSpecialMaterialIndex,
	paletteIndexToMaterialSlot,
} from './SpecialMaterialRegistry';
