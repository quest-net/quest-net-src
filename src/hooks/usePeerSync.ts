// src/hooks/usePeerSync.ts

import { useCallback, useRef, useState, useEffect } from 'react';
import { selfId } from 'trystero';
import type { Room } from '../types/room';
import { GameState, GameImage, SerializableSaveState, initialGameState, Item, Skill, Character, Entity, EntityReference } from '../types/game';
import { imageManager } from '../services/ImageManager';
import { roomManager } from '../services/RoomManager';
import { isStateUpdateSafe } from '../utils/gameStateSafety';
import { getCatalogItem, getCatalogSkill, getCatalogEntity } from '../utils/referenceHelpers';

type ImageCategory = 'item' | 'skill' | 'character' | 'entity' | 'gallery';

interface ImageTransitData {
  data: string;
  originalId: string;
}

interface TransitGameImage extends GameImage {
  data?: string;
  originalId?: string;
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

interface TransitSkill extends Omit<Skill, 'image'> {
  image?: string;
  imageData?: ImageTransitData;
}

// EntityReference transit type - same as EntityReference but with imageData for entity images
interface TransitEntityReference extends EntityReference {
  imageData?: ImageTransitData;
}

interface TransitGameState extends Omit<GameState, 'party' | 'field'> {
  party: TransitCharacter[];
  globalCollections: {
    items: TransitItem[];
    skills: TransitSkill[];
    statusEffects: GameState['globalCollections']['statusEffects'];
    images: TransitGameImage[];
    entities: TransitEntity[];
  };
  field: TransitEntityReference[];
}

interface TransitSaveState extends Omit<SerializableSaveState, 'gameState'> {
  gameState: TransitGameState;
  lastModified: number;
  roomCreator: string;
}

export function usePeerSync(isRoomCreator: boolean) {
  const [gameState, setGameState] = useState<GameState>(initialGameState);
  const gameStateRef = useRef<GameState>(initialGameState);
  const isStateInitialized = useRef<boolean>(false);
  const sendGameStateRef = useRef<(state: SerializableSaveState, target?: string | string[]) => void>();

  // Update ref whenever state changes
  useEffect(() => {
    gameStateRef.current = gameState;
    if (gameState !== initialGameState) {
      isStateInitialized.current = true;
    }
  }, [gameState]);

  const getRequiredImageIds = (state: GameState, playerId: string): Set<string> => {
    const requiredIds = new Set<string>();
    
    // Get player's character
    const playerChar = state.party.find(char => char.playerId === playerId);
    if (playerChar) {
      // Add character's own image
      if (playerChar.image) requiredIds.add(playerChar.image);
      
      // Add images from their inventory items (now references)
      playerChar.inventory.forEach(([itemRef]) => {
        const catalogItem = getCatalogItem(itemRef.catalogId, state);
        if (catalogItem?.image) requiredIds.add(catalogItem.image);
      });
      
      // Add images from their equipment (now references)
      playerChar.equipment.forEach(itemRef => {
        const catalogItem = getCatalogItem(itemRef.catalogId, state);
        if (catalogItem?.image) requiredIds.add(catalogItem.image);
      });
      
      // Add images from their skills (now references)
      playerChar.skills.forEach(skillRef => {
        const catalogSkill = getCatalogSkill(skillRef.catalogId, state);
        if (catalogSkill?.image) requiredIds.add(catalogSkill.image);
      });
    }
    
    // Add party member images
    state.party.forEach(char => {
      if (char.image) requiredIds.add(char.image);
    });
  
    // Add currently visible field entities (now references)
    state.field.forEach(entityRef => {
      const catalogEntity = getCatalogEntity(entityRef.catalogId, state);
      if (catalogEntity?.image) requiredIds.add(catalogEntity.image);
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
        
        if (file) {
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });

          return {
            ...obj,
            imageData: {
              data: dataUrl,
              originalId: obj.image
            }
          };
        }
      } catch (err) {
        console.error(`Failed to prepare image for transit:`, err);
      }
      
      return obj;
    };

    // Process entity references for field
    const processedField: TransitEntityReference[] = await Promise.all(
      state.field.map(async (entityRef): Promise<TransitEntityReference> => {
        const catalogEntity = getCatalogEntity(entityRef.catalogId, state);
        if (catalogEntity?.image && shouldIncludeImageData(catalogEntity.image)) {
          try {
            const file = await imageManager.getImage(catalogEntity.image);
            
            if (file) {
              const dataUrl = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(file);
              });

              return {
                ...entityRef,
                imageData: {
                  data: dataUrl,
                  originalId: catalogEntity.image
                }
              };
            }
          } catch (err) {
            console.error(`Failed to prepare entity image for transit:`, err);
          }
        }
        return entityRef;
      })
    );

    const processedImages = await Promise.all(
      state.globalCollections.images
        .filter(img => requiredImages.has(img.id))
        .map(async (img) => {
          if (shouldIncludeImageData(img.id)) {
            try {
              const file = await imageManager.getImage(img.id);
              
              if (file) {
                const dataUrl = await new Promise<string>((resolve) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result as string);
                  reader.readAsDataURL(file);
                });

                return {
                  ...img,
                  data: dataUrl,
                  originalId: img.id
                };
              }
            } catch (err) {
              console.error(`Failed to prepare image for transit:`, err);
            }
          }
          return img;
        })
    );

    const [processedItems, processedSkills, processedParty, processedEntities] = await Promise.all([
      Promise.all(state.globalCollections.items.map(processObjectWithImage)),
      Promise.all(state.globalCollections.skills.map(processObjectWithImage)),
      Promise.all(state.party.map(processObjectWithImage)),
      Promise.all(state.globalCollections.entities.map(processObjectWithImage))
    ]);

    return {
      ...state,
      party: processedParty,
      globalCollections: {
        items: processedItems,
        skills: processedSkills,
        statusEffects: state.globalCollections.statusEffects,
        images: processedImages,
        entities: processedEntities
      },
      field: processedField
    };
  };

  const clearPlayerAssignment = useCallback(async (playerId: string) => {
    const newState = {
      ...gameStateRef.current,
      party: gameStateRef.current.party.map(char => 
        char.playerId === playerId 
          ? { ...char, playerId: undefined }
          : char
      )
    };
    gameStateRef.current = newState;
    setGameState(newState);
  }, []);

  const processReceivedState = useCallback(async (receivedState: TransitGameState): Promise<GameState> => {
    // Check for unsafe state updates
    const safetyCheck = isStateUpdateSafe(gameStateRef.current, receivedState);
    if (!safetyCheck.isSafe) {
      console.error(
        `[usePeerSync] Unsafe state update detected! Disconnecting.`,
        '\nMetrics:', safetyCheck.metrics,
        '\nReason:', safetyCheck.reason
      );
      
      roomManager.leaveRoom();
      return gameStateRef.current;
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
    
        if (obj.imageData.originalId) {
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
              type: file.type
            },
            category
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

    // Process field entity references separately (they have different structure)
    const processedField: EntityReference[] = await Promise.all(
      receivedState.field.map(async (entityRef): Promise<EntityReference> => {
        if (entityRef.imageData) {
          // Process the image data for entity references
          try {
            const response = await fetch(entityRef.imageData.data);
            const blob = await response.blob();
            const file = new File([blob], `entity-${entityRef.imageData.originalId}.png`, {
              type: 'image/png'
            });

            await imageManager.addReceivedImage(
              file,
              {
                id: entityRef.imageData.originalId,
                name: file.name,
                description: 'Received entity image',
                createdAt: Date.now(),
                size: file.size,
                type: file.type
              },
              'entity'
            );

            imageManager.markImageAsKnownByPeer(entityRef.imageData.originalId, selfId);
          } catch (err) {
            console.error('Failed to process entity reference image:', err);
          }
        }

        // Return the entity reference without imageData
        const { imageData, ...cleanEntityRef } = entityRef;
        return cleanEntityRef;
      })
    );

    const [processedParty, processedItems, processedSkills, processedEntities, processedImages] = await Promise.all([
      Promise.all(receivedState.party.map(processObjectWithImage)),
      Promise.all(receivedState.globalCollections.items.map(processObjectWithImage)),
      Promise.all(receivedState.globalCollections.skills.map(processObjectWithImage)),
      Promise.all(receivedState.globalCollections.entities.map(processObjectWithImage)),
      Promise.all(receivedState.globalCollections.images.map(async (image) => {
        if ('data' in image && image.data && image.originalId) {
          try {
            const response = await fetch(image.data);
            const blob = await response.blob();
            const file = new File([blob], image.name, {
              type: image.type
            });

            let category: ImageCategory = 'gallery';

            // Check environment image first as it should maintain high resolution
            if (receivedState.display.environmentImageId === image.id || 
                receivedState.display.focusImageId === image.id) {
              category = 'gallery';
            }
            // Check items
            else if (receivedState.globalCollections.items.some(item => item.image === image.id)) {
              category = 'item';
            }
            // Check skills
            else if (receivedState.globalCollections.skills.some(skill => skill.image === image.id)) {
              category = 'skill';
            }
            // Check characters
            else if (receivedState.party.some(char => char.image === image.id)) {
              category = 'character';
            }
            // Check entities
            else if (receivedState.globalCollections.entities.some(entity => entity.image === image.id) ||
                     receivedState.field.some(entityRef => {
                       const catalogEntity = getCatalogEntity(entityRef.catalogId, receivedState);
                       return catalogEntity?.image === image.id;
                     })) {
              category = 'entity';
            }

            const gameImage = await imageManager.addReceivedImage(file, image, category);
            imageManager.markImageAsKnownByPeer(image.originalId, selfId);
            return gameImage;
          } catch (err) {
            console.error('Failed to process received image:', err);
            const { data, originalId, ...cleanImage } = image;
            return cleanImage;
          }
        }
        return image;
      }))
    ]);

    return {
      ...receivedState,
      party: processedParty,
      globalCollections: {
        items: processedItems,
        skills: processedSkills,
        statusEffects: receivedState.globalCollections.statusEffects,
        images: processedImages,
        entities: processedEntities
      },
      field: processedField
    };
  }, []);

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
      
      const requiredImages = getRequiredImageIds(processedState, selfId);
      const imageIds = new Set<string>();
    
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
          console.log('[usePeerSync] Checking state before sending to new peer:', {
            isInitialized: isStateInitialized.current,
            currentState: gameStateRef.current
          });

          if (!isStateInitialized.current) {
            console.warn('[usePeerSync] State not yet initialized, waiting...');
            setTimeout(async () => {
              if (gameStateRef.current !== initialGameState) {
                const transitState = await prepareStateForTransit(gameStateRef.current, peerId);
                sendGameStateRef.current?.({
                  gameState: transitState,
                  lastModified: Date.now(),
                  roomCreator: selfId
                }, peerId);
              } else {
                console.error('[usePeerSync] Failed to send initialized state to peer');
              }
            }, 2000);
            return;
          }

          const transitState = await prepareStateForTransit(gameStateRef.current, peerId);
          sendGameStateRef.current?.({
            gameState: transitState,
            lastModified: Date.now(),
            roomCreator: selfId
          }, peerId);
        }, 1000);
      }
    });

    return () => {
      roomManager.events.off('peerDisconnected', (peerId) => {
        imageManager.clearPeerData(peerId);
        clearPlayerAssignment(peerId).catch(console.error);
      });
    };
  }, [isRoomCreator, clearPlayerAssignment, processReceivedState]);

  return {
    gameState,
    setGameState: useCallback((newState: GameState) => {
      gameStateRef.current = newState;
      isStateInitialized.current = true;
      setGameState(newState);
    }, []),
    handleGameStateChange,
    initializePeerSync,
    broadcastGameState
  };
}