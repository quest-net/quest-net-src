// domains/Image/SpriteDisplay.tsx

import { useState, useEffect, useRef } from 'react';
import { Texture, ImageSource } from 'pixi.js';
import { useQuestContext } from '../Context/ContextProvider';
import { useActionService } from '../../services/Actions/ActionServiceProvider';
import { IndexedDBUtilities } from '../../utils/IndexedDBUtilities';

interface SpriteDisplayProps {
  imageId: string | undefined;
  x: number;
  y: number;
  anchor?: { x: number; y: number };
  scale?: { x: number; y: number };
  alpha?: number;
  tint?: number;
  width?: number;  // Default 64
  height?: number; // Default 64
}

export function SpriteDisplay({
  imageId,
  x,
  y,
  anchor = { x: 0.5, y: 0.5 }, // center
  scale = { x: 1, y: 1 },
  alpha = 1,
  tint = 0xffffff,
  width = 64,
  height = 64
}: SpriteDisplayProps) {
  const context = useQuestContext();
  const { actionService } = useActionService();
  const [texture, setTexture] = useState<Texture | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Track current load to prevent race conditions
  const currentLoadId = useRef(0);

  const isDM = context.User.Role === 'dm';

  useEffect(() => {
    // Reset state when imageId changes
    setTexture(null);
    setError(null);

    if (!imageId) {
      return;
    }

    // Increment load counter to invalidate previous loads
    const loadId = ++currentLoadId.current;

    let objectUrl: string | null = null;
    let imageElement: HTMLImageElement | null = null;
    let createdTexture: Texture | null = null;

    const loadImage = async () => {
      setIsLoading(true);
      
      try {
        // STEP 1: Try IndexedDB first (works offline for everyone)
        const cached = await IndexedDBUtilities.load(imageId);
        
        let blob: Blob | null = null;
        
        if (cached) {
          blob = cached.data as Blob;
        } else if (!isDM) {
          // STEP 2: If not cached and we're a player, request from DM
          if (!actionService) {
            if (loadId === currentLoadId.current) {
              setError('Not connected');
              setIsLoading(false);
            }
            return;
          }

          const imageService = (actionService as any).imageService;
          if (!imageService) {
            if (loadId === currentLoadId.current) {
              setError('Image service not available');
              setIsLoading(false);
            }
            return;
          }

          // Request from DM (this will cache it in IndexedDB)
          blob = await imageService.getImage(imageId);
          
          if (!blob) {
            if (loadId === currentLoadId.current) {
              setError('Image not found');
              setIsLoading(false);
            }
            return;
          }
        } else {
          // STEP 3: Image not found (shouldn't happen for DM)
          if (loadId === currentLoadId.current) {
            setError('Image not found in IndexedDB');
            setIsLoading(false);
          }
          return;
        }

        // Check if this load is still current
        if (loadId !== currentLoadId.current) return;

        // STEP 4: Create texture from blob using PixiJS v8 API
        objectUrl = URL.createObjectURL(blob);
        imageElement = new Image();
        
        // Wait for image to load
        await new Promise<void>((resolve, reject) => {
          imageElement!.onload = () => resolve();
          imageElement!.onerror = () => reject(new Error('Failed to load image'));
          imageElement!.src = objectUrl!;
        });

        // Check again if this load is still current
        if (loadId !== currentLoadId.current) return;

        // Create ImageSource and Texture using PixiJS v8 API
        const source = new ImageSource({ resource: imageElement });
        createdTexture = new Texture({ source });
        
        setTexture(createdTexture);
        setIsLoading(false);

      } catch (err) {
        console.error(`[SpriteDisplay] Error loading image ${imageId}:`, err);
        if (loadId === currentLoadId.current) {
          setError('Failed to load image');
          setIsLoading(false);
        }
      }
    };

    loadImage();

    // Cleanup: revoke object URL and destroy texture to prevent memory leaks
    return () => {
        currentLoadId.current++; // Invalidate this load
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        if (createdTexture && loadId === currentLoadId.current - 1) {
          createdTexture.destroy(true);
        }
      };
  }, [imageId, isDM]); // actionService intentionally removed from deps!

  // No imageId provided - render placeholder
  if (!imageId) {
    return (
      <pixiGraphics
        x={x}
        y={y}
        draw={(g) => {
          g.clear();
          g.circle(0, 0, Math.min(width, height) / 2);
          g.fill({ color: 0x666666, alpha: 0.3 });
        }}
      />
    );
  }

  // Loading state - render placeholder
  if (isLoading || !texture) {
    return (
      <pixiGraphics
        x={x}
        y={y}
        draw={(g) => {
          g.clear();
          g.circle(0, 0, Math.min(width, height) / 2);
          g.fill({ color: 0x666666, alpha: 0.5 });
        }}
      />
    );
  }

  // Error state - render error placeholder
  if (error) {
    return (
      <pixiGraphics
        x={x}
        y={y}
        draw={(g) => {
          g.clear();
          g.circle(0, 0, Math.min(width, height) / 2);
          g.fill({ color: 0xff0000, alpha: 0.5 });
        }}
      />
    );
  }

  // Success - render actual sprite with scale calculation
    // Safety check: ensure texture has valid dimensions
    const textureWidth = texture.width || 1;
    const textureHeight = texture.height || 1;

    // COVER strategy: scale to fill the entire area, maintaining aspect ratio
    // (parts that exceed bounds will be clipped by the container/mask)
    const scaleToFill = Math.max(
        width / textureWidth,
        height / textureHeight
    );
  
    const scaleX = scaleToFill * scale.x;
    const scaleY = scaleToFill * scale.y;

  return (
    <pixiSprite
      texture={texture}
      x={x}
      y={y}
      anchor={anchor}
      scale={{ x: scaleX, y: scaleY }}
      alpha={alpha}
      tint={tint}
    />
  );
}