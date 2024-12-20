import React, { useCallback, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import type { GameState, Item, Skill, Character, Entity, InventorySlot } from '../../types/game';
import { imageManager } from '../../services/ImageManager';
import { imageProcessor } from '../../services/ImageProcessor';

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
      thumbnail: string;
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
  const [updateInstances, setUpdateInstances] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

// Helper function to update instances of an item based on template
const updateItemInstances = (
  state: GameState,
  templateId: string,
  template: Item
): GameState => {
  // Create a copy of the template without usage-specific fields
  const templateBase = {
    ...template,
    usesLeft: undefined // Don't override instance-specific uses
  };

  // Update party inventories and equipment
  const updatedParty = state.party.map((character) => ({
    ...character,
    inventory: character.inventory.map((slot): InventorySlot => 
      slot[0].id === templateId ? [{ ...slot[0], ...templateBase }, slot[1]] : slot
    ),
    equipment: character.equipment.map(item =>
      item.id === templateId ? { ...item, ...templateBase } : item
    )
  }));

  // Update global entity inventories
  const updatedEntities = state.globalCollections.entities.map((entity) => ({
    ...entity,
    inventory: entity.inventory.map((slot): InventorySlot =>
      slot[0].id === templateId ? [{ ...slot[0], ...templateBase }, slot[1]] : slot
    )
  }));

  // Update field entity inventories
  const updatedField = state.field.map((entity) => ({
    ...entity,
    inventory: entity.inventory.map((slot): InventorySlot =>
      slot[0].id === templateId ? [{ ...slot[0], ...templateBase }, slot[1]] : slot
    )
  }));

  return {
    ...state,
    party: updatedParty,
    globalCollections: {
      ...state.globalCollections,
      entities: updatedEntities
    },
    field: updatedField
  };
};

  // Helper function to update instances of a skill based on template
  const updateSkillInstances = (
    state: GameState,
    templateId: string,
    template: Skill
  ): GameState => {
    // Create a copy of the template without usage-specific fields
    const templateBase = {
      ...template,
      usesLeft: undefined // Don't override instance-specific uses
    };

    // Update party skills
    const updatedParty = state.party.map((character: Character) => ({
      ...character,
      skills: character.skills.map(skill =>
        skill.id === templateId ? { ...skill, ...templateBase } : skill
      )
    }));

    // Update global entity skills
    const updatedEntities = state.globalCollections.entities.map((entity: Entity) => ({
      ...entity,
      skills: entity.skills.map(skill =>
        skill.id === templateId ? { ...skill, ...templateBase } : skill
      )
    }));

    // Update field entity skills
    const updatedField = state.field.map((entity: Entity) => ({
      ...entity,
      skills: entity.skills.map(skill =>
        skill.id === templateId ? { ...skill, ...templateBase } : skill
      )
    }));

    return {
      ...state,
      party: updatedParty,
      globalCollections: {
        ...state.globalCollections,
        entities: updatedEntities
      },
      field: updatedField
    };
  };

  const mergeGameStates = (current: GameState, imported: GameState, mode: ImportMode): GameState => {
    if (mode === 'replace') {
      return {
        ...imported,
        party: imported.party.map(char => ({
          ...char,
          playerId: undefined
        }))
      };
    }

    let mergedState = {
      ...current,
      party: [
        ...current.party,
        ...imported.party.filter(char => 
          !current.party.some(c => c.id === char.id)
        ).map(char => ({ ...char, playerId: undefined }))
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
      }
    };

    // Update existing items and skills if updateInstances is true
    if (updateInstances) {
      // Update instances for modified items
      imported.globalCollections.items.forEach(importedItem => {
        const existingItem = current.globalCollections.items.find(i => i.id === importedItem.id);
        if (existingItem) {
          mergedState = updateItemInstances(mergedState, importedItem.id, importedItem);
        }
      });

      // Update instances for modified skills
      imported.globalCollections.skills.forEach(importedSkill => {
        const existingSkill = current.globalCollections.skills.find(s => s.id === importedSkill.id);
        if (existingSkill) {
          mergedState = updateSkillInstances(mergedState, importedSkill.id, importedSkill);
        }
      });
    }

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
            // Determine image category based on how it's used in the game state
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
            // Check if image is used by any entities
            else if ([...importedState.globalCollections.entities, ...importedState.field]
                .some(entity => entity.image === imageId)) {
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

    const fileContent = await file.text();
    
    if (importMode === 'replace') {
      setPendingImportData(fileContent);
      setShowConfirmation(true);
    } else {
      processImportData(fileContent);
    }
  };

  return (
    <div>
      <input
        type="file"
        accept=".json"
        onChange={handleFileChange}
        ref={fileInputRef}
        className="hidden"
        id="save-file-input"
      />
      
      <div className="relative">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 mb-2">
            <input
              type="checkbox"
              id="update-instances"
              checked={updateInstances}
              onChange={(e) => setUpdateInstances(e.target.checked)}
              className="form-checkbox h-4 w-4 text-blue dark:text-cyan rounded border-grey dark:border-offwhite"
            />
            <label htmlFor="update-instances" className="text-sm">
              Update existing item/skill instances
            </label>
          </div>
          
          <button
            onClick={() => {
              fileInputRef.current?.click();
              setImportMode('merge');
            }}
            disabled={isImporting}
            className={`inline-flex items-center px-4 py-2 bg-blue dark:bg-cyan text-white dark:text-grey rounded-t-md 
              hover:bg-blue-700 dark:hover:bg-cyan-700 transition-colors gap-2
              ${isImporting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Upload className="w-4 h-4" />
            Add to Save
          </button>
          <button
            onClick={() => {
              fileInputRef.current?.click();
              setImportMode('replace');
            }}
            disabled={isImporting}
            className={`inline-flex items-center px-4 py-2 bg-blue dark:bg-cyan text-white border-t-2 border-offwhite dark:border-grey dark:text-grey rounded-b-md 
              hover:bg-blue-700 dark:hover:bg-cyan-700 transition-colors gap-2
              ${isImporting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Upload className="w-4 h-4" />
            Replace Save
          </button>
        </div>

        {/* Status messages */}
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

        {/* Confirmation Modal */}
        {showConfirmation && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-grey p-6 rounded-lg max-w-md w-full">
              <h3 className="text-lg font-bold mb-4">Replace Existing Save?</h3>
              <p className="mb-6">This will replace your current save with the imported data. This action cannot be undone. Are you sure you want to continue?</p>
              <div className="flex justify-end gap-4">
                <button
                  onClick={() => {
                    setShowConfirmation(false);
                    setPendingImportData(null);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                    }
                  }}
                  className="px-4 py-2 bg-grey dark:bg-offwhite text-offwhite dark:text-grey rounded-md hover:bg-grey-700 dark:hover:bg-offwhite-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowConfirmation(false);
                    if (pendingImportData) {
                      processImportData(pendingImportData);
                    }
                  }}
                  className="px-4 py-2 bg-blue dark:bg-cyan text-white dark:text-grey rounded-md hover:bg-blue-700 dark:hover:bg-cyan-700 transition-colors"
                >
                  Replace
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportSaveDialog;