import { useCallback, useRef, useState } from 'react';
import { selfId } from 'trystero';
import type { Room } from '../types/room';
import { GameState, GameImage, SerializableSaveState, initialGameState, Item, Skill, Character, Entity } from '../types/game';
import { imageManager } from '../services/ImageManager';
import { roomManager } from '../services/RoomManager';
import { isStateUpdateSafe } from '../utils/gameStateSafety';

type ImageCategory = 'item' | 'skill' | 'character' | 'entity' | 'gallery';

interface ImageTransitData {
  data: string;
  originalId: string;
  thumbnail: string;
}

interface TransitGameImage extends Omit<GameImage, 'thumbnail'> {
  data?: string;
  originalId?: string;
  thumbnail: string;
}

interface TransitCharacter extends Character {
  imageData?: ImageTransitData;
}

interface TransitItem extends Omit<Item, 'image'> {
  image?: string;
  imageData?: ImageTransitData;
}

interface TransitEntity extends Omit<Entity, 'image'> {
  image?: string;
  imageData?: ImageTransitData;
}

interface TransitSkill extends Omit<Skill, 'image'>{
  image?: string;
  imageData?: ImageTransitData;
}

interface TransitGameState extends Omit<GameState, 'party'> {
  party: TransitCharacter[];
  globalCollections: {
    items: TransitItem[];
    skills: TransitSkill[];
    statusEffects: GameState['globalCollections']['statusEffects'];
    images: TransitGameImage[];
    entities: TransitEntity[];
  };
  field: TransitEntity[];
}

interface TransitSaveState extends Omit<SerializableSaveState, 'gameState'> {
  gameState: TransitGameState;
  lastModified: number;
  roomCreator: string;
}

export function usePeerSync(isRoomCreator: boolean) {
  const [gameState, setGameState] = useState<GameState>(initialGameState);
  const gameStateRef = useRef<GameState>(initialGameState);
  const sendGameStateRef = useRef<(state: SerializableSaveState, target?: string | string[]) => void>();

  const getRequiredImageIds = (state: GameState, playerId: string): Set<string> => {
    const requiredIds = new Set<string>();
    
    // Get player's character
    const playerChar = state.party.find(char => char.playerId === playerId);
    if (playerChar) {
      // Add character's own image
      if (playerChar.image) requiredIds.add(playerChar.image);
      
      // Add images from their inventory items
      playerChar.inventory.forEach(([item]) => {
        if (item.image) requiredIds.add(item.image);
      });
      
      // Add images from their equipment
      playerChar.equipment.forEach(item => {
        if (item.image) requiredIds.add(item.image);
      });
      
      // Add images from their skills
      playerChar.skills.forEach(skill => {
        if (skill.image) requiredIds.add(skill.image);
      });
    }
    
    // Add party member images
    state.party.forEach(char => {
      if (char.image) requiredIds.add(char.image);
    });
  
    // Add currently visible field entities
    state.field.forEach(entity => {
      if (entity.image) requiredIds.add(entity.image);
    });
  
    // Current environment/focus images if visible
    if (state.display.environmentImageId) {
      requiredIds.add(state.display.environmentImageId);
    }
    if (state.display.showFocusImage && state.display.focusImageId) {
      requiredIds.add(state.display.focusImageId);
    }
  
    return requiredIds;
  };
  
  const prepareStateForTransit = async (state: GameState, targetPeerId?: string): Promise<TransitGameState> => {
    const requiredImages = targetPeerId ? getRequiredImageIds(state, targetPeerId) : new Set<string>();
    
    const shouldIncludeImageData = (imageId: string) => {
      if (!imageId || !targetPeerId) return false;
      return requiredImages.has(imageId) && !imageManager.peerHasImage(imageId, targetPeerId);
    };

    const processObjectWithImage = async <T extends { image?: string }>(obj: T): Promise<T & { imageData?: ImageTransitData }> => {
      if (!obj.image || !shouldIncludeImageData(obj.image)) {
        return obj;
      }

      try {
        const file = await imageManager.getImage(obj.image);
        const thumbnail = imageManager.getThumbnail(obj.image);
        
        if (file && thumbnail) {
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });

          return {
            ...obj,
            imageData: {
              data: dataUrl,
              thumbnail,
              originalId: obj.image
            }
          };
        }
      } catch (err) {
        console.error(`Failed to prepare image for transit:`, err);
      }
      
      return obj;
    };

    const processedImages = await Promise.all(
      state.globalCollections.images
        .filter(img => requiredImages.has(img.id))
        .map(async (img) => {
          if (shouldIncludeImageData(img.id)) {
          try {
            const file = await imageManager.getImage(img.id);
            const thumbnail = imageManager.getThumbnail(img.id);
            
            if (file && thumbnail) {
              const dataUrl = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(file);
              });

              return {
                ...img,
                data: dataUrl,
                thumbnail,
                originalId: img.id
              };
            }
          } catch (err) {
            console.error(`Failed to prepare image for transit:`, err);
          }
        }
        return {
          ...img,
          thumbnail: imageManager.getThumbnail(img.id) || ''
        };
      })
    );

    const [processedItems, processedSkills, processedParty, processedEntities, processedField] = await Promise.all([
      Promise.all(state.globalCollections.items.map(processObjectWithImage)),
      Promise.all(state.globalCollections.skills.map(processObjectWithImage)),
      Promise.all(state.party.map(processObjectWithImage)),
      Promise.all(state.globalCollections.entities.map(processObjectWithImage)),
      Promise.all(state.field.map(processObjectWithImage))
    ]);

    return {
      ...state,
      party: processedParty,
      globalCollections: {
        ...state.globalCollections,
        images: processedImages,
        items: processedItems,
        skills: processedSkills,
        entities: processedEntities
      },
      field: processedField
    };
  };
  const clearPlayerAssignment = useCallback(async (peerId: string) => {
    if (!isRoomCreator) return; // Only DM should clear assignments

    const updatedState = {
      ...gameStateRef.current,
      party: gameStateRef.current.party.map(character => {
        if (character.playerId === peerId) {
          console.log(`[usePeerSync] Clearing player assignment for character ${character.name} (${character.id})`);
          return {
            ...character,
            playerId: undefined
          };
        }
        return character;
      })
    };

    gameStateRef.current = updatedState;
    setGameState(updatedState);

    // Safely store the current sendGameState reference
    const sendGameState = sendGameStateRef.current;
    if (sendGameState) {
      const remainingPeers = roomManager.getConnectedPeers();
      // Use Promise.all to handle multiple async operations
      await Promise.all(remainingPeers.map(async (peerId) => {
        const transitState = await prepareStateForTransit(updatedState, peerId);
        sendGameState({
          gameState: transitState,
          lastModified: Date.now(),
          roomCreator: selfId
        }, peerId);
      }));
    }
  }, [isRoomCreator]);
  
  const processReceivedState = async (receivedState: TransitGameState): Promise<GameState> => {

    // If we're the DM, check for dangerous state changes
    if (isRoomCreator) {
      const safetyCheck = isStateUpdateSafe(gameStateRef.current, receivedState);
      
      if (!safetyCheck.isSafe) {
        console.error(
          `[SAFETY ALERT] Dangerous gamestate change detected (${safetyCheck.metrics.overallDiffPercentage.toFixed(1)}% change). Disconnecting.`,
          '\nMetrics:', safetyCheck.metrics,
          '\nReason:', safetyCheck.reason
        );
        
        // Leave the room immediately
        roomManager.leaveRoom();
        
        // Return current state unchanged
        return gameStateRef.current;
      }
    }
    const processObjectWithImage = async <T extends { image?: string, imageData?: ImageTransitData }>(
      obj: T
    ): Promise<Omit<T, 'imageData'>> => {
      if (!obj.imageData) {
        return obj;
      }
    
      try {
        const response = await fetch(obj.imageData.data);
        const blob = await response.blob();
        const file = new File([blob], `object-${obj.imageData.originalId}.png`, {
          type: 'image/png'
        });
    
        if (obj.imageData.originalId && obj.imageData.thumbnail) {
          // Determine the category based on object type
          let category: ImageCategory = 'gallery';
          if ('damage' in obj) category = 'skill';
          else if ('isEquippable' in obj) category = 'item';
          else if ('hp' in obj && 'equipment' in obj) category = 'character';
          else if ('hp' in obj) category = 'entity';
    
          await imageManager.addReceivedImage(
            file,
            {
              id: obj.imageData.originalId,
              name: file.name,
              description: 'Received image',
              createdAt: Date.now(),
              size: file.size,
              type: file.type,
              thumbnail: obj.imageData.thumbnail
            },
            category // Pass the determined category
          );
    
          imageManager.markImageAsKnownByPeer(obj.imageData.originalId, selfId);
    
          const { imageData, ...rest } = obj;
          return {
            ...rest,
            image: obj.imageData.originalId
          };
        }
      } catch (err) {
        console.error('Failed to process received image:', err);
      }
    
      const { imageData, ...rest } = obj;
      return rest;
    };

    const [processedParty, processedItems, processedSkills, processedEntities, processedField, processedImages] = await Promise.all([
      Promise.all(receivedState.party.map(processObjectWithImage)),
      Promise.all(receivedState.globalCollections.items.map(processObjectWithImage)),
      Promise.all(receivedState.globalCollections.skills.map(processObjectWithImage)),
      Promise.all(receivedState.globalCollections.entities.map(processObjectWithImage)),
      Promise.all(receivedState.field.map(processObjectWithImage)),
      Promise.all(receivedState.globalCollections.images.map(async (image) => {
        if ('data' in image && image.data && image.originalId) {
          try {
            const response = await fetch(image.data);
            const blob = await response.blob();
            const file = new File([blob], image.name, {
              type: image.type
            });

            let category: ImageCategory = 'gallery';
            // Dynamically determine category for global collections
            if (receivedState.globalCollections.items.some(item => item.image === image.originalId)) {
              category = 'item';
            } else if (receivedState.globalCollections.skills.some(skill => skill.image === image.originalId)) {
              category = 'skill';
            } else if (receivedState.party.some(char => char.image === image.originalId)) {
              category = 'character';
            } else if (
              [...receivedState.globalCollections.entities, ...receivedState.field].some(
                entity => entity.image === image.originalId
              )
            ) {
              category = 'entity';
            }

            await imageManager.addReceivedImage(file, {
              id: image.originalId,
              name: image.name,
              description: image.description,
              createdAt: image.createdAt,
              size: file.size,
              type: file.type,
              thumbnail: image.thumbnail
            }, category);

            imageManager.markImageAsKnownByPeer(image.originalId, selfId);

            const { data, ...imageWithoutData } = image;
            return {
              ...imageWithoutData,
              id: image.originalId
            };
          } catch (error) {
            console.error('Failed to process collection image:', error);
            const { data, ...imageWithoutData } = image;
            return imageWithoutData;
          }
        }
        return image;
      }))
    ]);

    return {
      ...receivedState,
      party: processedParty,
      globalCollections: {
        ...receivedState.globalCollections,
        images: processedImages,
        items: processedItems,
        skills: processedSkills,
        entities: processedEntities
      },
      field: processedField
    };
  };

  const broadcastGameState = useCallback(async () => {
    if (isRoomCreator && sendGameStateRef.current) {
      const peers = roomManager.getConnectedPeers();
      for (const peerId of peers) {
        const transitState = await prepareStateForTransit(gameStateRef.current, peerId);
        sendGameStateRef.current({
          gameState: transitState,
          lastModified: Date.now(),
          roomCreator: selfId
        }, peerId);
      }
    }
  }, [isRoomCreator]);

  const handleGameStateChange = useCallback(async (newState: GameState) => {
    const stateWithTimestamp = {
      ...newState,
      lastModified: Date.now()
    };
    
    gameStateRef.current = stateWithTimestamp;
    setGameState(stateWithTimestamp);
  
    if (isRoomCreator && sendGameStateRef.current) {
      const peers = roomManager.getConnectedPeers();
      for (const peerId of peers) {
        const transitState = await prepareStateForTransit(stateWithTimestamp, peerId);
        sendGameStateRef.current({
          gameState: transitState,
          lastModified: stateWithTimestamp.lastModified,
          roomCreator: selfId
        }, peerId);
      }
    }
  }, [isRoomCreator]);

  const initializePeerSync = useCallback((room: Room) => {
    const [sendGameState, getGameState] = room.makeAction<TransitSaveState>('gameState');
    const [requestGameState, getStateRequest] = room.makeAction<{ from: string }>('requestState');
    const [sendImageAck, getImageAck] = room.makeAction<{ imageIds: string[], from: string }>('imageAck');
    
    sendGameStateRef.current = sendGameState;

    getImageAck(({ imageIds, from }) => {
      imageIds.forEach(id => {
        imageManager.markImageAsKnownByPeer(id, from);
      });
    });

    getGameState(async (state, peerId) => {
      const processedState = await processReceivedState(state.gameState);
      
      // Acknowledge only required images
      const requiredImages = getRequiredImageIds(processedState, selfId);
      const imageIds = new Set<string>();
    
      // Only acknowledge images we actually need right now
      processedState.globalCollections.images
        .filter(img => requiredImages.has(img.id))
        .forEach(img => imageIds.add(img.id));
    
      if (imageIds.size > 0) {
        sendImageAck({ imageIds: Array.from(imageIds), from: selfId });
      }
    
      gameStateRef.current = processedState;
      setGameState(processedState);
    });

    getStateRequest(async (data, peerId) => {
      const currentSendGameState = sendGameStateRef.current;
      if (isRoomCreator && currentSendGameState) {
        const transitState = await prepareStateForTransit(gameStateRef.current, peerId);
        currentSendGameState({
          gameState: transitState,
          lastModified: Date.now(),
          roomCreator: selfId
        }, peerId);
      }
    });

    // Enhanced disconnect handling with proper async handling
    roomManager.events.on('peerDisconnected', async (peerId) => {
      console.log(`[usePeerSync] Peer disconnected: ${peerId}`);
      imageManager.clearPeerData(peerId);
      await clearPlayerAssignment(peerId);
    });

    room.onPeerJoin(async (peerId) => {
      if (!isRoomCreator) {
        requestGameState({ from: selfId }, peerId);
      } else {
        setTimeout(async () => {
          const currentSendGameState = sendGameStateRef.current;
          if (currentSendGameState) {
            const transitState = await prepareStateForTransit(gameStateRef.current, peerId);
            currentSendGameState({
              gameState: transitState,
              lastModified: Date.now(),
              roomCreator: selfId
            }, peerId);
          }
        }, 1000);
      }
    });

    return () => {
      roomManager.events.off('peerDisconnected', (peerId) => {
        imageManager.clearPeerData(peerId);
        clearPlayerAssignment(peerId).catch(console.error);
      });
    };
  }, [isRoomCreator, clearPlayerAssignment]);

  return {
    gameState,
    setGameState,
    handleGameStateChange,
    initializePeerSync,
    broadcastGameState,
  };
}