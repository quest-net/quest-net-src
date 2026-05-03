import { IndexedDBUtilities } from "../../utils/IndexedDBUtilities";

export interface ImageBlobLoaderOptions {
	isDM: boolean;
	imageService?: {
		getImage(imageId: string): Promise<Blob | null>;
	} | null;
}

export async function loadImageBlob(
	imageId: string,
	{ isDM, imageService }: ImageBlobLoaderOptions
): Promise<Blob | null> {
	const cached = await IndexedDBUtilities.load(imageId);
	if (cached) {
		return cached.data as Blob;
	}

	if (isDM || !imageService) {
		return null;
	}

	return imageService.getImage(imageId);
}
