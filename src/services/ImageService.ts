// services/ImageService.ts

import { IndexedDBUtilities } from "../utils/IndexedDBUtilities";
import { Room } from "../domains/Room/Room";

/**
 * Manages image data transfer between peers
 * Handles caching and request deduplication
 */
export class ImageService {
  private room: Room;
  private isDM: boolean;
  
  // Track pending requests to avoid duplicates
  private pendingRequests = new Map<string, Promise<Blob>>();
  
  // Trystero action functions
  private sendImageData!: (data: ArrayBuffer, peerId: string, metadata: { imageId: string }) => void;
  private requestImageData!: (imageId: string) => void;

  constructor(room: Room, isDM: boolean) {
    this.room = room;
    this.isDM = isDM;
    this.setupChannels();
  }

  private setupChannels() {
    // Channel for players requesting images from DM
    const [sendRequest, getRequest] = this.room.makeAction('imgReq');
    this.requestImageData = sendRequest;
    
    // Channel for DM sending image data to players
    const [sendData, getData] = this.room.makeAction('imgData');
    this.sendImageData = sendData;
    
    if (this.isDM) {
      // DM listens for image requests
      getRequest((data, peerId) => {
        const imageId = data as string;
        console.log(`[ImageService] DM received request for image ${imageId} from ${peerId}`);
        this.handleImageRequest(imageId, peerId);
      });
    } else {
      // Players listen for image data
      getData((data, _peerId, metadata) => {
        const arrayBuffer = data as ArrayBuffer;
        const { imageId } = metadata as { imageId: string };
        console.log(`[ImageService] Received image data for ${imageId}`);
        this.handleImageData(arrayBuffer, imageId);
      });
    }
  }

  /**
   * Gets an image blob, either from cache or by requesting from DM
   */
  async getImage(imageId: string): Promise<Blob | null> {
    // Check cache first
    const cached = await IndexedDBUtilities.load(imageId);
    if (cached) {
      console.log(`[ImageService] Image ${imageId} found in cache`);
      return cached.data as Blob;
    }
    
    // If we're the DM, image should be in cache
    if (this.isDM) {
      console.warn(`[ImageService] DM missing image ${imageId} in IndexedDB`);
      return null;
    }
    
    // Check if already requesting this image
    if (this.pendingRequests.has(imageId)) {
      console.log(`[ImageService] Image ${imageId} already being requested, waiting...`);
      return this.pendingRequests.get(imageId)!;
    }
    
    // Request from DM
    console.log(`[ImageService] Requesting image ${imageId} from DM`);
    const promise = this.requestFromDM(imageId);
    this.pendingRequests.set(imageId, promise);
    
    promise.finally(() => {
      this.pendingRequests.delete(imageId);
    });
    
    return promise;
  }

  /**
   * Requests an image from the DM
   */
  private requestFromDM(imageId: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
      // Set up one-time listener for this specific image
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for image ${imageId}`));
      }, 30000); // 30 second timeout
      
      const checkCache = setInterval(async () => {
        const cached = await IndexedDBUtilities.load(imageId);
        if (cached) {
          clearTimeout(timeout);
          clearInterval(checkCache);
          resolve(cached.data as Blob);
        }
      }, 100);
      
      // Send request to DM
      this.requestImageData(imageId);
    });
  }

  /**
   * DM handles incoming image requests
   */
  private async handleImageRequest(imageId: string, peerId: string): Promise<void> {
    try {
      const cached = await IndexedDBUtilities.load(imageId);
      if (!cached) {
        console.warn(`[ImageService] DM doesn't have image ${imageId}`);
        return;
      }
      
      const blob = cached.data as Blob;
      const arrayBuffer = await blob.arrayBuffer();
      
      // Send to requesting peer with metadata
      this.sendImageData(arrayBuffer, peerId, { imageId });
      console.log(`[ImageService] Sent image ${imageId} to ${peerId}`);
    } catch (error) {
      console.error(`[ImageService] Error sending image ${imageId}:`, error);
    }
  }

  /**
   * Players handle incoming image data
   */
  private async handleImageData(data: ArrayBuffer, imageId: string): Promise<void> {
    try {
      // Convert ArrayBuffer to Blob
      const blob = new Blob([data]);
      
      // Store in IndexedDB
      await IndexedDBUtilities.save(imageId, blob);
      console.log(`[ImageService] Cached image ${imageId}`);
    } catch (error) {
      console.error(`[ImageService] Error caching image ${imageId}:`, error);
    }
  }
}