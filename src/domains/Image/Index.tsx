// domains/Image/Index.tsx

import { useState } from 'react';
import { useQuestContext } from '../Context/ContextProvider';
import { useActionService } from '../../services/Actions/ActionServiceProvider';
import { CampaignActions } from '../Campaign/CampaignActions';
import { ImageUpload } from '../../components/inputs/ImageUpload';
import { ImageDisplay } from './ImageDisplay';

export function ImageIndex() {
  const context = useQuestContext();
  const { actionService } = useActionService();
  const campaign = CampaignActions.getActiveCampaign(context);
  
  const [uploadingImageId, setUploadingImageId] = useState<string | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const isDM = context.User.Role === 'dm';

  // Filter images by search query
  const filteredImages = campaign.Images.filter(image =>
    image.Name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleUploadComplete = () => {
    setUploadingImageId(undefined);
  };

  const handleDelete = (imageId: string, imageName: string) => {
    if (!actionService) return;
    
    if (!window.confirm(`Delete "${imageName}"?`)) {
      return;
    }

    actionService.execute('image:delete', { imageId });

    // Close modal if we're viewing the deleted image
    if (selectedImage === imageId) {
      setSelectedImage(null);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold">Image Library</h2>
        <p className="text-base-content/60">Manage campaign images</p>
      </div>

      {/* Upload Section */}
      <div className="card border-2 bg-base-100">
        <div className="card-body">
          <h3 className="text-lg font-semibold mb-2">Upload New Image</h3>
          <ImageUpload 
            value={uploadingImageId}
            onChange={handleUploadComplete}
          />
        </div>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Search images by name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input input-bordered flex-1"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="btn btn-ghost"
            aria-label="Clear search"
          >
            <span className="icon-[mdi--close] w-5 h-5" />
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="stats shadow">
        <div className="stat">
          <div className="stat-title">Total Images</div>
          <div className="stat-value text-2xl">{campaign.Images.length}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Showing</div>
          <div className="stat-value text-2xl">{filteredImages.length}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Total Size</div>
          <div className="stat-value text-2xl">
            {formatFileSize(campaign.Images.reduce((sum, img) => sum + img.FileSize, 0))}
          </div>
        </div>
      </div>

      {/* Image Grid */}
      {filteredImages.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-base-300 rounded-lg">
          <span className="icon-[mdi--image-off] w-16 h-16 opacity-30 inline-block mb-4"></span>
          <p className="text-xl mb-2">
            {searchQuery ? 'No images match your search' : 'No images yet'}
          </p>
          <p className="text-base-content/60">
            {searchQuery ? 'Try a different search term' : 'Upload an image to get started'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredImages.map(image => (
            <div
              key={image.Id}
              className="card bg-base-100 border-2 border-base-300 hover:border-primary transition-colors"
            >
              {/* Image Preview */}
              <figure 
                className="px-4 pt-4 cursor-pointer"
                onClick={() => setSelectedImage(image.Id)}
              >
                <div className="w-full h-32 bg-base-200 rounded-lg overflow-hidden flex items-center justify-center">
                  <ImageDisplay
                    imageId={image.Id}
                    className="w-full h-full object-contain"
                    alt={image.Name}
                  />
                </div>
              </figure>

              {/* Image Info */}
              <div className="card-body">
                <h3 className="card-title text-sm truncate" title={image.Name}>
                  {image.Name}
                </h3>
                
                <div className="text-xs space-y-1 opacity-70">
                  <div className="flex justify-between">
                    <span>Size:</span>
                    <span className="font-mono">{formatFileSize(image.FileSize)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Dimensions:</span>
                    <span className="font-mono">{image.Width}×{image.Height}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Format:</span>
                    <span className="font-mono">{image.MimeType.split('/')[1].toUpperCase()}</span>
                  </div>
                </div>

                {/* Actions */}
                {isDM && (
                  <div className="card-actions justify-end mt-2">
                    <button
                      onClick={() => handleDelete(image.Id, image.Name)}
                      className="btn btn-error btn-sm btn-outline w-full"
                    >
                      <span className="icon-[mdi--delete] w-4 h-4 mr-1" />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full Size Image Modal */}
      {selectedImage && (
        <div className="modal modal-open">
          <div className="modal-box max-w-4xl">
            <button
              onClick={() => setSelectedImage(null)}
              className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
            >
              ✕
            </button>
            
            <h3 className="font-bold text-lg mb-4">
              {campaign.Images.find(img => img.Id === selectedImage)?.Name}
            </h3>
            
            <div className="w-full bg-base-200 rounded-lg overflow-hidden flex items-center justify-center max-h-[70vh]">
              <ImageDisplay
                imageId={selectedImage}
                className="w-full h-full object-contain"
                alt="Full size preview"
              />
            </div>

            <div className="modal-action">
              <button onClick={() => setSelectedImage(null)} className="btn">
                Close
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setSelectedImage(null)}></div>
        </div>
      )}
    </div>
  );
}