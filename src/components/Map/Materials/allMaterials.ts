// src/components/Map/Materials/allMaterials.ts
//
// Single import point for all special material definitions.
// Both 3DMap.tsx and the terrain editor import from here so the registry
// is always fully populated regardless of which component loads first.
//
// To add a new material: create its folder/index.ts, then add it below.

export { SPECIAL_MATERIAL_REGISTRY } from './SpecialMaterialRegistry';

import './water_240/index';
