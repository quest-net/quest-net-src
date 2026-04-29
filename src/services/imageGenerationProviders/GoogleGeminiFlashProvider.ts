// services/imageGenerationProviders/GoogleGeminiFlashProvider.ts
//
// Google Gemini 2.5 Flash Image — a.k.a. "nano-banana".
// Uses the generateContent endpoint (multimodal Gemini API).

import type {
  ImageGenerationProvider,
  ImageProviderCredentials,
  GeneratedImageResult,
} from "./types";
import { base64ToBlob } from "./utils";

const MODEL = "gemini-2.5-flash-image";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export const GoogleGeminiFlashProvider: ImageGenerationProvider = {
  id: "google-gemini-flash",
  displayName: "Google Gemini Flash Image (nano-banana)",
  apiKeyLabel: "Google AI Studio API Key",
  apiKeyPlaceholder: "AIza...",
  requiresSecret: false,
  description: `Calls the ${MODEL} model via Google AI Studio. Fast and free-tier friendly.`,
  docsUrl: "https://aistudio.google.com/apikey",

  async generate(
    prompt: string,
    credentials: ImageProviderCredentials
  ): Promise<GeneratedImageResult> {
    const { apiKey } = credentials;

    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey.trim(),
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch {
        /* ignore */
      }
      throw new Error(
        `Gemini Flash request failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`
      );
    }

    const json: any = await response.json();
    const candidates = json?.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new Error("Gemini Flash returned no candidates.");
    }

    const parts =
      candidates[0]?.content?.parts ??
      candidates[0]?.content?.Parts ??
      [];

    const imagePart = parts.find(
      (p: any) => p?.inline_data || p?.inlineData
    );
    if (!imagePart) {
      throw new Error("No image data found in Gemini Flash response.");
    }

    const inline = imagePart.inline_data || imagePart.inlineData;
    const base64Data: string | undefined = inline?.data;
    const mimeType: string =
      inline?.mime_type || inline?.mimeType || "image/png";

    if (!base64Data) {
      throw new Error("Gemini Flash response is missing base64 data.");
    }

    return { blob: base64ToBlob(base64Data, mimeType), mimeType };
  },
};
