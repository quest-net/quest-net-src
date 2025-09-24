import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { imageManager } from '../../../services/ImageManager';
import type { GameImage, GameState } from '../../../types/game';
import type { Room } from 'trystero/nostr';
import { useImageSync } from '../../../hooks/useImageSync';
import { EnvironmentDisplay } from '../../shared/ImageDisplay';
import { Upload, Trash2, GripVertical } from 'lucide-react';
import {ReactComponent as GradLine} from '../../ui/halftone.svg'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  MeasuringStrategy
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';

// Constants
const IMAGES_PER_PAGE = 16;
const INTERSECTION_THRESHOLD = 0.1;

interface VisualsTabProps {
  gameState: GameState;
  onGameStateChange: (newState: GameState) => void;
  room?: Room;
  isRoomCreator: boolean;
}

interface VirtualizedImageGridProps {
  images: GameImage[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  selectorType: 'environment' | 'focus';
  searchTargetId?: string;
}

interface SortableImageProps {
  image: GameImage;
  selectedId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  selectorType: 'environment' | 'focus';
}

const SortableImage = React.memo(({ 
  image, 
  selectedId, 
  onSelect, 
  onDelete, 
  selectorType
}: SortableImageProps) => {
  const [imageSrc, setImageSrc] = useState<string>('');

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useSortable({ id: image.id });

  // Load image immediately when component mounts
  useEffect(() => {
    imageManager.getImage(image.id)
      .then(file => {
        if (file) {
          const url = URL.createObjectURL(file);
          setImageSrc(url);
        }
      })
      .catch(error => {
        console.error(`Failed to load image ${image.id}:`, error);
      });

    // Cleanup on unmount
    return () => {
      if (imageSrc && imageSrc.startsWith('blob:')) {
        URL.revokeObjectURL(imageSrc);
      }
    };
  }, [image.id]);

  const style = {
    transform: isDragging ? 
      `translate3d(${Math.round(transform?.x ?? 0)}px, ${Math.round(transform?.y ?? 0)}px, 0)` : 
      undefined,
    zIndex: isDragging ? 999 : undefined,
    position: 'relative' as const,
  };

  return (
    <div
      ref={setNodeRef}
      id={`${selectorType}-image-${image.id}`}
      style={style}
      className={`
        group relative aspect-square cursor-pointer rounded-lg overflow-hidden border-2
        ${selectedId === image.id ? 'border-blue-500 shadow-lg' : 'border-transparent hover:border-blue-200'}
        ${isDragging ? 'shadow-2xl' : ''}
      `}
    >
      <div className="relative w-full h-full" onClick={() => onSelect(image.id)}>
        <img
          src={imageSrc}
          alt={image.name}
          className="w-full h-full object-cover"
          style={{ 
            backgroundColor: '#f3f4f6',
            minHeight: '100%'
          }}
        />
        
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-opacity">
          <span className="text-white opacity-0 group-hover:opacity-100 text-sm text-center px-2">
            {selectedId === image.id ? 'Current Selection' : 'Select Image'}
          </span>
        </div>
        <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 p-2">
          <div className="text-white text-xs truncate">{image.name}</div>
        </div>
      </div>

      {/* Delete and Drag Controls */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(image.id);
          }}
          className="p-1 bg-red-500 hover:bg-red-600 text-white rounded-md"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <div
          {...attributes}
          {...listeners}
          className="p-1 bg-gray-500 hover:bg-gray-600 text-white rounded-md cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
});

// Virtualized Grid with Improved Search Navigation
const VirtualizedImageGrid = React.memo(({ 
  images, 
  selectedId, 
  onSelect, 
  onDelete, 
  selectorType,
  searchTargetId 
}: VirtualizedImageGridProps) => {
  const [page, setPage] = useState(0);
  const [intersectionRef, setIntersectionRef] = useState<HTMLDivElement | null>(null);

  // ✅ OPTIMIZED: Improved search navigation
  useEffect(() => {
    if (searchTargetId) {
      const imageIndex = images.findIndex(img => img.id === searchTargetId);
      if (imageIndex !== -1) {
        const requiredPage = Math.floor(imageIndex / IMAGES_PER_PAGE);
        
        // Always expand to show the target image
        setPage(Math.max(requiredPage, page));
        
        // ✅ IMPROVED: Wait for DOM to update, then scroll and highlight
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const targetElement = document.getElementById(`${selectorType}-image-${searchTargetId}`);
            if (targetElement) {
              targetElement.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'center' 
              });
              
              // Add highlight animation
              targetElement.classList.add('search-highlight');
              setTimeout(() => {
                targetElement.classList.remove('search-highlight');
              }, 10000);
            }
          });
        });
      }
    }
  }, [searchTargetId, images, selectorType, page]);

  const visibleImages = useMemo(() => {
    return images.slice(0, (page + 1) * IMAGES_PER_PAGE);
  }, [images, page]);

  // Intersection observer for pagination
  useEffect(() => {
    if (!intersectionRef) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && visibleImages.length < images.length) {
          setPage(p => p + 1);
        }
      },
      { threshold: INTERSECTION_THRESHOLD }
    );

    observer.observe(intersectionRef);
    return () => observer.disconnect();
  }, [intersectionRef, visibleImages.length, images.length]);

  return (
    <div className="grid grid-cols-3 gap-4">
      {visibleImages.map((image, index) => (
        <SortableImage
          key={image.id}
          image={image}
          selectedId={selectedId}
          onSelect={onSelect}
          onDelete={onDelete}
          selectorType={selectorType}
        />
      ))}
      {visibleImages.length < images.length && (
        <div ref={setIntersectionRef} className="h-4" />
      )}
    </div>
  );
});

