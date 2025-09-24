// src/services/SearchService.ts

import { GameState } from "../types/game";
import { getCatalogItem, getCatalogSkill, getCatalogEntity } from "../utils/referenceHelpers";

interface SearchableObject {
  id: string;
  name: string;
  type: 'item' | 'skill' | 'character' | 'entity' | 'image' | 'audio';
  location: {
    type: 'characters' | 'catalog' | 'inventory' | 'equipment' | 'skills' | 'field' | 'visuals' | 'encounters' | 'audio';
    containerId?: string;
    containerName?: string;
  };
  tags?: string[];
}

interface TagGroup {
  tag: string;
  objects: SearchableObject[];
}

interface SearchResult {
  type: 'direct' | 'tag';
  matchedTag?: string;
  object: SearchableObject;
  score: number;
}

class SearchService {
  private searchIndex: SearchableObject[] = [];

  public updateIndex(gameState: GameState): void {
    const newIndex: SearchableObject[] = [];
    
    // Add characters
    gameState.party.forEach(character => {
      newIndex.push({
        id: character.id,
        name: character.name,
        type: 'character',
        location: { type: 'characters' },
        tags: character.tags
      });

      // Add inventory items (now references)
      character.inventory.forEach(([itemRef]) => {
        const catalogItem = getCatalogItem(itemRef.catalogId, gameState);
        if (catalogItem) {
          newIndex.push({
            id: catalogItem.id,
            name: catalogItem.name,
            type: 'item',
            location: {
              type: 'inventory',
              containerId: character.id,
              containerName: character.name
            },
            tags: catalogItem.tags
          });
        }
      });

      // Add equipped items (now references)
      character.equipment.forEach(itemRef => {
        const catalogItem = getCatalogItem(itemRef.catalogId, gameState);
        if (catalogItem) {
          newIndex.push({
            id: catalogItem.id,
            name: catalogItem.name,
            type: 'item',
            location: {
              type: 'equipment',
              containerId: character.id,
              containerName: character.name
            },
            tags: catalogItem.tags
          });
        }
      });

      // Add character skills (now references)
      character.skills.forEach(skillRef => {
        const catalogSkill = getCatalogSkill(skillRef.catalogId, gameState);
        if (catalogSkill) {
          newIndex.push({
            id: catalogSkill.id,
            name: catalogSkill.name,
            type: 'skill',
            location: {
              type: 'skills',
              containerId: character.id,
              containerName: character.name
            },
            tags: catalogSkill.tags
          });
        }
      });
    });

    // Add items from global catalog
    gameState.globalCollections.items.forEach(item => {
      newIndex.push({
        id: item.id,
        name: item.name,
        type: 'item',
        location: { type: 'catalog' },
        tags: item.tags
      });
    });

    // Add skills from global catalog
    gameState.globalCollections.skills.forEach(skill => {
      newIndex.push({
        id: skill.id,
        name: skill.name,
        type: 'skill',
        location: { type: 'catalog' },
        tags: skill.tags
      });
    });

    // Add images
    gameState.globalCollections.images.forEach(image => {
      newIndex.push({
        id: image.id,
        name: image.name,
        type: 'image',
        location: { type: 'visuals' },
        tags: image.tags
      });
    });

    // Add entities from catalog
    gameState.globalCollections.entities.forEach(entity => {
      newIndex.push({
        id: entity.id,
        name: entity.name,
        type: 'entity',
        location: { type: 'encounters' },
        tags: entity.tags
      });
    });

    // Add field entities (now references) - FIXED
    gameState.field.forEach(entityRef => {
      const catalogEntity = getCatalogEntity(entityRef.catalogId, gameState);
      if (catalogEntity) {
        // ✅ FIXED: Use instanceId for field entities, not catalog ID
        // Also use dynamic name generation to match what's displayed
        const sameTypeInstances = gameState.field.filter(e => e.catalogId === entityRef.catalogId);
        const currentIndex = sameTypeInstances.findIndex(e => e.instanceId === entityRef.instanceId);
        const displayName = sameTypeInstances.length === 1 
          ? catalogEntity.name 
          : `${catalogEntity.name} #${currentIndex + 1}`;

        newIndex.push({
          id: entityRef.instanceId,  // ✅ FIXED: Use instanceId so NavigationManager can find it
          name: displayName,         // ✅ FIXED: Use dynamic name that matches display
          type: 'entity',
          location: { type: 'field' },
          tags: catalogEntity.tags
        });
      }
    });

    // Add audio tracks
    gameState.audio.playlist.forEach(track => {
      if (track.id !== 'silence') {
        newIndex.push({
          id: track.id,
          name: track.name,
          type: 'audio',
          location: { type: 'audio' },
          tags: []
        });
      }
    });

    this.searchIndex = newIndex;
  }

  public search(query: string, limit: number = 10): (SearchResult | TagGroup)[] {
    if (!query) return [];
    
    query = query.toLowerCase();
    const directMatches: SearchResult[] = [];
    const tagMatches = new Map<string, SearchableObject[]>();

    // Search through index
    this.searchIndex.forEach(obj => {
      // Direct name match
      if (obj.name.toLowerCase().includes(query)) {
        directMatches.push({
          type: 'direct',
          object: obj,
          score: obj.name.toLowerCase().startsWith(query) ? 2 : 1
        });
        return;
      }

      // Tag matching
      obj.tags?.forEach(tag => {
        if (tag.toLowerCase().includes(query)) {
          const existingGroup = tagMatches.get(tag);
          if (existingGroup) {
            existingGroup.push(obj);
          } else {
            tagMatches.set(tag, [obj]);
          }
        }
      });
    });

    // Combine results with tag groups
    const results: (SearchResult | TagGroup)[] = [
      // First, add direct matches
      ...directMatches
        .sort((a, b) => b.score - a.score)
        .slice(0, limit),

      // Then, add tag groups
      ...Array.from(tagMatches.entries())
        .map(([tag, objects]) => ({
          tag,
          objects: objects.slice(0, 3)
        }))
        .sort((a, b) => a.tag.localeCompare(b.tag))
    ];

    return results;
  }

  public getResultDisplayText(result: SearchResult | TagGroup): string {
    if ('tag' in result) {
      return `${result.tag} (${result.objects.length} items)`;
    } else {
      const obj = result.object;
      const locationText = obj.location.containerName
        ? `in ${obj.location.containerName}'s ${obj.location.type}`
        : `in ${obj.location.type}`;

      return `${obj.name} (${obj.type}) ${locationText}`;
    }
  }
}

export const searchService = new SearchService();
export type { SearchResult, TagGroup };