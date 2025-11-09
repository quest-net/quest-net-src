// services/ImageService.ts

import { IndexedDBUtilities } from "../utils/IndexedDBUtilities";
import { Room } from "../domains/Room/Room";
import { ImageActions } from "../domains/Image/ImageActions";
import { Image } from "../domains/Image/Image";

/**
 * Manages image data transfer between peers
 * Handles caching and request deduplication
 */
export class ImageService {
	private room: Room;
	private isDM: boolean;
	private actionExecute: (actionKey: string, params: any) => void;

	// Track pending requests to avoid duplicates
	private pendingRequests = new Map<string, Promise<Blob>>();

	// Track pending uploads for players
	private pendingUploads = new Map<string, Promise<Image>>();

	// Trystero action functions
	private sendImageData!: (
		data: ArrayBuffer,
		peerId: string,
		metadata: { imageId: string }
	) => void;
	private requestImageData!: (imageId: string) => void;
	private sendImageUpload!: (
		data: ArrayBuffer,
		targetPeers: string | null,
		metadata: {
			name: string;
			width: number;
			height: number;
			mimeType: string;
			fileSize: number;
			uploadId: string;
			userId?: string;
		}
	) => void;
	private sendImageCreated!: (
		data: {
			uploadId: string;
			imageId: string;
			name: string;
			fileSize: number;
			mimeType: string;
			width: number;
			height: number;
		},
		peerId: string
	) => void;

	constructor(
		room: Room,
		isDM: boolean,
		actionExecute: (actionKey: string, params: any) => void = () => {}
	) {
		this.room = room;
		this.isDM = isDM;
		this.actionExecute = actionExecute;
		this.setupChannels();
	}

	private setupChannels() {
		// Channel for players requesting images from DM
		const [sendRequest, getRequest] = this.room.makeAction("imgReq");
		this.requestImageData = sendRequest;

		// Channel for DM sending image data to players
		const [sendData, getData] = this.room.makeAction("imgData");
		this.sendImageData = sendData;

		// Channel for players uploading images to DM
		const [sendUpload, getUpload] = this.room.makeAction("imgUpload");
		this.sendImageUpload = sendUpload as any;

		// Channel for DM confirming image creation to player
		const [sendCreated, getCreated] = this.room.makeAction("imgCreated");
		this.sendImageCreated = sendCreated as any;

		if (this.isDM) {
			// DM listens for image requests
			getRequest((data, peerId) => {
				const imageId = data as string;
				this.handleImageRequest(imageId, peerId);
			});

			// DM listens for player uploads
			getUpload((data, peerId, metadata) => {
				const arrayBuffer = data as ArrayBuffer;
				const meta = metadata as any;
				this.handlePlayerUpload(arrayBuffer, meta, meta.uploadId, peerId);
			});
		} else {
			// Players listen for image data
			getData((data, _peerId, metadata) => {
				const arrayBuffer = data as ArrayBuffer;
				const { imageId } = metadata as any;
				this.handleImageData(arrayBuffer, imageId);
			});

			// Players listen for upload confirmations
			getCreated((data, _peerId) => {
				const meta = data as any;
				this.handleUploadConfirmation(meta.uploadId, {
					Id: meta.imageId,
					Name: meta.name,
					FileSize: meta.fileSize,
					MimeType: meta.mimeType,
					Width: meta.width,
					Height: meta.height,
				});
			});
		}
	}

	/**
	 * Player uploads an image to the DM
	 */
	async uploadImage(file: File, name?: string, userId?: string): Promise<Image> {
		if (this.isDM) {
			throw new Error("DM should use ImageActions.create directly");
		}

		// Generate unique upload ID to track this upload
		const uploadId = crypto.randomUUID();

		const promise = this.processAndUpload(
			file,
			name || file.name.replace(/\.[^/.]+$/, ""),
			uploadId,
			userId
		);
		this.pendingUploads.set(uploadId, promise);

		promise.finally(() => {
			this.pendingUploads.delete(uploadId);
		});

		return promise;
	}

