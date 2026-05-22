// src/utils/base64.ts
//
// Shared base64 helpers used across voxel terrain encoding, campaign
// export/import, and AI image generation providers.

const BASE64_CHUNK_SIZE = 0x8000;

/**
 * Encodes a Uint8Array to a base64 string.
 * Processes in chunks to avoid exceeding the call-stack limit on large arrays.
 */
export function bytesToBase64(bytes: Uint8Array): string {
	if (bytes.length === 0) return "";

	let binary = "";
	for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
		const chunk = bytes.subarray(i, i + BASE64_CHUNK_SIZE);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
}

/**
 * Decodes a base64 string to a Uint8Array.
 */
export function base64ToBytes(encoded: string): Uint8Array {
	if (!encoded) return new Uint8Array(0);

	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/**
 * Decodes a base64 string to a Blob with the given MIME type.
 * Used when AI image providers return base64-encoded image data, and when
 * importing campaign exports.
 */
export function base64ToBlob(base64: string, mimeType: string): Blob {
	const bytes = base64ToBytes(base64);
	return new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
}

/**
 * Converts a Blob to a base64 string (no data-URL prefix).
 * Used when exporting campaigns with embedded images.
 */
export async function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => {
			const result = reader.result as string;
			// Strip the data-URL prefix (e.g. "data:image/png;base64,")
			resolve(result.split(",")[1]);
		};
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}
