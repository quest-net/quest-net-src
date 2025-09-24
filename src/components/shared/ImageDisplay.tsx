import React, { useEffect, useState, useCallback, useRef } from 'react';
import { imageManager } from '../../services/ImageManager';
import { GameState } from '../../types/game';
import { ReactComponent as DefaultImage } from '../ui/env.svg'

interface ImageDisplayProps {
  gameState: GameState;
}

export function EnvironmentDisplay({ gameState }: ImageDisplayProps) {
  // State for environment image
  const [envImageUrl, setEnvImageUrl] = useState<string | null>(null);
  const [envIsLoading, setEnvIsLoading] = useState(false);
  const [envError, setEnvError] = useState<string | null>(null);
  const envLoadAttempts = useRef(0);
  const envImageCheckInterval = useRef<NodeJS.Timeout>();
  const currentEnvImageId = useRef<string | null>(null);
  const envIsDownloading = useRef(false);

  // State for focus image
  const [focusImageUrl, setFocusImageUrl] = useState<string | null>(null);
  const [focusIsLoading, setFocusIsLoading] = useState(false);
  const [focusError, setFocusError] = useState<string | null>(null);
  const focusLoadAttempts = useRef(0);
  const focusImageCheckInterval = useRef<NodeJS.Timeout>();
  const currentFocusImageId = useRef<string | null>(null);
  const focusIsDownloading = useRef(false);

  const cleanupImageUrl = useCallback((url: string) => {
    try {
      URL.revokeObjectURL(url);
      console.log('Cleaned up URL:', url);
    } catch (err) {
      console.error('Failed to clean up URL:', err);
    }
  }, []);

  const loadImage = useCallback(async (
    imageId: string | undefined,
    setUrl: (url: string | null) => void,
    setIsLoading: (loading: boolean) => void,
    setError: (error: string | null) => void,
    loadAttempts: React.MutableRefObject<number>,
    imageCheckInterval: React.MutableRefObject<NodeJS.Timeout | undefined>,
    currentImageId: React.MutableRefObject<string | null>,
    isDownloading: React.MutableRefObject<boolean>,
    currentUrl: string | null,
    type: 'environment' | 'focus'
  ) => {
    if (!imageId) {
      setUrl(null);
      setError(null);
      return;
    }

    if (imageId === currentImageId.current && currentUrl) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log(`Fetching ${type} image:`, imageId);
      const image = await imageManager.getImage(imageId);
      
      if (!image) {
        if (!isDownloading.current) {
          isDownloading.current = true;
          console.log(`${type} image not found, waiting for download...`);
        }
        throw new Error('Image not found in storage');
      }

      isDownloading.current = false;

      if (currentUrl) {
        cleanupImageUrl(currentUrl);
      }

      const blob = new Blob([await image.arrayBuffer()], { type: image.type });
      const url = URL.createObjectURL(blob);

      await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => reject(new Error('Failed to preview image'));
        img.src = url;
      });

      currentImageId.current = imageId;
      setUrl(url);
      setError(null);
      loadAttempts.current = 0;
      
      if (imageCheckInterval.current) {
        clearInterval(imageCheckInterval.current);
        imageCheckInterval.current = undefined;
      }
    } catch (err) {
      console.error(`Error loading ${type} image:`, err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to load image';

      if (!isDownloading.current) {
        setError(errorMessage);
      }

      if (errorMessage === 'Image not found in storage' && loadAttempts.current < 10) {
        loadAttempts.current++;
        
        if (!imageCheckInterval.current) {
          imageCheckInterval.current = setInterval(() => {
            loadImage(
              imageId, setUrl, setIsLoading, setError, 
              loadAttempts, imageCheckInterval, currentImageId, 
              isDownloading, currentUrl, type
            );
          }, 1000);
        }
      } else if (loadAttempts.current >= 10 && !isDownloading.current) {
        if (imageCheckInterval.current) {
          clearInterval(imageCheckInterval.current);
          imageCheckInterval.current = undefined;
        }
        setError('Failed to load image after multiple attempts');
      }
    } finally {
      setIsLoading(isDownloading.current);
    }
  }, [cleanupImageUrl]);

  // Effect for environment image
  useEffect(() => {
    const imageId = gameState.display.environmentImageId;
    
    if (imageId !== currentEnvImageId.current) {
      envLoadAttempts.current = 0;
      envIsDownloading.current = false;
      if (envImageCheckInterval.current) {
        clearInterval(envImageCheckInterval.current);
        envImageCheckInterval.current = undefined;
      }
    }

    loadImage(
      imageId,
      setEnvImageUrl,
      setEnvIsLoading,
      setEnvError,
      envLoadAttempts,
      envImageCheckInterval,
      currentEnvImageId,
      envIsDownloading,
      envImageUrl,
      'environment'
    );

    return () => {
      if (envImageCheckInterval.current) {
        clearInterval(envImageCheckInterval.current);
        envImageCheckInterval.current = undefined;
      }
    };
  }, [gameState.display.environmentImageId, envImageUrl, loadImage]);

  // Effect for focus image
  useEffect(() => {
    if (!gameState.display.showFocusImage) {
      setFocusImageUrl(null);
      return;
    }

    const imageId = gameState.display.focusImageId;
    
    if (imageId !== currentFocusImageId.current) {
      focusLoadAttempts.current = 0;
      focusIsDownloading.current = false;
      if (focusImageCheckInterval.current) {
        clearInterval(focusImageCheckInterval.current);
        focusImageCheckInterval.current = undefined;
      }
    }

    loadImage(
      imageId,
      setFocusImageUrl,
      setFocusIsLoading,
      setFocusError,
      focusLoadAttempts,
      focusImageCheckInterval,
      currentFocusImageId,
      focusIsDownloading,
      focusImageUrl,
      'focus'
    );

    return () => {
      if (focusImageCheckInterval.current) {
        clearInterval(focusImageCheckInterval.current);
        focusImageCheckInterval.current = undefined;
      }
    };
  }, [gameState.display.focusImageId, gameState.display.showFocusImage, focusImageUrl, loadImage]);

  // Cleanup effect
  useEffect(() => {
  // Only cleanup on component unmount, not when URLs change
  return () => {
    // Clean up any remaining URLs when component unmounts
    if (envImageUrl) {
      try {
        URL.revokeObjectURL(envImageUrl);
      } catch (err) {
        console.error('Failed to clean up environment image URL on unmount:', err);
      }
    }
    if (focusImageUrl) {
      try {
        URL.revokeObjectURL(focusImageUrl);
      } catch (err) {
        console.error('Failed to clean up focus image URL on unmount:', err);
      }
    }
    envIsDownloading.current = false;
    focusIsDownloading.current = false;
  };
}, []);

  const renderLoadingState = (type: string) => (
    <div className="flex flex-col items-center">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      <span className="text-gray-500 mt-2">
        {`${type === 'environment' ? 'Environment' : 'Focus'} image loading...`}
      </span>
    </div>
  );

  // Fixed parameter order - optional parameter at the end
  const renderError = (error: string, type: string, retry: () => void, imageId?: string) => (
    <div className="text-center">
      <p className="text-red-500 mb-2">{error}</p>
      {imageId && (
        <p className="text-gray-500 text-sm mb-4">
          {`${type} ImageID: ${imageId}`}
        </p>
      )}
      <button
        onClick={retry}
        className="mt-2 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
      >
        Retry Loading
      </button>
    </div>
  );

  return (
    <div className="w-full h-full rounded-lg overflow-hidden bg-offwhite dark:bg-grey border-2 border-grey dark:border-offwhite relative">
      {/* Background blur effect */}
      {envImageUrl && (
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="absolute inset-0 scale-110"
            style={{
              backgroundImage: `url(${envImageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(10px) brightness(0.75)',
            }}
          />
        </div>
      )}

      {/* Main environment image container */}
      <div className="relative w-full h-full flex items-center justify-center">
        {envIsLoading ? (
          renderLoadingState('environment')
        ) : envError ? (
          renderError(
            envError,
            'Environment',
            () => {
              envLoadAttempts.current = 0;
              envIsDownloading.current = false;
              loadImage(
                gameState.display.environmentImageId,
                setEnvImageUrl,
                setEnvIsLoading,
                setEnvError,
                envLoadAttempts,
                envImageCheckInterval,
                currentEnvImageId,
                envIsDownloading,
                envImageUrl,
                'environment'
              );
            },
            gameState.display.environmentImageId
          )
        ) : !envImageUrl ? (
          <DefaultImage className="fill-grey dark:fill-offwhite display-none"/>
        ) : (
          <div 
            className="w-full h-full relative z-10"
            style={{
              backgroundImage: `url(${envImageUrl})`,
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              backgroundSize: 'contain'
            }}
          />
        )}
      </div>

      {/* Focus Image Overlay */}
      {gameState.display.showFocusImage && (
        <div className="absolute bottom-4 right-4 max-w-[40%] h-[48%] max-h-[55%] rounded-xl overflow-hidden bg-black bg-opacity-50 z-20">
          <div className="w-full h-full relative">
            {focusIsLoading ? (
              renderLoadingState('focus')
            ) : focusError ? (
              renderError(
                focusError,
                'Focus',
                () => {
                  focusLoadAttempts.current = 0;
                  focusIsDownloading.current = false;
                  loadImage(
                    gameState.display.focusImageId,
                    setFocusImageUrl,
                    setFocusIsLoading,
                    setFocusError,
                    focusLoadAttempts,
                    focusImageCheckInterval,
                    currentFocusImageId,
                    focusIsDownloading,
                    focusImageUrl,
                    'focus'
                  );
                },
                gameState.display.focusImageId
              )
            ) : focusImageUrl && (
              <img
                src={focusImageUrl}
                alt="Focus"
                className="w-full h-full object-contain rounded-xl"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}