const ImageSelector = React.memo(({ 
  images,
  selectedId,
  onSelect,
  onDelete,
  onReorder,
  title,
  selectorType,
  searchTargetId
}: {
  images: GameImage[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onReorder: (oldIndex: number, newIndex: number) => void;
  title: string;
  selectorType: 'environment' | 'focus';
  searchTargetId?: string;
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 0,
        tolerance: 5
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = images.findIndex((image) => image.id === active.id);
      const newIndex = images.findIndex((image) => image.id === over.id);
      onReorder(oldIndex, newIndex);
    }
  }, [images, onReorder]);

  return (
    <div className="h-full flex flex-col rounded-lg">
      <div className="p-4">
        <h3 className="text-lg font-['Mohave'] font-semibold">{title}</h3>
      </div>
      <div className="flex-1 overflow-y-auto scrollable overflow-x-hidden p-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          measuring={{
            droppable: {
              strategy: MeasuringStrategy.Always
            }
          }}
        >
          <SortableContext items={images.map(img => img.id)} strategy={rectSortingStrategy}>
            <VirtualizedImageGrid
              images={images}
              selectedId={selectedId}
              onSelect={onSelect}
              onDelete={onDelete}
              selectorType={selectorType}
              searchTargetId={searchTargetId}
            />
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
});

