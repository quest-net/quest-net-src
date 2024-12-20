import React, { useState } from 'react';
import { Download, Image } from 'lucide-react';
import type { GameState, Item, Entity, Character, SerializableCharacter } from '../../types/game';
import { imageManager } from '../../services/ImageManager';

interface ExportSaveDialogProps {
  gameState: GameState;
}

interface BundledSaveFile {
  gameState: GameState;
  images: {
    [imageId: string]: {
      data: string;
      metadata: {
        name: string;
        type: string;
        size: number;
      };
      thumbnail: string;
    };
  };
}

const ExportSaveDialog = ({ gameState }: ExportSaveDialogProps) => {
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  // Helper function to convert File to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to convert file to base64'));
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  };

  // Helper function to clean image references from an item
  const cleanItemImages = (item: Item): Item => ({
    ...item,
    image: undefined
  });

  // Helper function to clean image references from an entity
  const cleanEntityImages = (entity: Entity): Entity => ({
    ...entity,
    image: undefined,
    inventory: entity.inventory.map(([item, count]) => [cleanItemImages(item), count]),
    skills: entity.skills.map(skill => ({ ...skill, image: undefined }))
  });

  // Helper function to clean image references from a character
  const cleanCharacterImages = (character: SerializableCharacter): SerializableCharacter => ({
    ...character,
    image: undefined,
    inventory: character.inventory.map(([item, count]) => [cleanItemImages(item), count]),
    equipment: character.equipment.map(item => cleanItemImages(item)),
    skills: character.skills.map(skill => ({ ...skill, image: undefined }))
  });

  const stripPlayerIds = (state: GameState): GameState => {
    return {
      ...state,
      party: state.party.map(character => ({
        ...character,
        playerId: undefined
      }))
    };
  };

  // Helper function to clean all image references from the game state
  const cleanGameStateImages = (state: GameState): GameState => {
    return {
      ...state,
      party: state.party.map(cleanCharacterImages),
      globalCollections: {
        ...state.globalCollections,
        items: state.globalCollections.items.map(cleanItemImages),
        skills: state.globalCollections.skills.map(skill => ({ ...skill, image: undefined })),
        entities: state.globalCollections.entities.map(cleanEntityImages),
        images: [], // Clear all images from global collections
      },
      field: state.field.map(cleanEntityImages),
      display: {
        ...state.display,
        environmentImageId: undefined,
        focusImageId: undefined,
        showFocusImage: false
      }
    };
  };

  const handleExport = async (includeImages: boolean = false) => {
    if (isExporting) return;
    
    setIsExporting(true);
    setError('');
    setSuccess('');
    
    try {
      if (!includeImages) {
        setProgress('Preparing save file...');
        const cleanGameState = cleanGameStateImages(stripPlayerIds(gameState));
        
        // Create a BundledSaveFile with an empty images object
        const bundledSave: BundledSaveFile = {
          gameState: cleanGameState,
          images: {}
        };
        
        const saveData = JSON.stringify(bundledSave, null, 2);
        const blob = new Blob([saveData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const link = document.createElement('a');
        link.href = url;
        link.download = `quest-net-save-${timestamp}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setSuccess('Save file exported successfully!');
        return;
      }

      // Export with bundled images
      setProgress('Collecting image data...');
      const bundledSave: BundledSaveFile = {
        gameState: stripPlayerIds(gameState),
        images: {}
      };

      const imageIds = Array.from(new Set([
        ...gameState.globalCollections.images.map(img => img.id),
        ...gameState.party.map(char => char.image).filter(Boolean),
        ...gameState.party.flatMap(char => 
          char.inventory.map(([item]) => item.image)
            .concat(char.equipment.map(item => item.image))
            .concat(char.skills.map(skill => skill.image))
        ).filter(Boolean),
        ...gameState.globalCollections.items.map(item => item.image).filter(Boolean),
        ...gameState.globalCollections.skills.map(skill => skill.image).filter(Boolean),
        ...gameState.globalCollections.entities.map(entity => entity.image).filter(Boolean),
        ...gameState.field.map(entity => entity.image).filter(Boolean)
      ] as string[]));

      let processedImages = 0;
      const totalImages = imageIds.length;

      for (const imageId of imageIds) {
        try {
          setProgress(`Processing image ${processedImages + 1}/${totalImages}`);
          
          const file = await imageManager.getImage(imageId);
          const imageData = await imageManager.getImageData(imageId);
          
          if (file && imageData) {
            try {
              const base64Data = await fileToBase64(file);
              
              bundledSave.images[imageId] = {
                data: base64Data,
                metadata: {
                  name: file.name,
                  type: file.type,
                  size: file.size
                },
                thumbnail: imageData.thumbnail
              };
              
              processedImages++;
            } catch (err) {
              console.error(`Failed to process image ${imageId}:`, err);
            }
          }
        } catch (err) {
          console.error(`Failed to load image ${imageId}:`, err);
        }
      }

      if (processedImages === 0) {
        throw new Error('No images were successfully processed');
      }

      setProgress('Creating save file...');
      const saveData = JSON.stringify(bundledSave, null, 2);
      const blob = new Blob([saveData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const link = document.createElement('a');
      link.href = url;
      link.download = `quest-net-save-with-images-${timestamp}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setSuccess('Save file exported successfully with images!');
      
    } catch (error) {
      console.error('Failed to export game state:', error);
      setError(error instanceof Error ? error.message : 'Failed to export save file');
    } finally {
      setIsExporting(false);
      setProgress('');
      if (success) {
        setTimeout(() => setSuccess(''), 3000);
      }
      if (error) {
        setTimeout(() => setError(''), 3000);
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <div className="flex flex-col">
          <button
            onClick={() => handleExport(false)}
            disabled={isExporting}
            className={`inline-flex items-center px-4 py-2 bg-blue dark:bg-cyan text-white dark:text-grey rounded-t-md 
              hover:bg-blue-700 dark:hover:bg-cyan-700 transition-colors gap-2
              ${isExporting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Download className="w-4 h-4" />
            Export Save File
          </button>
          <button
            onClick={() => handleExport(true)}
            disabled={isExporting}
            className={`inline-flex items-center px-4 py-2 bg-blue dark:bg-cyan text-white border-t-2 border-offwhite dark:border-grey dark:text-grey rounded-b-md 
              hover:bg-blue-700 dark:hover:bg-cyan-700 transition-colors gap-2
              ${isExporting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Image className="w-4 h-4" />
            Export with Images
          </button>
        </div>

        {progress && (
          <div className="absolute top-full left-0 mt-2 p-3 bg-blue-100 border border-blue-400 text-blue-700 rounded-md">
            {progress}
          </div>
        )}

        {error && (
          <div className="absolute top-full left-0 mt-2 p-3 bg-red-100 border border-red-400 text-red-700 rounded-md">
            {error}
          </div>
        )}

        {success && (
          <div className="absolute top-full left-0 mt-2 p-3 bg-green-100 border border-green-400 text-green-700 rounded-md">
            {success}
          </div>
        )}
      </div>
    </div>
  );
};

export default ExportSaveDialog;