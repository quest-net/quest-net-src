import React, { useState, useEffect } from 'react';
import { Item } from '../../types/game';
import { imageManager } from '../../services/ImageManager';
import { X } from 'lucide-react';

interface ItemEditorProps {
  item?: Item;  
  onSubmit: (item: Omit<Item, 'id'>) => void;
  onCancel: () => void;
}

export const ItemEditor: React.FC<ItemEditorProps> = ({item, onSubmit, onCancel }) => {
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [isEquippable, setIsEquippable] = useState(item?.isEquippable ?? false);
  const [uses, setUses] = useState<number | undefined>(item?.uses);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [image, setImage] = useState<string | undefined>(item?.image);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [tags, setTags] = useState<string[]>(item?.tags ?? []);
  const [currentTag, setCurrentTag] = useState('');

  useEffect(() => {
    if (item?.image) {
      // Load the full image for preview
      imageManager.getImage(item.image).then(file => {
        if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
            setImagePreview(reader.result as string);
          };
          reader.readAsDataURL(file);
        }
      }).catch(err => {
        console.error('Failed to load item image:', err);
      });
    }
  }, [item?.image]);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalTags = currentTag.trim() 
      ? [...tags, currentTag.trim()] 
      : tags;
    onSubmit({ 
      name, 
      description, 
      isEquippable, 
      uses, 
      image, 
      tags: finalTags 
    });
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      return;
    }

    const MAX_SIZE = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_SIZE) {
      return;
    }

    try {
      setIsUploadingImage(true);
      const imageData = await imageManager.addImage(file,'item');
      setImage(imageData.id);
      // Create preview from the uploaded file
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      setIsUploadingImage(false);
    } catch (error) {
      console.error('Error uploading image:', error);
      setIsUploadingImage(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-6">
        {/* Left column - Image */}
        <div className="w-64 space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-grey dark:text-offwhite">Item Image</label>
            <div className="relative">
              {imagePreview ? (
                <div className="relative w-full aspect-square">
                  <img
                    src={imagePreview}
                    alt="Item preview"
                    className="w-full h-full object-cover rounded-md border-2 border-grey dark:border-offwhite"
                    onError={() => setImagePreview(null)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setImagePreview(null);
                      setImage(undefined);
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
              disabled={isUploadingImage}
              className="block w-full text-sm text-grey dark:text-offwhite 
                       file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 
                       file:text-sm file:bg-blue dark:file:bg-cyan 
                       file:text-white dark:file:text-black cursor-pointer"
            />
            {isUploadingImage && (
              <p className="text-sm text-grey dark:text-offwhite">Uploading...</p>
            )}
          </div>
        </div>

        {/* Right column - Item Details */}
        <div className="flex-1 space-y-4">
          {/* Name Field */}
          <div className="flex flew-row items-center border-2 border-grey dark:border-offwhite bg-grey dark:bg-offwhite rounded-md">
            <label className="block px-2 bg-grey dark:bg-offwhite text-xl text-offwhite dark:text-grey font-bold font-['Mohave']">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
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
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2 rounded-md bg-transparent"
              rows={4}
              required
            />
          </div>

          {/* Item Properties */}
          <div className="grid grid-cols-2 gap-4">
            {/* Equippable Toggle */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isEquippable}
                onChange={(e) => setIsEquippable(e.target.checked)}
                id="isEquippable"
                className="w-5 h-5 
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
                  relative
                  checked:after:absolute
                  checked:after:left-1/2
                  checked:after:top-1/2
                  checked:after:-translate-x-1/3
                  checked:after:-translate-y-2/3
                  checked:after:content-['✓']
                  checked:after:text-blue
                  dark:checked:after:text-cyan
                  checked:after:text-xl
                  checked:after:font-bold
                  cursor-pointer
                  transition-colors"
              />
              <label htmlFor="isEquippable" className="text-lg font-medium text-grey dark:text-offwhite font-['Mohave']">
                Is Equippable
              </label>
            </div>

            {/* Uses Input */}
            <div>
              <label className="block text-lg font-medium mb-1 text-grey dark:text-offwhite font-['Mohave']">
                Uses
              </label>
              <input
                type="number"
                value={uses ?? ''}
                onChange={(e) => setUses(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full p-2 border-2 rounded-md border-grey dark:border-offwhite bg-transparent"
                min="1"
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
              onChange={(e) => setCurrentTag(e.target.value)}
              onKeyDown={handleAddTag}
              onBlur={handleTagBlur}
              placeholder="Type a tag and press Enter (e.g., 'Weapon', 'Rare')"
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
          disabled={isUploadingImage}
        >
          {item ? 'Update' : 'Create'}
        </button>
      </div>
    </form>
  );
};