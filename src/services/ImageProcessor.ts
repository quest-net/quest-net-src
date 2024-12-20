// src/services/ImageProcessor.ts

type ImageCategory = 'item' | 'skill' | 'character' | 'entity' | 'gallery';

interface ImageProcessingRules {
  maxWidth: number;
  maxHeight: number;
  quality: number;
}

const processingRules: Record<ImageCategory, ImageProcessingRules> = {
  item: {
    maxWidth: 256,
    maxHeight: 256,
    quality: 0.80
  },
  skill: {
    maxWidth: 256,
    maxHeight: 256,
    quality: 0.80
  },
  character: {
    maxWidth: 512,
    maxHeight: 512,
    quality: 0.9
  },
  entity: {
    maxWidth: 512,
    maxHeight: 512,
    quality: 0.85
  },
  gallery: {
    maxWidth: 1024,
    maxHeight: 1024,
    quality: 0.9
  }
};

class ImageProcessor {
  async processImage(file: File, category: ImageCategory): Promise<File> {
    const rules = processingRules[category];
    return await this.compressImage(file, rules);
  }

  private async compressImage(
    file: File,
    rules: ImageProcessingRules
  ): Promise<File> {
    return new Promise((resolve, reject) => {
      // Skip processing if not an image or if it's a GIF
      if (!file.type.startsWith('image/') || file.type === 'image/gif') {
        return resolve(file);
      }

      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      img.onload = () => {
        let { width, height } = img;
        
        // Calculate dimensions maintaining aspect ratio
        if (width > rules.maxWidth || height > rules.maxHeight) {
          const widthRatio = rules.maxWidth / width;
          const heightRatio = rules.maxHeight / height;
          const ratio = Math.min(widthRatio, heightRatio);
          
          width = width * ratio;
          height = height * ratio;
        }

        canvas.width = width;
        canvas.height = height;

        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // Draw and compress
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Failed to compress image'));
              return;
            }
            resolve(new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now()
            }));
          },
          'image/jpeg',
          rules.quality
        );
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(file);
    });
  }

  // Helper method to determine category based on context
  getCategoryFromContext(context: {
    isItem?: boolean;
    isSkill?: boolean;
    isCharacter?: boolean;
    isEntity?: boolean;
    isGallery?: boolean;
  }): ImageCategory {
    if (context.isItem) return 'item';
    if (context.isSkill) return 'skill';
    if (context.isCharacter) return 'character';
    if (context.isEntity) return 'entity';
    return 'gallery';
  }

  // Method for processing base64 images (useful for save imports)
  async processBase64Image(
    base64Data: string,
    category: ImageCategory,
    filename: string
  ): Promise<File> {
    const img = new Image();
    const rules = processingRules[category];
    
    return new Promise((resolve, reject) => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Calculate dimensions maintaining aspect ratio
        let { width, height } = img;
        if (width > rules.maxWidth || height > rules.maxHeight) {
          const widthRatio = rules.maxWidth / width;
          const heightRatio = rules.maxHeight / height;
          const ratio = Math.min(widthRatio, heightRatio);
          width = width * ratio;
          height = height * ratio;
        }
  
        canvas.width = width;
        canvas.height = height;
  
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
  
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Failed to compress image'));
              return;
            }
            resolve(new File([blob], filename, {
              type: 'image/jpeg',
              lastModified: Date.now()
            }));
          },
          'image/jpeg',
          rules.quality
        );
      };
  
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = base64Data; // Load the base64 data directly
    });
  }
}

export const imageProcessor = new ImageProcessor();