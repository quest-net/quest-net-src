// src/services/ImageManager.ts
import { GameImage } from '../types/game';
import { imageProcessor } from './ImageProcessor';

type ImageCategory = 'item' | 'skill' | 'character' | 'entity' | 'gallery';

interface StoredImage {
  id: string;
  file: File;
  thumbnail: string;
  metadata: {
    name: string;
    size: number;
    type: string;
    lastModified: number;
  };
}

interface IndexedDBImage {
  id: string;
  fileData: Blob;
  thumbnail: string;
  metadata: {
    name: string;
    size: number;
    type: string;
    lastModified: number;
  };
}

class ImageManager {
  private imageCache: Map<string, StoredImage> = new Map();
  private pendingDownloads: Map<string, Promise<File | null>> = new Map();
  private peerImageCache: Map<string, Set<string>> = new Map(); // NEW: Track which peers have which images

  private async compressImage(file: File, quality: number = 0.9): Promise<File> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      reader.onload = (e) => {
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;

          if (ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(
              (blob) => {
                if (blob) {
                  // Create new file with original name but compressed data
                  const compressedFile = new File([blob], file.name, {
                    type: 'image/jpeg',
                    lastModified: Date.now()
                  });
                  resolve(compressedFile);
                } else {
                  reject(new Error('Failed to compress image'));
                }
              },
              'image/jpeg',
              quality
            );
          } else {
            reject(new Error('Could not get canvas context'));
          }
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // NEW: Methods for peer image tracking
  markImageAsKnownByPeer(imageId: string, peerId: string) {
    if (!this.peerImageCache.has(peerId)) {
      this.peerImageCache.set(peerId, new Set());
    }
    this.peerImageCache.get(peerId)?.add(imageId);
  }

  peerHasImage(imageId: string, peerId: string): boolean {
    return this.peerImageCache.get(peerId)?.has(imageId) ?? false;
  }

  clearPeerData(peerId: string) {
    this.peerImageCache.delete(peerId);
  }

  // Add method to check if an image is currently being downloaded
  private isDownloading(imageId: string): boolean {
    return this.pendingDownloads.has(imageId);
  }

  private async openIndexedDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('ImageLibrary', 2);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        
        if (db.objectStoreNames.contains('images')) {
          db.deleteObjectStore('images');
        }
        
        const store = db.createObjectStore('images', { keyPath: 'id' });
        store.createIndex('metadata', 'metadata', { unique: false });
        store.createIndex('thumbnail', 'thumbnail', { unique: false });
      };
    });
  }
  async waitForPendingDownloads(imageIds: string[]): Promise<void> {
    const downloads = imageIds
      .map(id => this.pendingDownloads.get(id))
      .filter((promise): promise is Promise<File | null> => promise !== undefined);
      
    if (downloads.length > 0) {
      await Promise.all(downloads);
    }
  }
  async addImage(
    file: File, 
    category: 'item' | 'skill' | 'character' | 'entity' | 'gallery' = 'gallery',
    existingId?: string
  ): Promise<GameImage> {
    const imageId = existingId || crypto.randomUUID();
    
    // Process the image using ImageProcessor
    const processedFile = await imageProcessor.processImage(file, category);
    
    // Create thumbnail as before
    const thumbnail = await this.createThumbnail(processedFile);
  
    const storedImage: StoredImage = {
      id: imageId,
      file: processedFile,
      thumbnail,
      metadata: {
        name: file.name,
        size: processedFile.size,
        type: processedFile.type,
        lastModified: processedFile.lastModified
      }
    };
  
    try {
      const db = await this.openIndexedDB();
      const tx = db.transaction('images', 'readwrite');
      const store = tx.objectStore('images');
      
      const imageData = {
        id: imageId,
        fileData: processedFile,
        thumbnail,
        metadata: storedImage.metadata
      };
      
      await new Promise((resolve, reject) => {
        const request = store.add(imageData);
        request.onsuccess = () => resolve(undefined);
        request.onerror = () => reject(request.error);
      });
  
      this.imageCache.set(imageId, storedImage);
  
      return {
        id: imageId,
        name: file.name,
        description: `Uploaded image: ${file.name}`,
        createdAt: Date.now(),
        size: processedFile.size,
        type: processedFile.type,
        thumbnail,
        hash: await this.computeHash(processedFile)
      };
    } catch (err) {
      console.error('Failed to store image:', err);
      throw err;
    }
  }

  async addReceivedImage(file: File, imageData: GameImage, category: ImageCategory): Promise<GameImage> {
    try {
      // If we're already downloading this image, wait for the existing download
      if (this.isDownloading(imageData.id)) {
        await this.pendingDownloads.get(imageData.id);
        return imageData;
      }

      const downloadPromise = (async () => {
        const processedFile = await imageProcessor.processImage(file, category);

        const storedImage: StoredImage = {
          id: imageData.id,
          file: processedFile,
          thumbnail: imageData.thumbnail,
          metadata: {
            name: file.name,
            size: processedFile.size,
            type: processedFile.type,
            lastModified: Date.now()
          }
        };

        this.imageCache.set(imageData.id, storedImage);

        const db = await this.openIndexedDB();
        const tx = db.transaction('images', 'readwrite');
        const store = tx.objectStore('images');

        const imageToStore = {
          id: imageData.id,
          fileData: processedFile,
          thumbnail: imageData.thumbnail,
          metadata: storedImage.metadata
        };

        await new Promise((resolve, reject) => {
          const request = store.put(imageToStore);
          request.onsuccess = () => resolve(undefined);
          request.onerror = () => reject(request.error);
        });

        return processedFile;
      })();

      this.pendingDownloads.set(imageData.id, downloadPromise);

      try {
        await downloadPromise;
        return {
          ...imageData,
          size: file.size,
          type: file.type
        };
      } finally {
        this.pendingDownloads.delete(imageData.id);
      }

    } catch (err) {
      console.error('Failed to store received image:', err);
      throw err;
    }
  }

  async getImage(id: string): Promise<File | null> {
    const cached = this.imageCache.get(id);
    if (cached) {
      
      return cached.file;
    }
  
    

    try {
      const db = await this.openIndexedDB();
      const tx = db.transaction('images', 'readonly');
      const store = tx.objectStore('images');
      
      return new Promise((resolve, reject) => {
        const request = store.get(id);
        
        request.onsuccess = () => {
          const result = request.result as IndexedDBImage | undefined;
          if (result?.fileData) {
            const file = new File([result.fileData], result.metadata.name, {
              type: result.metadata.type,
              lastModified: result.metadata.lastModified
            });
            
            this.imageCache.set(id, {
              id,
              file,
              thumbnail: result.thumbnail,
              metadata: result.metadata
            });
            
            resolve(file);
          } else {
            resolve(null);
          }
        };
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error('Failed to load image:', err);
      return null;
    }
  }

  private async createThumbnail(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      reader.onload = (e) => {
        img.onload = () => {
          const scale = Math.min(256 / img.width, 256 / img.height);
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;

          if (ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
            resolve(thumbnail);
          } else {
            reject(new Error('Could not get canvas context'));
          }
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  private async computeHash(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async getImageData(id: string): Promise<GameImage | null> {
    const cached = this.imageCache.get(id);
    if (cached) {
      return {
        id: cached.id,
        name: cached.metadata.name,
        description: `Stored image: ${cached.metadata.name}`,
        createdAt: cached.metadata.lastModified,
        size: cached.metadata.size,
        type: cached.metadata.type,
        thumbnail: cached.thumbnail,
        hash: await this.computeHash(cached.file)
      };
    }

    try {
      const db = await this.openIndexedDB();
      const tx = db.transaction('images', 'readonly');
      const store = tx.objectStore('images');

      return new Promise((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = async () => {
          const result = request.result as IndexedDBImage | undefined;
          if (result) {
            const file = new File([result.fileData], result.metadata.name, {
              type: result.metadata.type,
              lastModified: result.metadata.lastModified
            });
            resolve({
              id: result.id,
              name: result.metadata.name,
              description: `Stored image: ${result.metadata.name}`,
              createdAt: result.metadata.lastModified,
              size: result.metadata.size,
              type: result.metadata.type,
              thumbnail: result.thumbnail,
              hash: await this.computeHash(file)
            });
          } else {
            resolve(null);
          }
        };
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error('Failed to get image data:', err);
      return null;
    }
  }

  async deleteImage(id: string): Promise<boolean> {
    try {
      const db = await this.openIndexedDB();
      const tx = db.transaction('images', 'readwrite');
      const store = tx.objectStore('images');
      
      await new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve(undefined);
        request.onerror = () => reject(request.error);
      });
      
      this.imageCache.delete(id);
      return true;
    } catch (err) {
      console.error('Failed to delete image:', err);
      return false;
    }
  }

  getThumbnail(id: string): string | undefined {
    return this.imageCache.get(id)?.thumbnail;
  }
}

export const imageManager = new ImageManager();