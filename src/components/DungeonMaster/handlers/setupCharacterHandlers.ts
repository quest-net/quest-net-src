// src/components/DungeonMaster/handlers/setupCharacterHandlers.ts

import type { Room } from 'trystero/nostr';
import type { Character, GameState } from '../../../types/game';
import { imageManager } from '../../../services/ImageManager';

// These must be 12 bytes or less for Trystero
export const CharacterActions = {
  CREATE: 'charCreate',
  UPDATE: 'charUpdate',
  DELETE: 'charDelete',
  SELECT: 'charSelect'
} as const;

interface CharacterImageData {
  data: string;
  originalId: string;
  thumbnail: string;
  metadata: {
    name: string;
    type: string;
    size: number;
  };
}

interface CharacterCreatePayload {
  character: Omit<Character, 'id'>;
  imageData?: CharacterImageData;
  playerId: string;
}

interface CharacterUpdatePayload {
  id: string;
  updates: Partial<Character>;
  imageData?: CharacterImageData;
  playerId: string;
}

interface CharacterDeletePayload {
  id: string;
  playerId: string;
}

interface CharacterSelectPayload {
  characterId: string;
  playerId: string;
}

export function setupCharacterHandlers(
  room: Room,
  gameState: GameState,
  onGameStateChange: (newState: GameState) => void
) {
  const processImageData = async (imageData?: CharacterImageData): Promise<string | undefined> => {
    if (!imageData) return undefined;

    try {
      // Convert base64 to blob
      const response = await fetch(imageData.data);
      const blob = await response.blob();
      
      // Create file from blob
      const file = new File([blob], imageData.metadata.name, {
        type: imageData.metadata.type
      });

      // Store in ImageManager with original ID
      await imageManager.addReceivedImage(file, {
        id: imageData.originalId,
        name: imageData.metadata.name,
        description: `Character image`,
        createdAt: Date.now(),
        size: imageData.metadata.size,
        type: imageData.metadata.type,
        thumbnail: imageData.thumbnail
      }, "character");

      return imageData.originalId;
    } catch (error) {
      console.error('Failed to process character image:', error);
      return undefined;
    }
  };

  // Handle character creation requests from players
  const [_, getCharCreate] = room.makeAction<CharacterCreatePayload>(CharacterActions.CREATE);
  getCharCreate(async ({ character, imageData, playerId }) => {
    console.log(`DM received character creation request from ${playerId}:`, character);
    
    // Process image if present
    const imageId = await processImageData(imageData);
    
    const newId = crypto.randomUUID();
    const newCharacter = { 
      ...character, 
      id: newId,
      image: imageId // Use processed image ID
    };
    
    onGameStateChange({
      ...gameState,
      party: [...gameState.party, newCharacter]
    });
  });

  // Handle character update requests
  const [__, getCharUpdate] = room.makeAction<CharacterUpdatePayload>(CharacterActions.UPDATE);
  getCharUpdate(async ({ id, updates, imageData, playerId }) => {
    console.log(`DM received character update request from ${playerId} for character ${id}:`, updates);
    
    // Process new image if present
    const imageId = await processImageData(imageData);
    
    onGameStateChange({
      ...gameState,
      party: gameState.party.map(char =>
        char.id === id ? { 
          ...char, 
          ...updates,
          image: imageId || updates.image || char.image // Use new image ID if processed
        } : char
      )
    });
  });

  // Handle character deletion requests
  const [___, getCharDelete] = room.makeAction<CharacterDeletePayload>(CharacterActions.DELETE);
  getCharDelete(({ id, playerId }) => {
    console.log(`DM received character deletion request from ${playerId} for character ${id}`);
    
    // Find character to get image ID
    const character = gameState.party.find(char => char.id === id);
    if (character?.image) {
      // Clean up image from storage
      imageManager.deleteImage(character.image).catch(error => {
        console.error('Failed to delete character image:', error);
      });
    }
    
    onGameStateChange({
      ...gameState,
      party: gameState.party.filter(char => char.id !== id)
    });
  });

  // Handle character selection
  const [____, getCharSelect] = room.makeAction<CharacterSelectPayload>(CharacterActions.SELECT);
  getCharSelect(({ characterId, playerId }) => {
    console.log(`DM received character selection request from ${playerId} for character ${characterId}`);
    onGameStateChange({
      ...gameState,
      party: gameState.party.map(char =>
        char.id === characterId
          ? { ...char, playerId }
          : char.playerId === playerId
          ? { ...char, playerId: undefined }
          : char
      )
    });
  });
}