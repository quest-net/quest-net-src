// components/inputs/TagEditor.tsx
import { useState } from 'react';
import { useFormReadOnly } from '../Form/Form';

interface TagEditorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  readOnly?: boolean;
}

export function TagEditor({ tags, onChange, readOnly: readOnlyProp }: TagEditorProps) {
  const contextReadOnly = useFormReadOnly();
  const readOnly = readOnlyProp ?? contextReadOnly;
  
  const [newTag, setNewTag] = useState('');

  const handleAdd = () => {
    const trimmedTag = newTag.trim();
    // Add tag if it's not empty and not already in the list
    if (trimmedTag && !tags.some(t => t.toLowerCase() === trimmedTag.toLowerCase())) {
      onChange([...tags, trimmedTag]);
      setNewTag('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Prevent form submission
      handleAdd();
    }
  };

  const handleDelete = (tagToDelete: string) => {
    onChange(tags.filter(tag => tag !== tagToDelete));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center min-h-[2rem]">
        {tags.map(tag => (
          <div key={tag} className="badge badge-secondary badge-outline gap-1.5">
            {tag}
            {!readOnly && (
              <button 
                onClick={() => handleDelete(tag)} 
                className="hover:text-error"
                aria-label={`Remove tag ${tag}`}
              >
                <span className="icon-[mdi--close-circle-outline] align-middle" />
              </button>
            )}
          </div>
        ))}
        {tags.length === 0 && (
          <span className="italic text-base-content/60">No tags added.</span>
        )}
      </div>

      {!readOnly && (
        <div className="flex gap-2">
          <input
            type="text"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={readOnly}
            className="input input-bordered input-sm w-full max-w-xs"
            placeholder="Add a new tag"
          />
          <button 
            onClick={handleAdd} 
            disabled={readOnly || !newTag.trim()} 
            className="btn btn-sm btn-outline btn-primary"
          >
            Add Tag
          </button>
        </div>
      )}
    </div>
  );
}