import { useEffect, useRef } from 'react';
import type { Room } from 'trystero/nostr';
import { imageManager } from '../services/ImageManager';
import type { GameState } from '../types/game';
import { useImageSync } from './useImageSync';

export function useEnvImageSync(room: Room | undefined, gameState: GameState) {
  // Track last requested images for both types
  const lastEnvironmentImage = useRef<string | null>(null);
  const lastFocusImage = useRef<string | null>(null);
  const isReady = useImageSync(room, false, gameState); // We're never the DM in this hook

  useEffect(() => {
    if (!room || !isReady) return;

    const checkAndRequestImage = async (imageId: string | undefined, lastRequested: React.MutableRefObject<string | null>) => {
      if (!imageId || lastRequested.current === imageId) return;

      try {
        const existingImage = await imageManager.getImage(imageId);
        if (existingImage) {
          console.log('Found existing image:', imageId);
          lastRequested.current = imageId;
          return;
        }

        if (!(window as any).requestImage) {
          console.log('Image request system not ready, retrying...');
          setTimeout(() => checkAndRequestImage(imageId, lastRequested), 500);
          return;
        }

        console.log('Requesting image:', imageId);
        lastRequested.current = imageId;
        (window as any).requestImage(imageId);

      } catch (err) {
        console.error('Failed to check/request image:', err);
        lastRequested.current = null;
      }
    };

    // Check both environment and focus images
    const checkImages = () => {
      // Check environment image
      if (gameState.display.environmentImageId) {
        checkAndRequestImage(gameState.display.environmentImageId, lastEnvironmentImage);
      }

      // Check focus image if it's being shown
      if (gameState.display.showFocusImage && gameState.display.focusImageId) {
        checkAndRequestImage(gameState.display.focusImageId, lastFocusImage);
      }
    };

    // Initial check
    setTimeout(checkImages, 100);

    return () => {
      lastEnvironmentImage.current = null;
      lastFocusImage.current = null;
    };
  }, [room, gameState.display.environmentImageId, gameState.display.focusImageId, gameState.display.showFocusImage, isReady]);
}