// src/hooks/useReferenceResolver.ts

import { useMemo } from 'react';
import type { GameState, ItemReference, SkillReference, StatusEffectReference, EntityReference } from '../types/game';
import { getCatalogItem, getCatalogSkill, getCatalogStatusEffect, getCatalogEntity } from '../utils/referenceHelpers';

/**
 * Hook to get catalog item for an item reference
 */
export function useCatalogItem(itemRef: ItemReference, gameState: GameState) {
  return useMemo(() => 
    getCatalogItem(itemRef.catalogId, gameState),
    [itemRef.catalogId, gameState.globalCollections.items]
  );
}

/**
 * Hook to get catalog skill for a skill reference
 */
export function useCatalogSkill(skillRef: SkillReference, gameState: GameState) {
  return useMemo(() => 
    getCatalogSkill(skillRef.catalogId, gameState),
    [skillRef.catalogId, gameState.globalCollections.skills]
  );
}

/**
 * Hook to get catalog status effect for a status effect reference
 */
export function useCatalogStatusEffect(effectRef: StatusEffectReference, gameState: GameState) {
  return useMemo(() => 
    getCatalogStatusEffect(effectRef.catalogId, gameState),
    [effectRef.catalogId, gameState.globalCollections.statusEffects]
  );
}

/**
 * Hook to get catalog entity for an entity reference
 */
export function useCatalogEntity(entityRef: EntityReference, gameState: GameState) {
  return useMemo(() => 
    getCatalogEntity(entityRef.catalogId, gameState),
    [entityRef.catalogId, gameState.globalCollections.entities]
  );
}

/**
 * Hook to create lookup maps for efficient batch operations
 */
export function useCatalogMaps(gameState: GameState) {
  return useMemo(() => ({
    items: new Map(gameState.globalCollections.items.map(item => [item.id, item])),
    skills: new Map(gameState.globalCollections.skills.map(skill => [skill.id, skill])),
    statusEffects: new Map(gameState.globalCollections.statusEffects.map(effect => [effect.id, effect])),
    entities: new Map(gameState.globalCollections.entities.map(entity => [entity.id, entity]))
  }), [
    gameState.globalCollections.items,
    gameState.globalCollections.skills,
    gameState.globalCollections.statusEffects,
    gameState.globalCollections.entities
  ]);
}