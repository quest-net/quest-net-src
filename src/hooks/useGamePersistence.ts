import { useCallback, useEffect, useState } from 'react';
import type { GameState, SaveState, SavedRoomInfo, GameImage } from '../types/game';
import { initialGameState } from '../types/game';
import { selfId } from 'trystero';
import { imageManager } from '../services/ImageManager';

// Type for image data in transit
interface TransitGameImage extends GameImage {
  data?: string; // Base64 or data URL of the image
}

interface TransitGameState extends GameState {
  globalCollections: {
    items: GameState['globalCollections']['items'];
    skills: GameState['globalCollections']['skills'];
    statusEffects: GameState['globalCollections']['statusEffects'];
    images: TransitGameImage[];
    entities: GameState['globalCollections']['entities'];
  };
}

// Helper function to clean images from gamestate
const stripImageData = (gameState: GameState): GameState => {
  return {
    ...gameState,
    party: gameState.party.map(character => ({
      ...character,
      // Keep image ID but remove actual image data
      image: character.image?.startsWith('data:') ? undefined : character.image
    })),
    globalCollections: {
      ...gameState.globalCollections,
      // Only include essential image metadata
      images: gameState.globalCollections.images.map(img => ({
        id: img.id,
        name: img.name,
        description: img.description,
        createdAt: img.createdAt,
        hash: img.hash,
        size: img.size,
        type: img.type,
        tags: img.tags,
        thumbnail: img.thumbnail // Keep the thumbnail as it's required
      }))
    }
  };
};

// Helper function to process incoming gamestate
const processIncomingGameState = async (gameState: TransitGameState): Promise<GameState> => {
  const processedState = { ...gameState };
  
  // Process character images
  for (const character of processedState.party) {
    if (character.image?.startsWith('data:')) {
      try {
        // Convert data URL to File
        const response = await fetch(character.image);
        const blob = await response.blob();
        const file = new File([blob], `character-${character.id}.png`, {
          type: 'image/png'
        });

        // Store in ImageManager
        const imageData = await imageManager.addImage(file,'character');
        // Replace data URL with image ID
        character.image = imageData.id;
      } catch (error) {
        console.error('Failed to process character image:', error);
        character.image = undefined;
      }
    }
  }

  // Process global collection images
  const processedImages: GameImage[] = [];
for (const image of processedState.globalCollections.images) {
  if (image.data && typeof image.data === 'string') {
    try {
      // Convert data URL to File
      const response = await fetch(image.data);
      const blob = await response.blob();
      const file = new File([blob], image.name, {
        type: image.type
      });

      // Determine the category based on image usage
      let category: 'item' | 'skill' | 'character' | 'entity' | 'gallery' = 'gallery';
      
      // Check items first
      if (processedState.globalCollections.items.some(item => item.image === image.id)) {
        category = 'item';
      }
      // Then check skills
      else if (processedState.globalCollections.skills.some(skill => skill.image === image.id)) {
        category = 'skill';
      }
      // Check entities
      else if ([...processedState.globalCollections.entities, ...processedState.field]
          .some(entity => entity.image === image.id)) {
        category = 'entity';
      }
      // Check if it's an environment image
      else if (processedState.display.environmentImageId === image.id || 
               processedState.display.focusImageId === image.id) {
        category = 'gallery';
      }

      // Store in ImageManager with correct category
      const storedImage = await imageManager.addImage(file, category);
      processedImages.push(storedImage);
    } catch (error) {
      console.error('Failed to process collection image:', error);
    }
  } else {
    // Include the image as-is if it doesn't have embedded data
    processedImages.push(image);
  }
}

  processedState.globalCollections.images = processedImages;
  return processedState as GameState;
};

export function useGamePersistence(roomId: string, isRoomCreator: boolean) {
  const [savedRooms, setSavedRooms] = useState<SavedRoomInfo[]>([]);

  const loadSavedRooms = useCallback(() => {
    const rooms: SavedRoomInfo[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('gameState_')) {
        const roomIdFromKey = key.replace('gameState_', '');
        if (roomIdFromKey === roomId) {
          try {
            const savedState = JSON.parse(localStorage.getItem(key) || '') as SaveState;
            rooms.push({
              roomId: roomIdFromKey,
              lastModified: new Date(savedState.lastModified),
              gameState: savedState.gameState,
            });
          } catch (error) {
            console.error('Failed to parse saved state:', error);
          }
        }
      }
    }
    setSavedRooms(rooms);
  }, [roomId]);

  const loadGameState = useCallback(async () => {
    if (roomId && isRoomCreator) {
      const savedState = localStorage.getItem(`gameState_${roomId}`);
      if (savedState) {
        try {
          const parsed = JSON.parse(savedState) as SaveState;
          
          // Process any embedded images in the loaded state
          const processedState = await processIncomingGameState(parsed.gameState as TransitGameState);
          
          // Clean up any lingering player assignments
          const cleanedGameState = {
            ...processedState,
            party: processedState.party.map(char => ({
              ...char,
              playerId: undefined // Clear all player assignments when loading
            }))
          };
          
          return cleanedGameState;
        } catch (error) {
          console.error('Failed to parse saved state:', error);
        }
      }
    }
    return initialGameState;
  }, [roomId, isRoomCreator]);

  const saveGameState = useCallback((gameState: GameState) => {
    if (isRoomCreator && roomId) {
      // Clean the game state before saving
      const cleanGameState = stripImageData({
        ...gameState,
        party: gameState.party.map(char => ({
          ...char,
          playerId: undefined // Clear all player assignments when saving
        }))
      });
      
      const saveState: SaveState = {
        gameState: cleanGameState,
        lastModified: Date.now(),
        roomCreator: selfId
      };
      
      localStorage.setItem(`gameState_${roomId}`, JSON.stringify(saveState));
      loadSavedRooms();
    }
  }, [isRoomCreator, roomId, loadSavedRooms]);

  const deleteSavedRoom = useCallback((roomId: string) => {
    localStorage.removeItem(`gameState_${roomId}`);
    loadSavedRooms();
  }, [loadSavedRooms]);

  useEffect(() => {
    loadSavedRooms();
  }, [loadSavedRooms]);

  return {
    savedRooms,
    loadGameState,
    saveGameState,
    deleteSavedRoom
  };
}