	/**
	 * Process the image and send to DM
	 */
	private async processAndUpload(
		file: File,
		name: string,
		uploadId: string,
		userId?: string
	): Promise<Image> {
		return new Promise(async (resolve, reject) => {
			try {
				// Process the image using ImageActions helper
				const { blob, width, height, mimeType } =
					await ImageActions.compressImage(file);

				// Verify size
				if (blob.size > 1024 * 1024) {
					throw new Error(
						`Image is too large (${(blob.size / 1024 / 1024).toFixed(
							2
						)} MB). Maximum size is 1 MB.`
					);
				}

				// Convert to ArrayBuffer
				const arrayBuffer = await blob.arrayBuffer();

				// Set up timeout
				const timeout = setTimeout(() => {
					reject(new Error(`Timeout waiting for upload confirmation`));
				}, 30000);

				// Store resolve/reject for confirmation handler
				(this as any)[`_resolve_${uploadId}`] = (img: Image) => {
					clearTimeout(timeout);
					resolve(img);
				};
				(this as any)[`_reject_${uploadId}`] = (err: Error) => {
					clearTimeout(timeout);
					reject(err);
				};

				// Send to DM with metadata
				this.sendImageUpload(arrayBuffer, null, {
					name,
					width,
					height,
					mimeType,
					fileSize: blob.size,
					uploadId,
					userId,
				});

			} catch (error) {
				reject(error);
			}
		});
	}

	/**
	 * DM handles player upload
	 */
	private async handlePlayerUpload(
		data: ArrayBuffer,
		metadata: {
			name: string;
			width: number;
			height: number;
			mimeType: string;
			fileSize: number;
			userId?: string;
		},
		uploadId: string,
		peerId: string
	): Promise<void> {
		try {
			// Convert to Blob
			const blob = new Blob([data]);

			// Create Image entry
			const image: Image = {
				Id: crypto.randomUUID(),
				Name: metadata.name,
				FileSize: metadata.fileSize,
				MimeType: metadata.mimeType,
				Width: metadata.width,
				Height: metadata.height,
				UploadedBy: metadata.userId,
			};

			// Store in IndexedDB
			await IndexedDBUtilities.save(image.Id, blob);

			this.actionExecute("image:create", { image });

			// Send confirmation back to player
			this.sendImageCreated(
				{
					uploadId,
					imageId: image.Id,
					name: image.Name,
					fileSize: image.FileSize,
					mimeType: image.MimeType,
					width: image.Width,
					height: image.Height,
				},
				peerId
			);

		} catch (error) {
			console.error(`[ImageService] Error handling player upload:`, error);
		}
	}

	/**
	 * Player handles upload confirmation
	 */
	private handleUploadConfirmation(uploadId: string, image: Image): void {
		const resolve = (this as any)[`_resolve_${uploadId}`];
		if (resolve) {
			resolve(image);
			delete (this as any)[`_resolve_${uploadId}`];
			delete (this as any)[`_reject_${uploadId}`];
		}
	}

	/**
	 * Gets an image blob, either from cache or by requesting from DM
	 */
	async getImage(imageId: string): Promise<Blob | null> {
		// Check cache first
		const cached = await IndexedDBUtilities.load(imageId);
		if (cached) {
			return cached.data as Blob;
		}

		// If we're the DM, image should be in cache
		if (this.isDM) {
			console.warn(`[ImageService] DM missing image ${imageId} in IndexedDB`);
			return null;
		}

		// Check if already requesting this image
		if (this.pendingRequests.has(imageId)) {
			return this.pendingRequests.get(imageId)!;
		}

		// Request from DM
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
	private async handleImageRequest(
		imageId: string,
		peerId: string
	): Promise<void> {
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
		} catch (error) {
			console.error(`[ImageService] Error sending image ${imageId}:`, error);
		}
	}

	/**
	 * Players handle incoming image data
	 */
	private async handleImageData(
		data: ArrayBuffer,
		imageId: string
	): Promise<void> {
		try {
			// Convert ArrayBuffer to Blob
			const blob = new Blob([data]);

			// Store in IndexedDB
			await IndexedDBUtilities.save(imageId, blob);
		} catch (error) {
			console.error(`[ImageService] Error caching image ${imageId}:`, error);
		}
	}
}
