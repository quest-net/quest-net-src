import React, { useState, useEffect } from 'react';
import { Skill } from '../../types/game';
import { imageManager } from '../../services/ImageManager';
import { X } from 'lucide-react';

interface SkillEditorProps {
  skill?: Skill;
  onSubmit: (skill: Omit<Skill, 'id'>) => void;
  onCancel: () => void;
}

export const SkillEditor: React.FC<SkillEditorProps> = ({ skill, onSubmit, onCancel }) => {
  const [form, setForm] = useState<Omit<Skill, 'id'>>({
    name: '',
    description: '',
    damage: 0,
    spCost: 0,
  });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tags, setTags] = useState<string[]>(skill?.tags ?? []);
  const [currentTag, setCurrentTag] = useState('');
  const [uses, setUses] = useState<number | undefined>(skill?.uses);

  useEffect(() => {
    if (skill) {
      const { id, ...skillData } = skill;
      setForm(skillData);
      setTags(skillData.tags ?? []);
      setUses(skillData.uses);

      if (skillData.image) {
        // Load the full image for preview
        imageManager.getImage(skillData.image).then(file => {
          if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
              setImagePreview(reader.result as string);
            };
            reader.readAsDataURL(file);
          }
        }).catch(err => {
          console.error('Failed to load skill image:', err);
        });
      }
    }
  }, [skill]);

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrors(prev => ({ ...prev, image: 'Please upload an image file' }));
      return;
    }

    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setErrors(prev => ({ ...prev, image: 'Image must be smaller than 5MB' }));
      return;
    }

    try {
      setIsUploading(true);
      const imageData = await imageManager.addImage(file,'skill');
       // Create preview from the uploaded file
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      setForm(prev => ({ ...prev, image: imageData.id }));
      setErrors(prev => {
        const { image, ...rest } = prev;
        return rest;
      });
    } catch (error) {
      console.error('Error uploading image:', error);
      setErrors(prev => ({ ...prev, image: 'Failed to upload image' }));
    } finally {
      setIsUploading(false);
    }
  };

  const addCurrentTag = () => {
    if (currentTag.trim()) {
      setTags(prevTags => [...prevTags, currentTag.trim()]);
      setCurrentTag('');
    }
  };

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addCurrentTag();
    }
  };

  const handleTagBlur = () => {
    addCurrentTag();
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!form.name.trim()) {
      newErrors.name = 'Name is required';
    }
    if (!form.description.trim()) {
      newErrors.description = 'Description is required';
    }
    if (form.damage < 0) {
      newErrors.damage = 'Damage cannot be negative';
    }
    if (form.spCost < 0) {
      newErrors.spCost = 'SP Cost cannot be negative';
    }
    if (uses !== undefined && uses < 1) {
      newErrors.uses = 'Uses must be at least 1';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    onSubmit({
      ...form,
      tags,
      uses
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-6">
        {/* Left column - Image */}
        <div className="w-64 space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-grey dark:text-offwhite">Skill Image</label>
            <div className="relative">
              {imagePreview ? (
                <div className="relative w-full aspect-square">
                  <img
                    src={imagePreview}
                    alt="Skill preview"
                    className="w-full h-full object-cover rounded-md border-2 border-grey dark:border-offwhite"
                    onError={() => setImagePreview(null)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setImagePreview(null);
                      setForm(prev => ({ ...prev, image: undefined }));
                    }}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
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
              className="block w-full text-sm text-grey dark:text-offwhite 
                       file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 
                       file:text-sm file:bg-blue dark:file:bg-cyan 
                       file:text-white dark:file:text-black cursor-pointer"
            />
            {isUploading && (
              <p className="text-sm text-grey dark:text-offwhite">Uploading...</p>
            )}
          </div>
        </div>

        {/* Right column - Skill Details */}
        <div className="flex-1 space-y-4">
          {/* Name Field */}
          <div className="flex flew-row items-center border-2 border-grey dark:border-offwhite bg-grey dark:bg-offwhite rounded-md">
            <label className="block px-2 bg-grey dark:bg-offwhite text-xl text-offwhite dark:text-grey font-bold font-['Mohave']">
              Name
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              className="w-full p-[0.25rem] rounded-r-md bg-offwhite dark:bg-grey"
              required
            />
          </div>

          {/* Description Field */}
          <div className="flex flex-wrap border-2 border-grey dark:border-offwhite rounded-md">
            <label className="block text-xl font-['Mohave'] px-2 rounded-br-md bg-grey dark:bg-offwhite text-offwhite dark:text-grey font-bold">
              Description
            </label>
            <textarea
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              className="w-full p-2 rounded-md bg-transparent"
              rows={4}
              required
            />
          </div>

          {/* Skill Properties */}
          <div className="grid grid-cols-3 gap-4">
            {/* Damage */}
            <div>
              <label className="block text-lg font-medium mb-1 font-['Mohave'] text-magenta dark:text-red">
                Damage
              </label>
              <input
                type="number"
                value={form.damage}
                onChange={e => setForm(prev => ({ ...prev, damage: Number(e.target.value) }))}
                className="w-full p-2 border-2 rounded-md bg-transparent text-magenta dark:text-red border-magenta dark:border-red"
                min="0"
                required
              />
            </div>

            {/* SP Cost */}
            <div>
              <label className="block text-lg font-medium mb-1 font-['Mohave'] text-blue dark:text-cyan">
                SP Cost
              </label>
              <input
                type="number"
                value={form.spCost}
                onChange={e => setForm(prev => ({ ...prev, spCost: Number(e.target.value) }))}
                className="w-full p-2 border-2 rounded-md bg-transparent text-blue dark:text-cyan border-blue dark:border-cyan"
                min="0"
                required
              />
            </div>

            {/* Uses */}
            <div>
              <label className="block text-lg font-medium mb-1 font-['Mohave'] text-purple dark:text-pink">
                Uses
              </label>
              <input
                type="number"
                value={uses ?? ''}
                onChange={e => setUses(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full p-2 border-2 rounded-md bg-transparent text-purple dark:text-pink border-purple dark:border-pink"
                min="0"
                placeholder="Unlimited"
              />
            </div>
          </div>

          {/* Tags Section */}
          <div>
            <label className="block text-lg font-medium mb-2 text-grey dark:text-offwhite font-['Mohave']">
              Tags
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {tags.map(tag => (
                <span 
                  key={tag}
                  className="px-2 py-1 bg-blue dark:bg-cyan text-white dark:text-grey rounded-md flex items-center gap-1"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-offwhite dark:hover:text-grey"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <input
              type="text"
              value={currentTag}
              onChange={e => setCurrentTag(e.target.value)}
              onKeyDown={handleAddTag}
              onBlur={handleTagBlur}
              placeholder="Type a tag and press Enter (e.g., 'Fire', 'AoE')"
              className="w-full p-2 border-2 rounded-md border-grey dark:border-offwhite bg-transparent"
            />
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-end gap-2 mt-6">
        <button 
          type="button" 
          onClick={onCancel}
          className="px-4 py-2 border-2 border-grey dark:border-offwhite rounded-full hover:bg-grey/10"
        >
          Cancel
        </button>
        <button 
          type="submit" 
          className="px-4 py-2 bg-blue dark:bg-cyan text-white dark:text-grey rounded-full hover:opacity-90 disabled:opacity-50"
          disabled={isUploading}
        >
          {skill ? 'Update' : 'Create'}
        </button>
      </div>
    </form>
  );
};