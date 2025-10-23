// components/inputs/ImageUpload.tsx
import { useState, useRef } from 'react';
import { useQuestContext } from '../../domains/Context/ContextProvider';
import { useActionService } from '../../services/Actions/ActionServiceProvider';
import { ImageDisplay } from '../../domains/Image/ImageDisplay';
import { ImageActions } from '../../domains/Image/ImageActions';
import { IndexedDBUtilities } from '../../utils/IndexedDBUtilities';
import { Image } from '../../domains/Image/Image';

interface ImageUploadProps {
  value?: string;  // Current image ID
  onChange: (imageId: string | undefined) => void;
  readOnly?: boolean;
}

type UploadState = 'idle' | 'processing' | 'uploading' | 'error';

export function ImageUpload({ value, onChange, readOnly }: ImageUploadProps) {
  const context = useQuestContext();
  const { actionService } = useActionService();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const isDM = context.User.Role === 'dm';

  const handleFileSelect = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      setUploadState('error');
      setTimeout(() => {
        setUploadState('idle');
        setError(null);
      }, 3000);
      return;
    }

    setError(null);
    setUploadState('processing');

    try {
      // Compress the image
      const { blob, width, height, mimeType } = await ImageActions.compressImage(file);

      // Verify size after compression
      if (blob.size > 1024 * 1024) {
        throw new Error(`Image is too large (${(blob.size / 1024 / 1024).toFixed(2)} MB). Maximum size is 1 MB.`);
      }

      if (isDM) {
        // DM: Store directly
        setUploadState('uploading');
        
        const image: Image = {
          Id: crypto.randomUUID(),
          Name: file.name.replace(/\.[^/.]+$/, ''), // Remove extension
          FileSize: blob.size,
          MimeType: mimeType,
          Width: width,
          Height: height
        };

        // Save to IndexedDB
        await IndexedDBUtilities.save(image.Id, blob);

        // Add to campaign via action service
        if (actionService) {
          actionService.execute('image:create', { image });
        }

        // Return the image ID to the form
        onChange(image.Id);
        setUploadState('idle');
      } else {
        // Player: Send to DM
        setUploadState('uploading');

        if (!actionService) {
          throw new Error('Not connected to game session');
        }

        const imageService = (actionService as any).imageService;
        if (!imageService) {
          throw new Error('Image service not available');
        }

        // Upload to DM and wait for response
        const image = await imageService.uploadImage(file, file.name.replace(/\.[^/.]+$/, ''));

        // Return the image ID to the form
        onChange(image.Id);
        setUploadState('idle');
      }
    } catch (err) {
      console.error('[ImageUpload] Upload failed:', err);
      setError(err instanceof Error ? err.message : 'Upload failed');
      setUploadState('error');
      
      // Reset after showing error
      setTimeout(() => {
        setUploadState('idle');
        setError(null);
      }, 5000);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    if (readOnly) return;

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!readOnly) {
      setDragOver(true);
    }
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleClear = () => {
    onChange(undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleBrowse = () => {
    fileInputRef.current?.click();
  };

  // Show current image if value exists
  if (value && uploadState === 'idle') {
    return (
      <div className="space-y-2">
        <div className="relative w-full h-48 bg-base-200 rounded-lg overflow-hidden">
          <ImageDisplay 
            imageId={value}
            className="w-full h-full object-contain"
            alt="Selected image"
          />
        </div>
        
        {!readOnly && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleBrowse}
              className="btn btn-sm btn-primary flex-1"
            >
              Change Image
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="btn btn-sm btn-outline btn-error"
            >
              Clear
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileInputChange}
          className="hidden"
        />
      </div>
    );
  }

  // Show upload area
  return (
    <div className="space-y-2">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          border-2 border-dashed rounded-lg p-8
          flex flex-col items-center justify-center
          transition-colors cursor-pointer min-h-[200px]
          ${dragOver ? 'border-primary bg-primary/10' : 'border-base-300'}
          ${readOnly ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary'}
          ${uploadState === 'processing' || uploadState === 'uploading' ? 'cursor-wait' : ''}
        `}
        onClick={!readOnly && uploadState === 'idle' ? handleBrowse : undefined}
      >
        {uploadState === 'idle' && (
          <>
            <span className="icon-[mdi--cloud-upload] w-12 h-12 mb-2 opacity-50"></span>
            <p className="text-sm font-medium mb-1">
              Drop an image here or click to browse
            </p>
            <p className="text-xs opacity-60">
              Max 1 MB, up to 2048px. JPEG/GIF supported.
            </p>
          </>
        )}

        {uploadState === 'processing' && (
          <>
            <span className="loading loading-spinner loading-lg mb-2"></span>
            <p className="text-sm font-medium">Processing image...</p>
          </>
        )}

        {uploadState === 'uploading' && (
          <>
            <span className="loading loading-spinner loading-lg mb-2"></span>
            <p className="text-sm font-medium">
              {isDM ? 'Saving...' : 'Uploading to DM...'}
            </p>
          </>
        )}

        {uploadState === 'error' && error && (
          <>
            <span className="icon-[mdi--alert-circle] w-12 h-12 mb-2 text-error"></span>
            <p className="text-sm font-medium text-error mb-1">Upload Failed</p>
            <p className="text-xs text-error/80 text-center">{error}</p>
          </>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileInputChange}
        disabled={readOnly || uploadState !== 'idle'}
        className="hidden"
      />
    </div>
  );
}