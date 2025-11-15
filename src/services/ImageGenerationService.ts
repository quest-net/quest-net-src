// services/ImageGenerationService.ts

/**
 * Thin wrapper around Google AI Studio's image generation (nano-banana /
 * gemini-2.5-flash-image).
 *
 * This module is intentionally dumb: it doesn't know about Context,
 * AppSettings, or IndexedDB. It just:
 *   - builds prompts from templates
 *   - calls the HTTP endpoint
 *   - returns a Blob of image bytes
 */

export const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";

export const GEMINI_IMAGE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`;

/**
 * Context used to fill the user's prompt template.
 *
 * These correspond to placeholders in the template:
 *  - {ObjectType}
 *  - {ObjectName}
 *  - {ObjectDescription}
 */
export interface ImagePromptContext {
	objectType?: string;
	name?: string;
	description?: string;
}

/**
 * Options for generating an image.
 */
export interface ImageGenerationOptions {
	/** Google AI Studio / Gemini API key */
	apiKey: string;
	/** Fully expanded text prompt (after template substitution) */
	prompt: string;
	/**
	 * Optional: number of images to request. We currently default to 1 and only
	 * use the first, but this allows some future tuning.
	 */
	numImages?: number;
}

/**
 * Result of an image generation call.
 */
export interface GeneratedImageResult {
	blob: Blob;
	mimeType: string;
}

/**
 * Fills an image generation prompt template with the provided context.
 *
 * Supported placeholders (case-insensitive):
 *  - {ObjectType}
 *  - {ObjectName}
 *  - {ObjectDescription}
 */
export function fillPromptTemplate(
	template: string,
	context: ImagePromptContext
): string {
	const { objectType = "object", name = "", description = "" } = context;

	return template
		.replace(/\{ObjectType\}/gi, objectType)
		.replace(/\{ObjectName\}/gi, name)
		.replace(/\{ObjectDescription\}/gi, description);
}

export async function generateImageFromPrompt(
	options: ImageGenerationOptions
): Promise<GeneratedImageResult> {
	const { apiKey, prompt } = options;

	if (!apiKey.trim()) {
		throw new Error("Image generation API key is missing.");
	}

	if (!prompt.trim()) {
		throw new Error("Image generation prompt is empty.");
	}

	// REST body per official docs:
	// https://ai.google.dev/gemini-api/docs/image-generation
	const requestBody = {
		contents: [
			{
				parts: [{ text: prompt }],
			},
		],
		// NOTE: We intentionally do NOT set generationConfig.samples here.
		// AI Studio's Gemini endpoint currently only supports a single candidate
		// per call, so requesting multiple images must be done by multiple calls.
	};

	const response = await fetch(GEMINI_IMAGE_ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-goog-api-key": apiKey.trim(),
		},
		body: JSON.stringify(requestBody),
	});

	if (!response.ok) {
		let detail = "";
		try {
			detail = await response.text();
		} catch {
			// ignore
		}
		throw new Error(
			`Gemini image request failed: ${response.status} ${response.statusText}${
				detail ? ` - ${detail}` : ""
			}`
		);
	}

	const json: any = await response.json();

	// Standard GenerateContent response shape:
	// { candidates: [ { content: { parts: [ { inlineData: { mimeType, data }, ... ] } } ] }
	const candidates = json?.candidates;
	if (!Array.isArray(candidates) || candidates.length === 0) {
		throw new Error("Image generation returned no candidates.");
	}

	const parts =
		candidates[0]?.content?.parts ??
		candidates[0]?.content?.Parts ??
		[];

	const imagePart = parts.find(
		(p: any) => p?.inline_data || p?.inlineData
	);

	if (!imagePart) {
		throw new Error("No image data found in generation response.");
	}

	const inline = imagePart.inline_data || imagePart.inlineData;
	const base64Data: string | undefined = inline?.data;
	const mimeType: string = inline?.mime_type || inline?.mimeType || "image/png";

	if (!base64Data) {
		throw new Error("Image part is missing base64 data.");
	}

	const blob = base64ToBlob(base64Data, mimeType);
	return { blob, mimeType };
}


/**
 * Utility: converts a base64-encoded string to a Blob.
 */
function base64ToBlob(base64: string, mimeType: string): Blob {
	// atob is available in browsers; fall back to globalThis for safety.
	const atobFn =
		typeof atob === "function"
			? atob
			: (globalThis as any).atob?.bind(globalThis);

	if (!atobFn) {
		throw new Error("Base64 decoding is not available in this environment.");
	}

	const binary = atobFn(base64);
	const len = binary.length;
	const bytes = new Uint8Array(len);

	for (let i = 0; i < len; i++) {
		bytes[i] = binary.charCodeAt(i);
	}

	return new Blob([bytes], { type: mimeType });
}
