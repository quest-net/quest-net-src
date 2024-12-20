// src/actions/characterActions.ts

import type { Room } from 'trystero/nostr';
import type { Character, GameState } from '../types/game';
import { selfId } from 'trystero';
import { CharacterActions } from '../components/DungeonMaster/handlers/setupCharacterHandlers';
import { imageManager } from '../services/ImageManager';

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

async function prepareImageData(imageId: string): Promise<CharacterImageData | undefined> {
  try {
    // Get image file and data
    const file = await imageManager.getImage(imageId);
    const imageData = await imageManager.getImageData(imageId);
    
    if (!file || !imageData) {
      console.warn('Could not find image data for:', imageId);
      return undefined;
    }

    // Convert file to base64
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });

    return {
      data: base64,
      originalId: imageId,
      thumbnail: imageData.thumbnail,
      metadata: {
        name: file.name,
        type: file.type,
        size: file.size
      }
    };
  } catch (error) {
    console.error('Failed to prepare image data:', error);
    return undefined;
  }
}

export function setupCharacterActions(
  room: Room,
  gameState: GameState,
  onGameStateChange: (newState: GameState) => void,
  isRoomCreator: boolean
) {
  // Set up action senders
  const [sendCharCreate] = room.makeAction(CharacterActions.CREATE);
  const [sendCharUpdate] = room.makeAction(CharacterActions.UPDATE);
  const [sendCharDelete] = room.makeAction(CharacterActions.DELETE);
  const [sendCharSelect] = room.makeAction(CharacterActions.SELECT);

  // DM-only actions
  const dmActions = isRoomCreator ? {
    // Direct state modifications when DM is making changes
    createCharacterDirect: (character: Omit<Character, 'id'>) => {
      const newId = crypto.randomUUID();
      const newCharacter = { ...character, id: newId };
      
      onGameStateChange({
        ...gameState,
        party: [...gameState.party, newCharacter]
      });

      return newId;
    },

    updateCharacterDirect: (id: string, updates: Partial<Character>) => {
      onGameStateChange({
        ...gameState,
        party: gameState.party.map(char =>
          char.id === id ? { ...char, ...updates } : char
        )
      });
    },

    deleteCharacterDirect: (id: string) => {
      onGameStateChange({
        ...gameState,
        party: gameState.party.filter(char => char.id !== id)
      });
    },

    selectCharacterDirect: (characterId: string, playerId: string) => {
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
    }
  } : undefined;

  // Actions available to both DM and players
  return {
    ...dmActions,

    createCharacter: async (character: Omit<Character, 'id'>) => {
      console.log(`Preparing character creation request from ${selfId}`);
      
      // If character has an image, prepare it for transfer
      let imageData: CharacterImageData | undefined;
      if (character.image) {
        imageData = await prepareImageData(character.image);
        if (!imageData) {
          // If image preparation failed, remove the image reference
          character = { ...character, image: undefined };
        }
      }

      console.log(`Sending character creation request from ${selfId}`);
      return sendCharCreate({
        character,
        imageData,
        playerId: selfId
      });
    },

    updateCharacter: async (id: string, updates: Partial<Character>) => {
      console.log(`Preparing character update request for ${id} from ${selfId}`);
      
      // If update includes a new image, prepare it for transfer
      let imageData: CharacterImageData | undefined;
      if (updates.image) {
        imageData = await prepareImageData(updates.image);
        if (!imageData) {
          // If image preparation failed, remove the image update
          updates = { ...updates, image: undefined };
        }
      }

      console.log(`Sending character update request for ${id} from ${selfId}`);
      return sendCharUpdate({
        id,
        updates,
        imageData,
        playerId: selfId
      });
    },

    deleteCharacter: (id: string) => {
      console.log(`Sending character deletion request for ${id} from ${selfId}`);
      return sendCharDelete({
        id,
        playerId: selfId
      });
    },

    selectCharacter: (characterId: string) => {
      console.log(`Sending character selection request for ${characterId} from ${selfId}`);
      return sendCharSelect({
        characterId,
        playerId: selfId
      });
    }
  };
}

// Hook to use character actions
export function useCharacterActions(
  room: Room | undefined,
  gameState: GameState,
  onGameStateChange: (newState: GameState) => void,
  isRoomCreator: boolean
) {
  if (!room) {
    return {
      createCharacter: () => Promise.resolve(),
      updateCharacter: () => Promise.resolve(),
      deleteCharacter: () => Promise.resolve(),
      selectCharacter: () => Promise.resolve()
    };
  }

  return setupCharacterActions(room, gameState, onGameStateChange, isRoomCreator);
}