import { useEffect, useRef, useCallback } from 'react';
import type { Room } from 'trystero/nostr';
import { imageManager } from '../services/ImageManager';
import { imageProcessor } from '../services/ImageProcessor';
import { GameState } from '../types/game';

// Constants for optimization
const CHUNK_SIZE = 256 * 1024; // 256KB chunks
const MAX_PARALLEL_CHUNKS = 3;
const CHUNK_PROCESSING_DELAY = 20;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
const COMPRESSION_QUALITY = 0.9;
const MAX_IMAGE_DIMENSION = 2048;

// TypeScript interfaces
interface ImageChunk {
  imageId: string;
  chunk: number[];
  index: number;
  total: number;
  metadata: {
    type: string;
    name: string;
    size: number;
    originalSize: number;
    originalType: string;
  };
  thumbnail: string;
}

interface PendingRequest {
  imageId: string;
  retryCount: number;
  timeoutId?: NodeJS.Timeout;
  peerId?: string;
  abortController?: AbortController;
}

interface ChunkCache {
  chunks: Map<number, Uint8Array>;
  metadata?: ImageChunk['metadata'];
  thumbnail?: string;
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
    const { imageId, index, total, metadata, thumbnail } = chunk;
    
    let cache = chunkCache.current.get(imageId);
    if (!cache) {
      cache = {
        chunks: new Map(),
        metadata,
        thumbnail,
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
        // Check entities
        else if ([...gameState.globalCollections.entities, ...gameState.field]
            .some(entity => entity.image === imageId)) {
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
          type: processedFile.type,
          thumbnail: cache.thumbnail || '',
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
  }, []);

  // Setup effect for room actions
  useEffect(() => {
    if (!room) return;

    const actions = {
      chunk: room.makeAction<ImageChunk>('imageChunk'),
      request: room.makeAction<{ from: string; requestId: string }>('requestEnv'),
      response: room.makeAction<{
        imageId: string;
        requestId: string;
        success: boolean;
        error?: string;
      }>('responseEnv')
    };

    const [sendImageChunk, getImageChunk] = actions.chunk;
    const [sendImageRequest, getImageRequest] = actions.request;
    const [sendImageResponse, getImageResponse] = actions.response;

    // Handle incoming chunks
    getImageChunk(processReceivedChunk);

    // Handle image requests (DM only)
    if (isRoomCreator) {
      getImageRequest(async ({ from: imageId, requestId }, peerId) => {
        try {
          const image = await imageManager.getImage(imageId);
          const imageData = await imageManager.getImageData(imageId);
      
          if (!image || !imageData) {
            await sendImageResponse({
              imageId,
              requestId,
              success: false,
              error: 'Image not found'
            }, peerId);
            return;
          }
      
          // Remove the compression step entirely and just use the image as-is
          const buffer = await image.arrayBuffer();
          const chunks = new Uint8Array(buffer);
          const totalChunks = Math.ceil(chunks.length / CHUNK_SIZE);
      
          await sendImageResponse({
            imageId,
            requestId,
            success: true
          }, peerId);
      
          // Send chunks in parallel with controlled concurrency
          for (let i = 0; i < totalChunks; i += MAX_PARALLEL_CHUNKS) {
            const batch = Array.from(
              { length: Math.min(MAX_PARALLEL_CHUNKS, totalChunks - i) },
              (_, index) => {
                const start = (i + index) * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, chunks.length);
                return {
                  index: i + index,
                  data: Array.from(chunks.slice(start, end))
                };
              }
            );
      
            await Promise.all(batch.map(chunk =>
              sendImageChunk({
                imageId,
                chunk: chunk.data,
                index: chunk.index,
                total: totalChunks,
                metadata: {
                  type: image.type,
                  name: image.name,
                  size: buffer.byteLength,
                  originalSize: image.size,
                  originalType: image.type
                },
                thumbnail: imageData.thumbnail
              }, peerId)
            ));
      
            await new Promise(resolve => setTimeout(resolve, CHUNK_PROCESSING_DELAY));
          }
        } catch (error) {
          console.error('Failed to process image request:', error);
          await sendImageResponse({
            imageId,
            requestId,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          }, peerId);
        }
      });
    }

    // Handle image responses (players only)
    if (!isRoomCreator) {
      getImageResponse(({ imageId, requestId, success, error }) => {
        const request = pendingRequests.current.get(imageId);
        if (!request) return;

        if (!success) {
          console.error(`Image request ${requestId} failed:`, error);
          if (request.timeoutId) clearTimeout(request.timeoutId);
          pendingRequests.current.delete(imageId);
          return;
        }

        if (request.timeoutId) {
          clearTimeout(request.timeoutId);
          request.timeoutId = undefined;
        }
      });

      // Add image request function to window for external access
      (window as any).requestImage = (imageId: string) => {
        if (pendingRequests.current.has(imageId)) return;
      
        const requestId = crypto.randomUUID();
        const abortController = new AbortController(); // Create controller first
        
        const request: PendingRequest = {
          imageId,
          retryCount: 0,
          timeoutId: setTimeout(() => retryRequest(imageId), RETRY_DELAY),
          abortController // Assign the definitely-defined controller
        };
      
        pendingRequests.current.set(imageId, request);
        abortControllers.current.set(imageId, abortController); // Use the definitely-defined controller
        sendImageRequest({ from: imageId, requestId });
      };
    }

    // Retry logic for failed requests
    const retryRequest = (imageId: string) => {
      const request = pendingRequests.current.get(imageId);
      if (!request) return;

      if (request.retryCount >= MAX_RETRIES) {
        pendingRequests.current.delete(imageId);
        abortControllers.current.delete(imageId);
        return;
      }

      request.retryCount++;
      const requestId = crypto.randomUUID();
      sendImageRequest({ from: imageId, requestId });

      request.timeoutId = setTimeout(() => retryRequest(imageId), RETRY_DELAY);
    };

    actionsInitialized.current = true;

    // Cleanup function
    return () => {
      actionsInitialized.current = false;
      
      // Clear all pending requests and timeouts
      pendingRequests.current.forEach(request => {
        if (request.timeoutId) clearTimeout(request.timeoutId);
        request.abortController?.abort();
      });
      pendingRequests.current.clear();
      
      // Clear chunk cache
      chunkCache.current.clear();
      
      // Clear abort controllers
      abortControllers.current.forEach(controller => controller.abort());
      abortControllers.current.clear();

      // Remove window function
      if (!isRoomCreator) {
        delete (window as any).requestImage;
      }
    };
  }, [room, isRoomCreator, processReceivedChunk, compressImage]);

  return actionsInitialized.current;
}