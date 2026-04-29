// services/imageGenerationProviders/utils.ts

/**
 * Converts a base64-encoded string to a Blob.
 * Shared by providers that receive base64 image data in their API responses.
 */
export function base64ToBlob(base64: string, mimeType: string): Blob {
  const atobFn =
    typeof atob === "function"
      ? atob
      : (globalThis as any).atob?.bind(globalThis);

  if (!atobFn) {
    throw new Error("Base64 decoding is not available in this environment.");
  }

  const binary = atobFn(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
}
