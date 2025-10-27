// domains/Image/ImageActions.ts

import { Context } from "../Context/Context";
import type { Image } from "./Image";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";

const MAX_IMAGE_SIZE = 1024 * 1024; // 1 MB
const MAX_DIMENSION = 2048; // Max width or height
const JPEG_QUALITY = 0.85; // Fixed quality for JPEG compression

/**
 * Image action handlers and utilities
 */
export const ImageActions = {
  
  /**
   * Adds an image to the campaign catalog (metadata only)
   * NOTE: Image blob should already be stored in IndexedDB before calling this
   */
  create(params: { image: Image }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    // Simply add the image metadata to the campaign
    campaign.Images.push(params.image);
    
    LogActions.create({
      action: 'Image added',
      details: `${params.image.Name} (${(params.image.FileSize / 1024).toFixed(1)} KB)`,
      category: 'system',
      level: 'info',
      visibility: ['dm']
    }, context);
  },

  /**
   * Adds multiple images to the campaign catalog in one operation
   * More efficient than individual creates - single log entry, single state sync
   * NOTE: Image blobs should already be stored in IndexedDB before calling this
   */
  bulkCreate(params: { images: Image[] }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    // Add all images at once
    campaign.Images.push(...params.images);
    
    // Calculate total size for log
    const totalSize = params.images.reduce((sum, img) => sum + img.FileSize, 0);
    
    // Single log entry for the entire bulk operation
    LogActions.create({
      action: 'Images uploaded',
      details: `${params.images.length} image(s) added (${(totalSize / 1024).toFixed(1)} KB total)`,
      category: 'system',
      level: 'info',
      visibility: ['dm']
    }, context);
  },
  
  /**
   * Removes an image from the campaign catalog (metadata only)
   * NOTE: IndexedDB cleanup should be handled separately by the service layer
   */
  delete(params: { imageId: string }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    const index = campaign.Images.findIndex(img => img.Id === params.imageId);
    if (index === -1) {
      console.warn(`Image not found: ${params.imageId}`);
      return;
    }
    
    const image = campaign.Images[index];
    campaign.Images.splice(index, 1);
    
    LogActions.create({
      action: 'Image removed',
      details: image.Name,
      category: 'system',
      level: 'info',
      visibility: ['dm']
    }, context);
  },
  
  /**
   * Edits image metadata
   */
  edit(params: { imageId: string; updates: Partial<Image> }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    const image = campaign.Images.find(img => img.Id === params.imageId);
    if (!image) {
      console.warn(`Image not found: ${params.imageId}`);
      return;
    }
    
    Object.assign(image, params.updates);
    
    LogActions.create({
      action: 'Image updated',
      details: image.Name,
      category: 'system',
      level: 'info',
      visibility: ['dm']
    }, context);
  },

  /**
   * Bulk edit tags for multiple images
   * More efficient than individual edits - single log entry, single state sync
   */
  bulkEditTags(
    params: { updates: Array<{ imageId: string; tags: string[] }> },
    context: Context
  ): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    let successCount = 0;
    
    // Apply all updates
    params.updates.forEach(update => {
      const image = campaign.Images.find(img => img.Id === update.imageId);
      
      if (image) {
        image.Tags = update.tags;
        successCount++;
      } else {
        console.warn(`Image not found for bulk update: ${update.imageId}`);
      }
    });
    
    // Single log entry for the entire bulk operation
    LogActions.create({
      action: 'Images organized',
      details: `Updated tags for ${successCount} image(s)`,
      category: 'system',
      level: 'info',
      visibility: ['dm']
    }, context);
  },
  
  // ============================================================================
  // UTILITY FUNCTIONS (Not actions - for use by service layer)
  // ============================================================================
  
  /**
   * Compresses and converts an image file
   * GIFs remain GIFs (with animation), everything else becomes JPEG
   * This is a utility function, not an action
   */
  async compressImage(file: File): Promise<{
    blob: Blob;
    width: number;
    height: number;
    mimeType: string;
  }> {
    const isGif = file.type === 'image/gif';
    
    if (isGif) {
      return this.processGif(file);
    } else {
      return this.compressToJpeg(file);
    }
  },
  
  /**
   * Compresses to JPEG (or converts other formats to JPEG)
   */
  async compressToJpeg(file: File): Promise<{
    blob: Blob;
    width: number;
    height: number;
    mimeType: string;
  }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      
      img.onload = () => {
        // Calculate new dimensions
        let { width, height } = this.calculateDimensions(img.width, img.height);
        
        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        
        // Draw and compress
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Failed to compress image'));
              return;
            }
            resolve({ blob, width, height, mimeType: 'image/jpeg' });
          },
          'image/jpeg',
          JPEG_QUALITY
        );
      };
      
      img.onerror = () => reject(new Error('Failed to load image'));
      reader.onerror = () => reject(new Error('Failed to read file'));
      
      reader.readAsDataURL(file);
    });
  },
  
  /**
   * Processes a GIF file
   * Keeps animation intact, but validates size and dimensions
   */
  async processGif(file: File): Promise<{
    blob: Blob;
    width: number;
    height: number;
    mimeType: string;
  }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      
      img.onload = () => {
        const width = img.width;
        const height = img.height;
        
        // Check dimensions
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          reject(new Error(
            `GIF dimensions too large (${width}x${height}). ` +
            `Maximum dimension is ${MAX_DIMENSION}px. ` +
            `Please resize the GIF before uploading.`
          ));
          return;
        }
        
        // Check size
        if (file.size > MAX_IMAGE_SIZE) {
          reject(new Error(
            `GIF file too large (${(file.size / 1024 / 1024).toFixed(2)} MB). ` +
            `Maximum size is 1 MB.`
          ));
          return;
        }
        
        // Return the original GIF blob (preserves animation)
        resolve({
          blob: file,
          width,
          height,
          mimeType: 'image/gif'
        });
      };
      
      img.onerror = () => reject(new Error('Failed to load GIF'));
      reader.onerror = () => reject(new Error('Failed to read file'));
      
      reader.readAsDataURL(file);
    });
  },
  
  /**
   * Calculates dimensions respecting max size while maintaining aspect ratio
   */
  calculateDimensions(width: number, height: number): { width: number; height: number } {
    if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
      return { width, height };
    }
    
    const ratio = width / height;
    
    if (width > height) {
      return {
        width: MAX_DIMENSION,
        height: Math.round(MAX_DIMENSION / ratio)
      };
    } else {
      return {
        width: Math.round(MAX_DIMENSION * ratio),
        height: MAX_DIMENSION
      };
    }
  }
};