// components/ImageDisplay.tsx

import { useState, useEffect } from 'react';
import { useActionService } from '../../services/Actions/ActionServiceProvider';

interface ImageDisplayProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  imageId: string | undefined;
}

export function ImageDisplay({ imageId, alt, ...props }: ImageDisplayProps) {
  const { actionService } = useActionService();
  const [src, setSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Reset state when imageId changes
    setSrc(null);
    setError(null);

    if (!imageId) {
      return;
    }

    if (!actionService) {
      setError('Not connected');
      return;
    }

    // Get ImageService from ActionService
    const imageService = (actionService as any).imageService;
    if (!imageService) {
      setError('Image service not available');
      return;
    }

    let objectUrl: string | null = null;

    const loadImage = async () => {
      setIsLoading(true);
      
      try {
        const blob = await imageService.getImage(imageId);
        
        if (!blob) {
          setError('Image not found');
          return;
        }

        // Create object URL from blob
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch (err) {
        console.error(`[ImageDisplay] Error loading image ${imageId}:`, err);
        setError('Failed to load image');
      } finally {
        setIsLoading(false);
      }
    };

    loadImage();

    // Cleanup: revoke object URL to prevent memory leaks
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [imageId, actionService]);

  // No imageId provided
  if (!imageId) {
    return (
      <div 
        className={`flex items-center justify-center bg-base-200 ${props.className || ''}`}
        style={props.style}
      >
        <span className="icon-[mdi--image-off] w-8 h-8 opacity-30"></span>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div 
        className={`flex items-center justify-center bg-base-200 ${props.className || ''}`}
        style={props.style}
      >
        <span className="loading loading-spinner loading-sm"></span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div 
        className={`flex items-center justify-center bg-base-200 ${props.className || ''}`}
        style={props.style}
        title={error}
      >
        <span className="icon-[mdi--image-broken] w-8 h-8 opacity-30"></span>
      </div>
    );
  }

  // Success - render actual image
  if (src) {
    return (
      <img
        src={src}
        alt={alt || 'Image'}
        {...props}
      />
    );
  }

  // Shouldn't reach here, but just in case
  return null;
}