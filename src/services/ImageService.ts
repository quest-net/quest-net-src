// services/ImageService.ts

import { IndexedDBUtilities } from "../utils/IndexedDBUtilities";
import { Room, type ActionRequest } from "../domains/Room/Room";
import { compressImage } from "../utils/ImageUtils";
import { Image } from "../domains/Image/Image";

const IMAGE_REQUEST_TIMEOUT_MS = 30000;
const MAX_IMAGE_BYTES = 1024 * 1024;

interface ImageUploadMetadata {
	name: string;
	width: number;
	height: number;
	mimeType: string;
	fileSize: number;
	userId?: string;
	cutout?: boolean;
}

/**
 * Manages image binary transfer between peers.
 *
 * The DM is the image authority: it holds every blob in IndexedDB and serves
 * them on demand. Two Trystero `kind: "request"` actions carry the traffic,
 * each targeted at the DM's peerId:
 *
 *   - imgFetch:  player asks for an imageId, DM responds with the ArrayBuffer.
 *   - imgUpload: player sends compressed bytes + metadata, DM stores them and
 *                responds with the created Image record.
 *
 * Trystero owns request/response correlation, per-request timeouts, and
 * binary chunking, so this service only adds local caching and dedup of
 * concurrent fetches for the same image.
 */
export class ImageService {
	private room: Room;
	private isDM: boolean;
	private actionExecute: (actionKey: string, params: any) => void;
	private getDmPeerId: () => string | undefined;

	// Dedup concurrent fetches for the same image (e.g. several components
	// rendering the same portrait at once).
	private pendingRequests = new Map<string, Promise<Blob | null>>();

	private requestImage!: ActionRequest; // imageId -> ArrayBuffer
	private requestUpload!: ActionRequest; // ArrayBuffer + metadata -> Image

	constructor(
		room: Room,
		isDM: boolean,
		getDmPeerId: () => string | undefined,
		actionExecute: (actionKey: string, params: any) => void = () => {}
	) {
		this.room = room;
		this.isDM = isDM;
		this.getDmPeerId = getDmPeerId;
		this.actionExecute = actionExecute;
		this.setupChannels();
	}

	private setupChannels() {
		// Download: player requests an image by id, DM serves the bytes.
		const imgFetch = this.room.makeAction<any, any>("imgFetch", {
			kind: "request",
			onRequest: this.isDM
				? (imageId) => this.serveImage(imageId as string)
				: undefined,
		});
		this.requestImage = imgFetch.request;

		// Upload: player sends bytes + metadata, DM stores and returns the Image.
		const imgUpload = this.room.makeAction<any, any>("imgUpload", {
			kind: "request",
			onRequest: this.isDM
				? (data, { metadata }) =>
						this.storeUpload(
							data as ArrayBuffer,
							metadata as unknown as ImageUploadMetadata
						)
				: undefined,
		});
		this.requestUpload = imgUpload.request;
	}

	/**
	 * Player uploads an image to the DM and resolves with the created Image.
	 */
	async uploadImage(file: File, name?: string, userId?: string): Promise<Image> {
		if (this.isDM) {
			throw new Error("DM should use ImageActions.create directly");
		}

		const dmPeerId = this.getDmPeerId();
		if (!dmPeerId) {
			throw new Error("Cannot upload: not connected to the DM");
		}

		const { blob, width, height, mimeType, cutout } =
			await compressImage(file);

		if (blob.size > MAX_IMAGE_BYTES) {
			throw new Error(
				`Image is too large (${(blob.size / 1024 / 1024).toFixed(
					2
				)} MB). Maximum size is 1 MB.`
			);
		}

		const arrayBuffer = await blob.arrayBuffer();

		// request() resolves with the DM's created Image, or rejects on
		// timeout / disconnect / handler error.
		return (await this.requestUpload(arrayBuffer, {
			target: dmPeerId,
			timeoutMs: IMAGE_REQUEST_TIMEOUT_MS,
			metadata: {
				name: name || file.name.replace(/\.[^/.]+$/, ""),
				width,
				height,
				mimeType,
				fileSize: blob.size,
				userId,
				cutout: cutout || undefined,
			},
		})) as Image;
	}

	/**
	 * DM stores an uploaded image and returns the created Image record. Throws
	 * propagate back to the uploading player as a rejected request().
	 */
	private async storeUpload(
		data: ArrayBuffer,
		metadata: ImageUploadMetadata
	): Promise<Image> {
		const image: Image = {
			Id: crypto.randomUUID(),
			Name: metadata.name,
			FileSize: metadata.fileSize,
			MimeType: metadata.mimeType,
			Width: metadata.width,
			Height: metadata.height,
			Cutout: metadata.cutout || undefined,
			UploadedBy: metadata.userId,
		};

		await IndexedDBUtilities.save(image.Id, new Blob([data]));
		this.actionExecute("image:create", { image });
		return image;
	}

	/**
	 * Gets an image blob from cache, or fetches it from the DM on demand.
	 */
	async getImage(imageId: string): Promise<Blob | null> {
		const cached = await IndexedDBUtilities.load(imageId);
		if (cached) {
			return cached.data as Blob;
		}

		// The DM is the authority — if it's missing locally, no one has it.
		if (this.isDM) {
			console.warn(`[ImageService] DM missing image ${imageId} in IndexedDB`);
			return null;
		}

		const existing = this.pendingRequests.get(imageId);
		if (existing) return existing;

		const promise = this.fetchFromDM(imageId);
		this.pendingRequests.set(imageId, promise);
		promise.finally(() => this.pendingRequests.delete(imageId));
		return promise;
	}

	/**
	 * Player fetches an image's bytes from the DM and caches them.
	 */
	private async fetchFromDM(imageId: string): Promise<Blob | null> {
		const dmPeerId = this.getDmPeerId();
		if (!dmPeerId) {
			console.warn(`[ImageService] No DM peer to request image ${imageId} from`);
			return null;
		}

		try {
			const arrayBuffer = (await this.requestImage(imageId, {
				target: dmPeerId,
				timeoutMs: IMAGE_REQUEST_TIMEOUT_MS,
			})) as ArrayBuffer;
			const blob = new Blob([arrayBuffer]);
			await IndexedDBUtilities.save(imageId, blob);
			return blob;
		} catch (error) {
			console.warn(`[ImageService] Failed to fetch image ${imageId}:`, error);
			return null;
		}
	}

	/**
	 * DM serves an image's bytes by id. Throws if absent so the requesting
	 * player's request() rejects rather than hanging.
	 */
	private async serveImage(imageId: string): Promise<ArrayBuffer> {
		const cached = await IndexedDBUtilities.load(imageId);
		if (!cached) {
			throw new Error(`Image ${imageId} not found`);
		}
		return (cached.data as Blob).arrayBuffer();
	}
}
