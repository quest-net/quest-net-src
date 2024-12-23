// src/components/shared/CharacterEditor.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { Character, SerializableCharacter } from '../../types/game';
import { imageManager } from '../../services/ImageManager';
import Modal from './Modal';

interface CharacterEditorProps {
  character?: Character;
  onSave: (character: Omit<SerializableCharacter, 'id'>) => void;
  onUpdate: (id: string, updates: Partial<Character>) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
  isRoomCreator: boolean;
  isModal?: boolean;
}

export function CharacterEditor({ 
  character, 
  onSave, 
  onUpdate, 
  onDelete,
  onClose,
  isRoomCreator,
  isModal = true 
}: CharacterEditorProps) {
  const [form, setForm] = useState<Omit<SerializableCharacter, 'id' | 'playerId'>>({
    name: '',
    description: '',
    image: '',
    maxHp: 10,
    hp: 10,
    maxMp: 10,
    mp: 10,
    maxSp: 10,
    sp: 10,
    spRegenRate: 1,
    equipment: [],
    inventory: [],
    skills: [],
    statusEffects: []
  });

  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Initialize form with character data
  useEffect(() => {
    if (character) {
      const { id, playerId, ...characterData } = character;
      setForm(characterData);
    }
  }, [character]);

  // Handle image loading and preview
  useEffect(() => {
    let mounted = true;
    
    const loadImage = async () => {
      if (!character?.image) {
        if (mounted) setImagePreview(null);
        return;
      }

      // First try to get the thumbnail which is faster
      const thumbnail = imageManager.getThumbnail(character.image);
      if (thumbnail && mounted) {
        setImagePreview(thumbnail);
      }

      try {
        // Then load the full image
        const file = await imageManager.getImage(character.image);
        if (file && mounted) {
          const reader = new FileReader();
          reader.onloadend = () => {
            if (mounted) {
              setImagePreview(reader.result as string);
            }
          };
          reader.readAsDataURL(file);
        }
      } catch (error) {
        console.error('Failed to load character image:', error);
        if (mounted) setImagePreview(null);
      }
    };

    loadImage();
    
    return () => {
      mounted = false;
    };
  }, [character?.image]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!form.name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (!form.description.trim()) {
      newErrors.description = 'Description is required';
    }

    if (form.maxHp < 1) {
      newErrors.maxHp = 'Max HP must be at least 1';
    }

    if (form.maxMp < 0) {
      newErrors.maxMp = 'Max MP cannot be negative';
    }

    if (form.maxSp < 0) {
      newErrors.maxSp = 'Max SP cannot be negative';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleImageUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrors(prev => ({ ...prev, image: 'Please upload an image file' }));
      return;
    }

    const MAX_SIZE = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_SIZE) {
      setErrors(prev => ({ ...prev, image: 'Image must be smaller than 5MB' }));
      return;
    }

    try {
      setIsUploading(true);
      setErrors(prev => {
        const { image, ...rest } = prev;
        return rest;
      });

      // Store in ImageManager first
      const imageData = await imageManager.addImage(file,'character');
      
      // Update the form and preview with the new image
      setImagePreview(imageData.thumbnail);
      setForm(prev => ({ ...prev, image: imageData.id }));
      
      if (!isRoomCreator) {
        // If we're a player, trigger an immediate image sync
        (window as any).requestImage?.(imageData.id);
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      setErrors(prev => ({ ...prev, image: 'Failed to upload image' }));
    } finally {
      setIsUploading(false);
    }
  }, [isRoomCreator]);

  const handleMaxStatChange = (
    stat: 'maxHp' | 'maxMp' | 'maxSp',
    value: number
  ) => {
    setForm(prev => {
      const newMax = Math.max(1, value);
      return {
        ...prev,
        [stat]: newMax,
        // Set the current value to match max for new characters
        [stat.replace('max', '').toLowerCase()]: newMax
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      if (character?.id) {
        // For updates
        await onUpdate(character.id, form);
      } else {
        // For new characters
        await onSave(form);
      }
      onClose();
    } catch (error) {
      console.error('Failed to save character:', error);
      setErrors(prev => ({ 
        ...prev, 
        submit: 'Failed to save character. Please try again.' 
      }));
    }
  };

  const content = (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-6">
        {/* Left column - Image and Stats */}
        <div className="w-64 space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-grey dark:text-offwhite">Character Image</label>
            <div className="relative">
              {imagePreview ? (
                <div className="relative w-full aspect-square">
                  <img
                    src={imagePreview}
                    alt="Character preview"
                    className="w-full h-full object-cover rounded-md border-2 border-grey dark:border-offwhite"
                    onError={() => setImagePreview(null)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setImagePreview(null);
                      setForm(prev => ({ ...prev, image: '' }));
                    }}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div className="w-full aspect-square bg-grey/10 dark:bg-offwhite/10 rounded-md flex items-center justify-center border-2 border-dashed border-grey dark:border-offwhite">
                  <span className="text-sm text-grey dark:text-offwhite">No image</span>
                </div>
              )}
            </div>
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              disabled={isUploading}
              className="block w-full text-sm text-grey dark:text-offwhite file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-sm file:bg-blue dark:file:bg-cyan file:text-white dark:file:text-black cursor-pointer"
            />
          </div>

          
        </div>

        {/* Right column - Name and Description */}
        <div className="flex-1 space-y-4">
          <div className="flex flew-row items-center border-2 border-grey dark:border-offwhite bg-grey dark:bg-offwhite rounded-md">
            <label className="block px-2 bg-grey dark:bg-offwhite text-xl text-offwhite dark:text-grey font-bold font-['Mohave']">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              className="w-full p-[0.25rem] rounded-r-md  bg-offwhite dark:bg-grey"
              required
            />
            {errors.name && <p className="text-sm text-red-500 mt-1">{errors.name}</p>}
          </div>
          <div className="flex flex-row gap-2">
          
            <div>
              <label className="block text-lg font-medium mb-1 font-['Mohave'] text-magenta dark:text-red">Max HP</label>
              <input
                type="number"
                value={form.maxHp}
                onChange={e => handleMaxStatChange('maxHp', Number(e.target.value))}
                className="w-full p-1 rounded border-2 bg-transparent text-magenta dark:text-red border-magenta dark:border-red"
                min="1"
              />
            </div>
            <div>
              <label className="block text-lg font-medium mb-1 font-['Mohave'] text-purple dark:text-pink">Max MP</label>
              <input
                type="number"
                value={form.maxMp}
                onChange={e => handleMaxStatChange('maxMp', Number(e.target.value))}
                className="w-full p-1 rounded border-2 bg-transparent text-purple dark:text-pink border-purple dark:border-pink"
                min="0"
              />
            </div>
            <div>
              <label className="block text-lg font-medium mb-1 font-['Mohave'] text-blue dark:text-cyan">Max SP</label>
              <input
                type="number"
                value={form.maxSp}
                onChange={e => handleMaxStatChange('maxSp', Number(e.target.value))}
                className="w-full p-1 rounded border-2 bg-transparent text-blue dark:text-cyan border-blue dark:border-cyan"
                min="0"
              />
            </div>
            <div>
              <label className="block text-lg font-medium mb-1 font-['Mohave'] text-blue dark:text-cyan">SP Regen</label>
              <input
                type="number"
                value={form.spRegenRate}
                onChange={e => setForm(prev => ({ ...prev, spRegenRate: Number(e.target.value) }))}
                className="w-full p-1 rounded border-2 bg-transparent text-blue dark:text-cyan border-blue dark:border-cyan"
                min="0"
              />
          </div>
          </div>

          <div className="flex flex-wrap border-2 border-grey dark:border-offwhite rounded-md">
            <label className="block text-xl font-['Mohave'] px-2 rounded-br-md bg-grey dark:bg-offwhite text-offwhite dark:text-grey font-bold bg">Description</label>
            <textarea
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              className="w-full p-2 rounded-md bg-transparent"
              rows={5}
              required
            />
            {errors.description && <p className="text-sm text-red-500 mt-1">{errors.description}</p>}
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border-2 border-grey dark:border-offwhite rounded-full hover:bg-grey/10"
            >
              Cancel
            </button>
            {character && onDelete && isRoomCreator && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Delete this character?')) {
                    onDelete(character.id);
                    onClose();
                  }
                }}
                className="px-4 py-2 bg-red-600 text-white rounded-full hover:bg-red-700"
              >
                Delete
              </button>
            )}
            <button
              type="submit"
              className="px-4 py-2 bg-blue dark:bg-cyan text-white dark:text-grey rounded-full hover:opacity-90 disabled:opacity-50"
              disabled={isUploading}
            >
              {character ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </form>
  );

  if (!isModal) return content;

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={character ? 'Edit Character' : 'Create Character'}
    >
      {content}
    </Modal>
  );
}

export default CharacterEditor;