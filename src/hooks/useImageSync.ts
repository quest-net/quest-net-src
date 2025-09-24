// src/hooks/useImageSync.ts

import { useCallback, useEffect, useRef } from 'react';
import type { Room } from 'trystero/nostr';
import type { GameState } from '../types/game';
import { imageManager } from '../services/ImageManager';
import { imageProcessor } from '../services/ImageProcessor';
import { getCatalogEntity } from '../utils/referenceHelpers';

// Configuration constants
const CHUNK_SIZE = 128 * 1024; // 128KB chunks
const MAX_IMAGE_DIMENSION = 1920;
const COMPRESSION_QUALITY = 0.85;
const REQUEST_TIMEOUT = 30000; // 30 seconds

// Types for image transmission
interface ImageChunk {
  imageId: string;
  index: number;
  total: number;
  chunk: ArrayBuffer;
  metadata: {
    name: string;
    type: string;
    size: number;
  };
}

interface PendingRequest {
  resolve: (file: File | null) => void;
  reject: (error: Error) => void;
  timeoutId?: NodeJS.Timeout;
  peerId?: string;
  abortController?: AbortController;
}

interface ChunkCache {
  chunks: Map<number, Uint8Array>;
  metadata?: ImageChunk['metadata'];
  receivedChunks: number;
  totalChunks: number;
}

export function useImageSync(room: Room | undefined, isRoomCreator: boolean, gameState: GameState) {
  // Refs for state management
  const pendingRequests = useRef(new Map<string, PendingRequest>());
  const chunkCache = useRef(new Map<string, ChunkCache>());
  const actionsInitialized = useRef(false);
  const abortControllers = useRef(new Map<string, AbortController>());

  // Utility function to compress images before sending
  const compressImage = useCallback(async (file: File): Promise<File> => {
    if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 100000) {
      return file;
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      img.onload = () => {
        // Calculate dimensions maintaining aspect ratio
        let { width, height } = img;
        if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
          const ratio = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
          width *= ratio;
          height *= ratio;
        }

        canvas.width = width;
        canvas.height = height;
        
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Failed to compress image'));
              return;
            }
            resolve(new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: file.lastModified
            }));
          },
          'image/jpeg',
          COMPRESSION_QUALITY
        );
      };

      img.onerror = () => reject(new Error('Failed to load image for compression'));
      img.src = URL.createObjectURL(file);
    });
  }, []);

  // Function to process received chunks
  const processReceivedChunk = useCallback(async (chunk: ImageChunk) => {
    const { imageId, index, total, metadata } = chunk;
    
    let cache = chunkCache.current.get(imageId);
    if (!cache) {
      cache = {
        chunks: new Map(),
        metadata,
        receivedChunks: 0,
        totalChunks: total
      };
      chunkCache.current.set(imageId, cache);
    }

    cache.chunks.set(index, new Uint8Array(chunk.chunk));
    cache.receivedChunks++;

    // Check if we have all chunks
    if (cache.receivedChunks === total) {
      try {
        const completeBuffer = new Uint8Array(metadata.size);
        let position = 0;

        for (let i = 0; i < total; i++) {
          const chunkData = cache.chunks.get(i);
          if (!chunkData) throw new Error(`Missing chunk ${i}`);
          completeBuffer.set(chunkData, position);
          position += chunkData.length;
        }

        // Create initial file from received data
        const initialFile = new File([completeBuffer], metadata.name, {
          type: metadata.type,
          lastModified: Date.now()
        });

        // Determine image category based on original metadata
        let category: 'gallery' | 'item' | 'skill' | 'character' | 'entity' = 'gallery';

        // Check environment image first as it should maintain high resolution
        if (gameState.display.environmentImageId === imageId || 
            gameState.display.focusImageId === imageId) {
          category = 'gallery';
        }
        // Check items
        else if (gameState.globalCollections.items.some(item => item.image === imageId)) {
          category = 'item';
        }
        // Check skills
        else if (gameState.globalCollections.skills.some(skill => skill.image === imageId)) {
          category = 'skill';
        }
        // Check characters
        else if (gameState.party.some(char => char.image === imageId)) {
          category = 'character';
        }
        // Check entities - need to handle both catalog entities and EntityReferences
        else if (gameState.globalCollections.entities.some(entity => entity.image === imageId) ||
                 gameState.field.some(entityRef => {
                   const catalogEntity = getCatalogEntity(entityRef.catalogId, gameState);
                   return catalogEntity?.image === imageId;
                 })) {
          category = 'entity';
        }

        // Process the image using our central processor
        const processedFile = await imageProcessor.processImage(initialFile, category);

        // Add to ImageManager with processed file
        await imageManager.addReceivedImage(processedFile, {
          id: imageId,
          name: metadata.name,
          description: `Received image: ${metadata.name}`,
          createdAt: Date.now(),
          size: processedFile.size,
          type: processedFile.type
        }, category);

        // Cleanup
        chunkCache.current.delete(imageId);
        const pendingRequest = pendingRequests.current.get(imageId);
        if (pendingRequest?.timeoutId) {
          clearTimeout(pendingRequest.timeoutId);
        }
        pendingRequests.current.delete(imageId);
      } catch (error) {
        console.error(`Failed to process image ${imageId}:`, error);
        chunkCache.current.delete(imageId);
      }
    }
  }, [gameState]);

  // Setup effect for room actions
  useEffect(() => {
    if (!room) return;

    // Capture current ref values for cleanup
    const currentPendingRequests = pendingRequests.current;
    const currentChunkCache = chunkCache.current;
    const currentAbortControllers = abortControllers.current;

    const actions = {
      chunk: room.makeAction<ImageChunk>('imageChunk'),
      request: room.makeAction<{ from: string; requestId: string }>('requestEnv'),
      response: room.makeAction<{
        imageId: string;
        requestId: string;
        success: boolean;
        error?: string;
      }>('envResponse')
    };

    if (!actionsInitialized.current) {
      // Set up chunk handler
      const [, getImageChunk] = actions.chunk;
      getImageChunk(processReceivedChunk);

      // Set up request handler (for room creators)
      const [, getEnvRequest] = actions.request;
      getEnvRequest(async ({ from, requestId }) => {
        if (!isRoomCreator) return;

        const [sendResponse] = actions.response;
        
        try {
          const environmentImageId = gameState.display.environmentImageId;
          if (!environmentImageId) {
            await sendResponse({
              imageId: '',
              requestId,
              success: false,
              error: 'No environment image set'
            }, from);
            return;
          }

          const imageFile = await imageManager.getImage(environmentImageId);
          if (!imageFile) {
            await sendResponse({
              imageId: '',
              requestId,
              success: false,
              error: 'Environment image not found'
            }, from);
            return;
          }

          // Send success response first
          await sendResponse({
            imageId: environmentImageId,
            requestId,
            success: true
          }, from);

          // Then send the image in chunks
          await sendImageInChunks(environmentImageId, imageFile, from, async (chunk, target) => {
            const [sendChunk] = actions.chunk;
            return sendChunk(chunk, target);
          });

        } catch (error) {
          await sendResponse({
            imageId: '',
            requestId,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          }, from);
        }
      });

      // Set up response handler
      const [, getEnvResponse] = actions.response;
      getEnvResponse(({ imageId, requestId, success, error }) => {
        const pendingRequest = pendingRequests.current.get(requestId);
        if (pendingRequest) {
          if (pendingRequest.timeoutId) {
            clearTimeout(pendingRequest.timeoutId);
          }
          
          if (success && imageId) {
            // The image will arrive via chunks, so we keep the request pending
            // and it will be resolved when all chunks are received
          } else {
            pendingRequest.reject(new Error(error || 'Failed to get environment image'));
            pendingRequests.current.delete(requestId);
          }
        }
      });

      actionsInitialized.current = true;
    }

    return () => {
      // Cleanup timeouts and abort controllers using captured values
      currentPendingRequests.forEach(request => {
        if (request.timeoutId) {
          clearTimeout(request.timeoutId);
        }
        if (request.abortController) {
          request.abortController.abort();
        }
      });
      currentPendingRequests.clear();
      currentChunkCache.clear();
      
      currentAbortControllers.forEach(controller => {
        controller.abort();
      });
      currentAbortControllers.clear();
    };
  }, [room, gameState, processReceivedChunk, isRoomCreator]);

  // Function to send images in chunks
  const sendImageInChunks = useCallback(async (
    imageId: string,
    file: File,
    targetPeerId: string,
    sendChunk: (chunk: ImageChunk, target?: string) => Promise<void>
  ) => {
    try {
      // Compress image before sending
      const compressedFile = await compressImage(file);
      
      const buffer = await compressedFile.arrayBuffer();
      const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE);

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, buffer.byteLength);
        const chunk = buffer.slice(start, end);

        const imageChunk: ImageChunk = {
          imageId,
          index: i,
          total: totalChunks,
          chunk,
          metadata: {
            name: compressedFile.name,
            type: compressedFile.type,
            size: buffer.byteLength
          }
        };

        await sendChunk(imageChunk, targetPeerId);
      }
    } catch (error) {
      console.error(`Failed to send image ${imageId}:`, error);
      throw error;
    }
  }, [compressImage]);

  // Function to request environment image
  const requestEnvironmentImage = useCallback(async (peerId: string): Promise<File | null> => {
    if (!room) return null;

    const requestId = crypto.randomUUID();
    const [sendRequest] = room.makeAction<{ from: string; requestId: string }>('requestEnv');

    return new Promise((resolve, reject) => {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort();
        pendingRequests.current.delete(requestId);
        reject(new Error('Environment image request timed out'));
      }, REQUEST_TIMEOUT);

      pendingRequests.current.set(requestId, {
        resolve,
        reject,
        timeoutId,
        peerId,
        abortController
      });

      abortControllers.current.set(requestId, abortController);

      sendRequest({ from: peerId, requestId }, peerId).catch((error) => {
        clearTimeout(timeoutId);
        pendingRequests.current.delete(requestId);
        abortControllers.current.delete(requestId);
        reject(error);
      });
    });
  }, [room]);

  return {
    requestEnvironmentImage,
    sendImageInChunks
  };
}