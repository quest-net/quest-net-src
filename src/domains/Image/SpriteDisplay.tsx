// domains/Image/SpriteDisplay.tsx (updated)
// Adds: in-memory Texture cache + internal rounded-rect mask with one-frame
// gating so corners never flash on remount.

import { useState, useEffect, useRef, useMemo } from "react";
import { Texture, ImageSource } from "pixi.js";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { IndexedDBUtilities } from "../../utils/IndexedDBUtilities";

interface SpriteDisplayProps {
  imageId: string | undefined;
  x: number;
  y: number;
  anchor?: { x: number; y: number };
  scale?: { x: number; y: number };
  alpha?: number;
  tint?: number;
  width?: number; // Default 64
  height?: number; // Default 64
  /** If true (default), clip to a rounded-rectangle mask drawn inside this component */
  rounded?: boolean;
  /** Optional corner radius (pixels). Defaults to min(width, height) * 0.45 */
  cornerRadius?: number;
}

// ---------------------------------------------------------------------------
// Simple in-memory Texture cache by imageId. Prevents reload flashes if a
// token remounts (e.g., when it changes z-order/row during animation).
// ---------------------------------------------------------------------------
const textureCache = new Map<string, Texture>();

export function SpriteDisplay({
  imageId,
  x,
  y,
  anchor = { x: 0.5, y: 0.5 }, // center
  scale = { x: 1, y: 1 },
  alpha = 1,
  tint = 0xffffff,
  width = 64,
  height = 64,
  rounded = false,
  cornerRadius,
}: SpriteDisplayProps) {
  const context = useQuestContext();
  const { actionService } = useActionService();
  const [texture, setTexture] = useState<Texture | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track current load to prevent race conditions
  const currentLoadId = useRef(0);

  // Internal mask wiring
  const maskRef = useRef<any>(null); // Pixi Graphics
  const spriteRef = useRef<any>(null); // Pixi Sprite
  const [isMasked, setIsMasked] = useState(false); // one-frame gate to avoid unmasked flash

  const isDM = context.User.Role === "dm";

  // ---------- Texture load with cache ----------
  useEffect(() => {
    // Reset errors on new id
    setError(null);

    // Fast-path: use cached texture immediately if available
    if (imageId) {
      const cached = textureCache.get(imageId);
      if (cached) {
        setTexture(cached);
        setIsLoading(false);
        return;
      }
    }

    setTexture(null);

    if (!imageId) {
      setIsLoading(false);
      return;
    }

    const loadId = ++currentLoadId.current;

    let objectUrl: string | null = null;
    let imageElement: HTMLImageElement | null = null;
    let createdTexture: Texture | null = null;
    let cancelled = false;

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
            if (loadId === currentLoadId.current && !cancelled) {
              setError("Not connected");
              setIsLoading(false);
            }
            return;
          }

          const imageService = (actionService as any).imageService;
          if (!imageService) {
            if (loadId === currentLoadId.current && !cancelled) {
              setError("Image service not available");
              setIsLoading(false);
            }
            return;
          }

          // Request from DM (this will cache it in IndexedDB)
          blob = await imageService.getImage(imageId);

          if (!blob) {
            if (loadId === currentLoadId.current && !cancelled) {
              setError("Image not found");
              setIsLoading(false);
            }
            return;
          }
        } else {
          // STEP 3: Image not found for DM (unexpected)
          if (loadId === currentLoadId.current && !cancelled) {
            setError("Image not found in IndexedDB");
            setIsLoading(false);
          }
          return;
        }

        if (loadId !== currentLoadId.current || cancelled) return;

        // STEP 4: Create texture from blob using PixiJS v8 API
        objectUrl = URL.createObjectURL(blob);
        imageElement = new Image();

        await new Promise<void>((resolve, reject) => {
          imageElement!.onload = () => resolve();
          imageElement!.onerror = () => reject(new Error("Failed to load image"));
          imageElement!.src = objectUrl!;
        });

        if (loadId !== currentLoadId.current || cancelled) return;

        const source = new ImageSource({ resource: imageElement });
        createdTexture = new Texture({ source });

        textureCache.set(imageId, createdTexture);
        setTexture(createdTexture);
        setIsLoading(false);

        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
      } catch (err) {
        console.error(`[SpriteDisplay] Error loading image ${imageId}:`, err);
        if (loadId === currentLoadId.current && !cancelled) {
          setError("Failed to load image");
          setIsLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      cancelled = true;
      currentLoadId.current++; // Invalidate this load
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      // Note: createdTexture is kept alive via textureCache. Do not destroy here.
    };
  }, [imageId, isDM, actionService]);

  // ---------- Hook up mask after both nodes mount ----------
  useEffect(() => {
    if (!rounded) {
      setIsMasked(true); // nothing to do
      return;
    }
    const m = maskRef.current;
    const s = spriteRef.current;
    if (m && s) {
      s.mask = m;
      setIsMasked(true); // flip alpha to real value next render
    } else {
      setIsMasked(false);
    }
  }, [rounded, texture]);

  // Draw function for the rounded-rect mask and placeholders
  const drawRoundedRect = useMemo(
    () => (g: any) => {
      g.clear();
      // Position rect so it matches the sprite's anchor inside this container
      const rx = -width * (anchor?.x ?? 0.5);
      const ry = -height * (anchor?.y ?? 0.5);
      const r = cornerRadius ?? Math.min(width, height) * 0.45;
      g.setFillStyle({ color: 0xffffff, alpha: 1 });
      g.beginPath();
      g.roundRect(rx, ry, width, height, r);
      g.closePath();
      g.fill();
    },
    [width, height, anchor?.x, anchor?.y, cornerRadius]
  );

  // Placeholder that visually matches the rounded token (no corner flicker)
  const RoundedPlaceholder = ({ fillAlpha }: { fillAlpha: number }) => (
    <pixiGraphics draw={(g) => {
      g.clear();
      const rx = -width * (anchor?.x ?? 0.5);
      const ry = -height * (anchor?.y ?? 0.5);
      const r = cornerRadius ?? Math.min(width, height) * 0.45;
      g.setFillStyle({ color: 0x666666, alpha: fillAlpha });
      g.beginPath();
      g.roundRect(rx, ry, width, height, r);
      g.closePath();
      g.fill();
    }} />
  );

  // COVER strategy: scale to fill desired WxH while keeping aspect
  const textureWidth = texture?.width || 1;
  const textureHeight = texture?.height || 1;
  const scaleToFill = Math.max(width / textureWidth, height / textureHeight);
  const scaleX = scaleToFill * scale.x;
  const scaleY = scaleToFill * scale.y;

  // ---------- Render ----------
  // We wrap everything in a container so mask + sprite share coordinates.
  return (
    <pixiContainer x={x} y={y}>
      {rounded && <pixiGraphics ref={maskRef} draw={drawRoundedRect} />}

      {/* No imageId provided */}
      {!imageId && <RoundedPlaceholder fillAlpha={0.3} />}

      {/* Loading state or no texture yet */}
      {(isLoading || (!!imageId && !texture)) && <RoundedPlaceholder fillAlpha={0.5} />}

      {/* Error state */}
      {error && <RoundedPlaceholder fillAlpha={0.5} />}

      {/* Success: sprite masked internally. We gate alpha until mask is applied */}
      {texture && !error && (
        <pixiSprite
          ref={spriteRef}
          texture={texture}
          x={0}
          y={0}
          anchor={anchor}
          scale={{ x: scaleX, y: scaleY }}
          alpha={isMasked ? alpha : 0}
          tint={tint}
        />
      )}
    </pixiContainer>
  );
}
