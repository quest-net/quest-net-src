// domains/Image/ImageActions.ts

import { Context } from "../Context/Context";
import type { Image } from "./Image";
import { CampaignActions } from "../Campaign/CampaignActions";
import { IndexedDBUtilities } from "../../utils/IndexedDBUtilities";
import { LogActions } from "../Log/LogActions";

const MAX_IMAGE_SIZE = 1024 * 1024; // 1 MB
const MAX_DIMENSION = 2048; // Max width or height
const JPEG_QUALITY = 0.85; // Fixed quality for JPEG compression

/**
 * Image action handlers and utilities
 */
export const ImageActions = {
  
  /**
   * Creates a new image: compresses, stores in IndexedDB, adds to campaign
   */
  async create(params: { file: File; name?: string }, context: Context): Promise<Image> {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    // Compress and convert the image
    const { blob, width, height, mimeType } = await this.compressImage(params.file);
    
    // Verify size
    if (blob.size > MAX_IMAGE_SIZE) {
      throw new Error(`Image is too large (${(blob.size / 1024 / 1024).toFixed(2)} MB). Maximum size is 1 MB.`);
    }
    
    // Create Image metadata
    const image: Image = {
      Id: crypto.randomUUID(),
      Name: params.name || params.file.name.replace(/\.[^/.]+$/, ''), // Remove extension
      FileSize: blob.size,
      MimeType: mimeType,
      Width: width,
      Height: height
    };
    
    // Store binary data in IndexedDB
    await IndexedDBUtilities.save(image.Id, blob);
    
    // Add to campaign catalog
    campaign.Images.push(image);
    
    LogActions.create({
      action: 'Image uploaded',
      details: `${image.Name} (${(image.FileSize / 1024).toFixed(1)} KB)`,
      category: 'system',
      level: 'info',
      visibility: ['dm']
    }, context);
    
    return image;
  },
  
  /**
   * Deletes an image from catalog and IndexedDB
   */
  async delete(params: { imageId: string }, context: Context): Promise<void> {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    const index = campaign.Images.findIndex(img => img.Id === params.imageId);
    if (index === -1) {
      console.warn(`Image not found: ${params.imageId}`);
      return;
    }
    
    const image = campaign.Images[index];
    
    // Remove from catalog
    campaign.Images.splice(index, 1);
    
    // Remove from IndexedDB
    await IndexedDBUtilities.remove(params.imageId);
    
    LogActions.create({
      action: 'Image deleted',
      details: image.Name,
      category: 'system',
      level: 'info',
      visibility: ['dm']
    }, context);
  },
  
  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================
  
  /**
   * Compresses and converts an image file
   * GIFs remain GIFs (with animation), everything else becomes JPEG
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