export const VisualsTab = React.memo(({ gameState, onGameStateChange, room, isRoomCreator }: VisualsTabProps) => {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [searchTargetId, setSearchTargetId] = useState<string>();

  useImageSync(room, isRoomCreator, gameState);

  // ✅ OPTIMIZED: Removed bulk image loading - now handled per-image lazily

  // Listen for search navigation events
  useEffect(() => {
    const handleSearchNavigation = (e: CustomEvent) => {
      if (e.detail?.type === 'image') {
        setSearchTargetId(e.detail.id);
      }
    };

    window.addEventListener('searchNavigation' as any, handleSearchNavigation);
    return () => {
      window.removeEventListener('searchNavigation' as any, handleSearchNavigation);
    };
  }, []);

  const handleDeleteImage = useCallback(async (imageId: string) => {
    await imageManager.deleteImage(imageId);
    onGameStateChange({
      ...gameState,
      globalCollections: {
        ...gameState.globalCollections,
        images: gameState.globalCollections.images.filter(img => img.id !== imageId)
      }
    });
  }, [onGameStateChange, gameState]);

  const handleReorderImages = (oldIndex: number, newIndex: number) => {
    onGameStateChange({
      ...gameState,
      globalCollections: {
        ...gameState.globalCollections,
        images: arrayMove(gameState.globalCollections.images, oldIndex, newIndex)
      }
    });
  };

  const handleSetEnvironmentImage = async (imageId: string) => {
    if (isRoomCreator && (window as any).broadcastImage) {
      try {
        await (window as any).broadcastImage(imageId);
      } catch (err) {
        console.error('Failed to broadcast image:', err);
        setError('Failed to send image to players');
        return;
      }
    }

    onGameStateChange({
      ...gameState,
      display: {
        ...gameState.display,
        environmentImageId: imageId
      }
    });
  };

  const handleSetFocusImage = async (imageId: string) => {
    if (isRoomCreator && (window as any).broadcastImage) {
      try {
        await (window as any).broadcastImage(imageId);
      } catch (err) {
        console.error('Failed to broadcast image:', err);
        setError('Failed to send image to players');
        return;
      }
    }

    onGameStateChange({
      ...gameState,
      display: {
        ...gameState.display,
        focusImageId: imageId,
        showFocusImage: true
      }
    });
  };

  const handleToggleFocusImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    onGameStateChange({
      ...gameState,
      display: {
        ...gameState.display,
        showFocusImage: e.target.checked
      }
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setError('');
    
    const newImages: GameImage[] = [];
    const totalFiles = files.length;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadProgress(`Uploading image ${i + 1} of ${totalFiles}`);
        
        try {
          const newImage = await imageManager.addImage(file,'gallery');
          newImages.push(newImage);
        } catch (err) {
          console.error(`Failed to upload image ${file.name}:`, err);
          setError(prev => prev + `\nFailed to upload ${file.name}`);
        }
      }

      if (newImages.length > 0) {
        onGameStateChange({
          ...gameState,
          globalCollections: {
            ...gameState.globalCollections,
            images: [...gameState.globalCollections.images, ...newImages]
          }
        });
      }

    } catch (err) {
      console.error('Failed during batch upload:', err);
      setError('Some images failed to upload. Please try again.');
    } finally {
      setIsUploading(false);
      setUploadProgress('');
      e.target.value = '';
    }
  };

  return (
    <>
      <div className="fixed inset-0 w-full h-full -z-10 overflow-hidden">
        <GradLine className="absolute bottom-0 left-0 scale-110 fill-grey/60 dark:fill-offwhite/60" />
      </div>
      <div className="h-full w-full" style={{
        display: 'grid',
        gridTemplateColumns: '3fr 4fr 3fr',
        gap: '1.5vh',
        padding: '1.5vh 1.5vh 1.5vh 1.5vh',
      }}>
        {/* Environment Images Column */}
        <div className="min-h-0 rounded-lg bg-offwhite/75 dark:bg-grey/75 border-grey border-2 dark:border-offwhite">
          <ImageSelector
            images={gameState.globalCollections.images}
            selectedId={gameState.display.environmentImageId}
            onSelect={handleSetEnvironmentImage}
            onDelete={handleDeleteImage}
            onReorder={handleReorderImages}
            title="Environment Images"
            selectorType="environment"
            searchTargetId={searchTargetId}
          />
        </div>

      {/* Scene Preview Column */}
      <div className="min-h-0 rounded-lg">
        <div className="h-full flex flex-col">
          {/* Header with Toggle and Upload Button */}
          <div className="p-4 flex justify-between items-center">
            <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={gameState.display.showFocusImage}
              onChange={handleToggleFocusImage}
              className="w-6 h-6 
                appearance-none
                rounded 
                border-2
                border-grey
                dark:border-offwhite 
                bg-offwhite
                dark:bg-grey
                checked:bg-offwhite
                dark:checked:bg-grey
                checked:border-grey
                dark:checked:border-offwhite
                checked:text-blue 
                dark:checked:text-cyan
                relative
                checked:after:absolute
                checked:after:left-1/2
                checked:after:top-1/2
                checked:after:-translate-x-1/3
                checked:after:-translate-y-2/3
                checked:after:content-['✓']
                checked:after:text-blue
                dark:checked:after:text-cyan
                checked:after:text-4xl
                checked:after:font-bold
                cursor-pointer
                transition-colors"
            />
              <span className="text-md font-bold font-['Mohave']">Show Focus Image</span>
            </label>

            <label className="px-4 py-2 rounded-full 
            bg-offwhite dark:bg-grey
            text-blue dark:text-cyan 
            border-2 border-blue dark:border-cyan border-b-4
            active:border-b-2
            active:bg-blue dark:active:bg-cyan
            active:text-offwhite dark:active:text-grey
            transition-all duration-75 text-lg
            flex items-center gap-2 font-['Mohave']">
              <Upload className="w-5 h-5" />
              <span className="font-medium font-['Mohave']">Upload Images</span>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                disabled={isUploading}
                className="hidden"
              />
            </label>
          </div>

          {/* Upload Progress and Error Messages */}
          {(isUploading || error) && (
            <div className="px-4 -mt-2 mb-2">
              {isUploading && (
                <div className="text-sm text-blue">
                  {uploadProgress}
                </div>
              )}
              {error && (
                <div className="text-sm text-red">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Preview Display */}
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="w-full aspect-video">
              <EnvironmentDisplay gameState={gameState} />
            </div>
          </div>

          {/* Bottom Buttons */}
          <div className="p-24 3xl:p-32 grid grid-cols-2 gap-16">
            <button
              onClick={() => {
                onGameStateChange({
                  ...gameState,
                  display: {
                    ...gameState.display,
                    environmentImageId: undefined,
                    focusImageId: undefined,
                    showFocusImage: false
                  }
                });
              }}
              className="py-4 px-4 bg-purple hover:bg-purple-600 dark:bg-pink dark:hover:bg-red dark:text-grey text-white font-bold rounded-full text-xl font-['Mohave'] transition-colors"
            >
              Reset Scene
            </button>
            <button
              onClick={() => {
                // TODO: Implement submit functionality
                console.log('Scene submitted:', gameState.display);
              }}
              className="py-2 px-4 bg-blue hover:bg-blue-600 dark:bg-cyan dark:hover:bg-cyan-500 dark:text-grey text-white font-bold rounded-full text-xl font-['Mohave'] transition-colors"
            >
              Submit Scene
            </button>
          </div>
        </div>
      </div>

      {/* Focus Images Column */}
      <div className="min-h-0 bg-offwhite/75 dark:bg-grey/75 rounded-lg border-grey border-2 dark:border-offwhite">
      <ImageSelector
            images={gameState.globalCollections.images}
            selectedId={gameState.display.focusImageId}
            onSelect={handleSetFocusImage}
            onDelete={handleDeleteImage}
            onReorder={handleReorderImages}
            title="Focus Images"
            selectorType="focus"
            searchTargetId={searchTargetId}
          />
      </div>
    </div>
    </>
  );
});