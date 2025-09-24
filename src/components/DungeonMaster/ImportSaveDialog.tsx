import React, { useCallback, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import type { GameState, Item, Skill, Character, Entity, EntityReference, ItemReference, SkillReference } from '../../types/game';
import { imageManager } from '../../services/ImageManager';
import { imageProcessor } from '../../services/ImageProcessor';
import { getCatalogEntity } from '../../utils/referenceHelpers';

type ImportMode = 'merge' | 'replace';

interface ImportSaveDialogProps {
  gameState: GameState;
  onImport: (newGameState: GameState) => void;
}

interface BundledSaveFile {
  gameState: GameState;
  images: {
    [imageId: string]: {
      data: string; // base64 encoded image data
      metadata: {
        name: string;
        type: string;
        size: number;
      };
    };
  };
}

const ImportSaveDialog = ({ gameState, onImport }: ImportSaveDialogProps) => {
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [importProgress, setImportProgress] = useState<string>('');
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [pendingImportData, setPendingImportData] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  // ✅ REMOVED: updateItemInstances and updateSkillInstances functions
  // In the reference system, there are no "instances" to update - all data comes from catalog templates
  // ItemReference and SkillReference objects only contain catalogId + instance-specific data (usesLeft, etc.)

  const mergeGameStates = (current: GameState, imported: GameState, mode: ImportMode): GameState => {
    if (mode === 'replace') {
      return imported;
    }

    // Merge mode
    const mergedState: GameState = {
      ...current,
      party: [
        ...current.party,
        ...imported.party.filter(char =>
          !current.party.some(c => c.id === char.id)
        )
      ],
      globalCollections: {
        ...current.globalCollections,
        items: [
          ...current.globalCollections.items,
          ...imported.globalCollections.items.filter(item =>
            !current.globalCollections.items.some(i => i.id === item.id)
          )
        ],
        skills: [
          ...current.globalCollections.skills,
          ...imported.globalCollections.skills.filter(skill =>
            !current.globalCollections.skills.some(s => s.id === skill.id)
          )
        ],
        statusEffects: [
          ...current.globalCollections.statusEffects,
          ...imported.globalCollections.statusEffects.filter(effect =>
            !current.globalCollections.statusEffects.some(e => e.id === effect.id)
          )
        ],
        entities: [
          ...current.globalCollections.entities,
          ...imported.globalCollections.entities.filter(entity =>
            !current.globalCollections.entities.some(e => e.id === entity.id)
          )
        ],
        images: [
          ...current.globalCollections.images,
          ...imported.globalCollections.images.filter(image =>
            !current.globalCollections.images.some(i => i.id === image.id)
          )
        ]
      },
      // ✅ UPDATED: Handle EntityReference[] field merging
      field: [
        ...current.field,
        ...imported.field.filter(entityRef => 
          !current.field.some(e => e.instanceId === entityRef.instanceId)
        )
      ],
      audio: {
        ...current.audio,
        playlist: [
          ...current.audio.playlist,
          ...imported.audio.playlist.filter(track => 
            !current.audio.playlist.some(t => t.id === track.id)
          )
        ]
      }
    };

    // ✅ REMOVED: Instance update logic since references automatically use catalog templates
    // The reference system doesn't need to update instances - all references automatically
    // reflect the current catalog state when resolved

    return mergedState;
  };

  const processImportData = async (fileContent: string) => {
    setIsImporting(true);
    setError('');
    setSuccess('');
    setImportProgress('Reading save file...');

    try {
      const importedData = JSON.parse(fileContent);
      const isBundled = importedData.hasOwnProperty('gameState') && importedData.hasOwnProperty('images');
      
      let importedState: GameState;
      let totalImages = 0;
      let failedImages = 0;

      if (isBundled) {
        const bundledSave = importedData as BundledSaveFile;
        importedState = bundledSave.gameState;
        
        totalImages = Object.keys(bundledSave.images).length;
        let processedImages = 0;
        
        for (const [imageId, imageData] of Object.entries(bundledSave.images)) {
          setImportProgress(`Importing images (${processedImages + 1}/${totalImages})...`);
          
          try {
            // ✅ UPDATED: Determine image category with EntityReference support
            let category: 'item' | 'skill' | 'character' | 'entity' | 'gallery' = 'gallery';
            
            // Check if image is used by any items
            if (importedState.globalCollections.items.some(item => item.image === imageId)) {
              category = 'item';
            }
            // Check if image is used by any skills
            else if (importedState.globalCollections.skills.some(skill => skill.image === imageId)) {
              category = 'skill';
            }
            // Check if image is used by any characters
            else if (importedState.party.some(char => char.image === imageId)) {
              category = 'character';
            }
            // ✅ UPDATED: Check if image is used by any catalog entities or EntityReference field entities
            else if (importedState.globalCollections.entities.some(entity => entity.image === imageId)) {
              category = 'entity';
            }
            // ✅ UPDATED: Check EntityReference field entities by resolving from catalog
            else if (importedState.field.some(entityRef => {
              const catalogEntity = getCatalogEntity(entityRef.catalogId, importedState);
              return catalogEntity?.image === imageId;
            })) {
              category = 'entity';
            }
        
            // Process the image with appropriate compression rules
            const processedFile = await imageProcessor.processBase64Image(
              imageData.data,
              category,
              imageData.metadata.name
            );
        
            // Add to ImageManager with the original ID to maintain references
            await imageManager.addImage(processedFile, category, imageId);
            
            imageManager.markImageAsKnownByPeer(imageId, 'self');
            processedImages++;
          } catch (err) {
            console.error(`Failed to import image ${imageId}:`, err);
            failedImages++;
          }
        }

        if (failedImages > 0) {
          console.warn(`${failedImages} images failed to import`);
        }
      } else {
        importedState = importedData as GameState;
      }

      if (!importedState.party || !importedState.globalCollections) {
        throw new Error('Invalid save file format');
      }

      const mergedState = mergeGameStates(gameState, importedState, importMode);
      onImport(mergedState);
      
      setError('');
      setSuccess(`Save file ${importMode === 'merge' ? 'merged' : 'imported'} successfully!${
        isBundled ? ` (${totalImages - failedImages}/${totalImages} images imported)` : ''
      }`);
      
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      setTimeout(() => {
        setSuccess('');
      }, 3000);
    } catch (err) {
      setError('Failed to import save file. Please ensure it is a valid Quest-Net save file.');
      console.error('Import error:', err);
    } finally {
      setIsImporting(false);
      setImportProgress('');
      setPendingImportData(null);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      setPendingImportData(content);
      setShowConfirmation(true);
    } catch (err) {
      setError('Failed to read save file.');
    }
  };

  const handleConfirmImport = () => {
    if (pendingImportData) {
      setShowConfirmation(false);
      processImportData(pendingImportData);
    }
  };

  const handleCancelImport = () => {
    setShowConfirmation(false);
    setPendingImportData(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <label
          htmlFor="import-file"
          className={`inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-md 
            hover:bg-green-700 transition-colors gap-2 cursor-pointer
            ${isImporting ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <Upload className="w-4 h-4" />
          Import Save File
          <input
            id="import-file"
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            disabled={isImporting}
            className="hidden"
          />
        </label>

        {importProgress && (
          <div className="absolute top-full left-0 mt-2 p-3 bg-blue-100 border border-blue-400 text-blue-700 rounded-md">
            {importProgress}
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

      {/* Import Mode Selection */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Import Mode:
        </label>
        <div className="flex gap-4">
          <label className="flex items-center">
            <input
              type="radio"
              value="merge"
              checked={importMode === 'merge'}
              onChange={(e) => setImportMode(e.target.value as ImportMode)}
              className="mr-2"
            />
            Merge (keep existing data)
          </label>
          <label className="flex items-center">
            <input
              type="radio"
              value="replace"
              checked={importMode === 'replace'}
              onChange={(e) => setImportMode(e.target.value as ImportMode)}
              className="mr-2"
            />
            Replace (overwrite all data)
          </label>
        </div>
      </div>

      {/* Confirmation Dialog */}
      {showConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Confirm Import</h3>
            <p className="mb-6">
              {importMode === 'merge' 
                ? 'This will merge the imported save data with your current game state. Existing data will be preserved.'
                : 'This will replace your current game state with the imported save data. All existing data will be lost.'
              }
            </p>
            <div className="flex gap-4 justify-end">
              <button
                onClick={handleCancelImport}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmImport}
                className={`px-4 py-2 text-white rounded-md ${
                  importMode === 'merge' 
                    ? 'bg-green-600 hover:bg-green-700' 
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {importMode === 'merge' ? 'Merge' : 'Replace'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImportSaveDialog;