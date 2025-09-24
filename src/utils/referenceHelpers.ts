// src/utils/referenceHelpers.ts

import type { 
  GameState, 
  ItemReference, 
  SkillReference, 
  StatusEffectReference, 
  EntityReference,
  Item,
  Skill,
  StatusEffect,
  Entity,
  InventorySlot
} from '../types/game';

// =============================================================================
// CATALOG LOOKUP UTILITIES
// =============================================================================

/**
 * Get catalog item by ID - components use this to access display data
 */
export function getCatalogItem(catalogId: string, gameState: GameState): Item | null {
  return gameState.globalCollections.items.find(item => item.id === catalogId) || null;
}

/**
 * Get catalog skill by ID - components use this to access display data
 */
export function getCatalogSkill(catalogId: string, gameState: GameState): Skill | null {
  return gameState.globalCollections.skills.find(skill => skill.id === catalogId) || null;
}

/**
 * Get catalog status effect by ID - components use this to access display data
 */
export function getCatalogStatusEffect(catalogId: string, gameState: GameState): StatusEffect | null {
  return gameState.globalCollections.statusEffects.find(effect => effect.id === catalogId) || null;
}

/**
 * Get catalog entity by ID - components use this to access display data
 */
export function getCatalogEntity(catalogId: string, gameState: GameState): Entity | null {
  return gameState.globalCollections.entities.find(entity => entity.id === catalogId) || null;
}

// =============================================================================
// REFERENCE CREATION UTILITIES
// =============================================================================

/**
 * Create an item reference from a catalog item
 */
export function createItemReference(catalogId: string, usesLeft?: number): ItemReference {
  return {
    catalogId,
    usesLeft
  };
}

/**
 * Create a skill reference from a catalog skill
 */
export function createSkillReference(catalogId: string, usesLeft?: number): SkillReference {
  return {
    catalogId,
    usesLeft
  };
}

/**
 * Create a status effect reference
 */
export function createStatusEffectReference(catalogId: string, duration: number): StatusEffectReference {
  return {
    catalogId,
    duration
  };
}

/**
 * Create an entity reference from a catalog entity
 * ✅ FIXED: Now properly copies template's inventory/skills/statusEffects as new reference objects
 */
export function createEntityReference(catalogId: string, gameState: GameState): EntityReference | null {
  const catalogEntity = getCatalogEntity(catalogId, gameState);
  if (!catalogEntity) return null;

  // ✅ FIXED: Copy inventory as NEW ItemReference objects (not shared with template)
  const copiedInventory: InventorySlot[] = catalogEntity.inventory.map(([itemRef, count]) => [
    createItemReference(itemRef.catalogId, itemRef.usesLeft),
    count
  ]);

  // ✅ FIXED: Copy skills as NEW SkillReference objects (not shared with template)
  const copiedSkills: SkillReference[] = catalogEntity.skills.map(skillRef => 
    createSkillReference(skillRef.catalogId, skillRef.usesLeft)
  );

  // ✅ FIXED: Copy status effects as NEW StatusEffectReference objects (not shared with template)
  const copiedStatusEffects: StatusEffectReference[] = catalogEntity.statusEffects.map(effectRef =>
    createStatusEffectReference(effectRef.catalogId, effectRef.duration)
  );

  return {
    instanceId: crypto.randomUUID(), // Generate unique instance ID
    catalogId,
    hp: catalogEntity.hp,
    sp: catalogEntity.sp,
    inventory: copiedInventory, // ✅ FIXED: Copy template inventory as new references
    skills: copiedSkills, // ✅ FIXED: Copy template skills as new references
    statusEffects: copiedStatusEffects // ✅ FIXED: Copy template status effects as new references
  };
}

// =============================================================================
// REFERENCE VALIDATION UTILITIES
// =============================================================================

/**
 * Check if an item reference is valid (catalog item exists)
 */
export function isValidItemReference(itemRef: ItemReference, gameState: GameState): boolean {
  return getCatalogItem(itemRef.catalogId, gameState) !== null;
}

/**
 * Check if a skill reference is valid (catalog skill exists)
 */
export function isValidSkillReference(skillRef: SkillReference, gameState: GameState): boolean {
  return getCatalogSkill(skillRef.catalogId, gameState) !== null;
}

/**
 * Check if a status effect reference is valid (catalog effect exists)
 */
export function isValidStatusEffectReference(effectRef: StatusEffectReference, gameState: GameState): boolean {
  return getCatalogStatusEffect(effectRef.catalogId, gameState) !== null;
}

/**
 * Check if an entity reference is valid (catalog entity exists)
 */
export function isValidEntityReference(entityRef: EntityReference, gameState: GameState): boolean {
  return getCatalogEntity(entityRef.catalogId, gameState) !== null;
}

// =============================================================================
// REFERENCE NAME/PROPERTY ACCESS UTILITIES
// =============================================================================

/**
 * Get display name for an item reference
 */
export function getItemReferenceName(itemRef: ItemReference, gameState: GameState): string {
  const catalogItem = getCatalogItem(itemRef.catalogId, gameState);
  return catalogItem?.name || 'Unknown Item';
}

/**
 * Get display name for a skill reference
 */
export function getSkillReferenceName(skillRef: SkillReference, gameState: GameState): string {
  const catalogSkill = getCatalogSkill(skillRef.catalogId, gameState);
  return catalogSkill?.name || 'Unknown Skill';
}

/**
 * Get display name for a status effect reference
 */
