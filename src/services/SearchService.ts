import { GameState } from "../types/game";

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
      location: { type: 'characters' }, // Using 'characters' to indicate they're in the party
      tags: character.tags
    });

    // Add inventory items
    character.inventory.forEach(([item]) => {
      newIndex.push({
        id: item.id,
        name: item.name,
        type: 'item',
        location: {
          type: 'inventory',
          containerId: character.id,
          containerName: character.name
        },
        tags: item.tags
      });
    });

    // Add equipped items
    character.equipment.forEach(item => {
      newIndex.push({
        id: item.id,
        name: item.name,
        type: 'item',
        location: {
          type: 'equipment',
          containerId: character.id,
          containerName: character.name
        },
        tags: item.tags
      });
    });

    // Add character skills
    character.skills.forEach(skill => {
      newIndex.push({
        id: skill.id,
        name: skill.name,
        type: 'skill',
        location: {
          type: 'skills',
          containerId: character.id,
          containerName: character.name
        },
        tags: skill.tags
      });
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

  // Add entities from catalog and field
  gameState.globalCollections.entities.forEach(entity => {
    newIndex.push({
      id: entity.id,
      name: entity.name,
      type: 'entity',
      location: { type: 'encounters' },
      tags: entity.tags
    });
  });

  gameState.field.forEach(entity => {
    newIndex.push({
      id: entity.id,
      name: entity.name,
      type: 'entity',
      location: { type: 'field' },
      tags: entity.tags
    });
  });

  // Add audio tracks
  gameState.audio.playlist.forEach(track => {
    if (track.id !== 'silence') { // Don't include the silence track in search
      newIndex.push({
        id: track.id,
        name: track.name,
        type: 'audio',
        location: { type: 'audio' },
        tags: [] // Audio tracks don't currently have tags, but we could add them
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
      return; // Skip tag matching if we found a direct name match
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
        objects: objects.slice(0, 3) // Limit objects per tag group
      }))
      .sort((a, b) => a.tag.localeCompare(b.tag))
  ];

  return results;
}

public getResultDisplayText(result: SearchResult | TagGroup): string {
  if ('tag' in result) {
    // It's a tag group
    return `${result.tag} (${result.objects.length} items)`;
  } else {
    // It's a direct match
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