export function getStatusEffectReferenceName(effectRef: StatusEffectReference, gameState: GameState): string {
  const catalogEffect = getCatalogStatusEffect(effectRef.catalogId, gameState);
  return catalogEffect?.name || 'Unknown Effect';
}

/**
 * Get display name for an entity reference
 */
export function getEntityReferenceName(entityRef: EntityReference, gameState: GameState): string {
  const catalogEntity = getCatalogEntity(entityRef.catalogId, gameState);
  return catalogEntity?.name || 'Unknown Entity';
}

/**
 * Check if an item reference is equippable
 */
export function isItemReferenceEquippable(itemRef: ItemReference, gameState: GameState): boolean {
  const catalogItem = getCatalogItem(itemRef.catalogId, gameState);
  return catalogItem?.isEquippable || false;
}

/**
 * Check if an item reference has uses
 */
export function itemReferenceHasUses(itemRef: ItemReference, gameState: GameState): boolean {
  const catalogItem = getCatalogItem(itemRef.catalogId, gameState);
  return catalogItem?.uses !== undefined;
}

/**
 * Get remaining uses for an item reference (handles infinite uses)
 */
export function getItemReferenceUsesLeft(itemRef: ItemReference, gameState: GameState): number | undefined {
  if (!itemReferenceHasUses(itemRef, gameState)) {
    return undefined; // Infinite uses
  }
  return itemRef.usesLeft;
}

/**
 * Check if a skill reference has uses
 */
export function skillReferenceHasUses(skillRef: SkillReference, gameState: GameState): boolean {
  const catalogSkill = getCatalogSkill(skillRef.catalogId, gameState);
  return catalogSkill?.uses !== undefined;
}

/**
 * Get remaining uses for a skill reference (handles infinite uses)
 */
export function getSkillReferenceUsesLeft(skillRef: SkillReference, gameState: GameState): number | undefined {
  if (!skillReferenceHasUses(skillRef, gameState)) {
    return undefined; // Infinite uses
  }
  return skillRef.usesLeft;
}

/**
 * Get skill damage from reference
 */
export function getSkillReferenceDamage(skillRef: SkillReference, gameState: GameState): number {
  const catalogSkill = getCatalogSkill(skillRef.catalogId, gameState);
  return catalogSkill?.damage || 0;
}

/**
 * Get skill SP cost from reference
 */
export function getSkillReferenceSPCost(skillRef: SkillReference, gameState: GameState): number {
  const catalogSkill = getCatalogSkill(skillRef.catalogId, gameState);
  return catalogSkill?.spCost || 0;
}

// =============================================================================
// REFERENCE MODIFICATION UTILITIES
// =============================================================================

/**
 * Use an item (decrement uses if applicable)
 */
export function useItemReference(itemRef: ItemReference, gameState: GameState): ItemReference | null {
  if (!itemReferenceHasUses(itemRef, gameState)) {
    return itemRef; // Infinite uses, no change
  }

  const usesLeft = itemRef.usesLeft || 0;
  if (usesLeft <= 0) {
    return null; // Item is depleted
  }

  return {
    ...itemRef,
    usesLeft: usesLeft - 1
  };
}

/**
 * Use a skill (decrement uses if applicable)
 */
export function useSkillReference(skillRef: SkillReference, gameState: GameState): SkillReference | null {
  if (!skillReferenceHasUses(skillRef, gameState)) {
    return skillRef; // Infinite uses, no change
  }

  const usesLeft = skillRef.usesLeft || 0;
  if (usesLeft <= 0) {
    return null; // Skill is depleted
  }

  return {
    ...skillRef,
    usesLeft: usesLeft - 1
  };
}

/**
 * Advance status effect (decrement duration)
 */
export function advanceStatusEffectReference(effectRef: StatusEffectReference): StatusEffectReference | null {
  const newDuration = effectRef.duration - 1;
  if (newDuration <= 0) {
    return null; // Effect has expired
  }

  return {
    ...effectRef,
    duration: newDuration
  };
}

/**
 * Restore item uses to maximum
 */
export function restoreItemReferenceUses(itemRef: ItemReference, gameState: GameState): ItemReference {
  const catalogItem = getCatalogItem(itemRef.catalogId, gameState);
  if (!catalogItem?.uses) {
    return itemRef; // Infinite uses, no change needed
  }

  return {
    ...itemRef,
    usesLeft: catalogItem.uses
  };
}

/**
 * Restore skill uses to maximum
 */
export function restoreSkillReferenceUses(skillRef: SkillReference, gameState: GameState): SkillReference {
  const catalogSkill = getCatalogSkill(skillRef.catalogId, gameState);
  if (!catalogSkill?.uses) {
    return skillRef; // Infinite uses, no change needed
  }

  return {
    ...skillRef,
    usesLeft: catalogSkill.uses
  };
}

// =============================================================================
// BATCH UTILITIES
// =============================================================================

/**
 * Filter out invalid references from an array
 */
export function filterValidItemReferences(itemRefs: ItemReference[], gameState: GameState): ItemReference[] {
  return itemRefs.filter(ref => isValidItemReference(ref, gameState));
}

/**
 * Filter out invalid skill references from an array
 */
export function filterValidSkillReferences(skillRefs: SkillReference[], gameState: GameState): SkillReference[] {
  return skillRefs.filter(ref => isValidSkillReference(ref, gameState));
}

/**
 * Filter out invalid status effect references from an array
 */
export function filterValidStatusEffectReferences(effectRefs: StatusEffectReference[], gameState: GameState): StatusEffectReference[] {
  return effectRefs.filter(ref => isValidStatusEffectReference(ref, gameState));
}