// services/imageGenerationProviders/OpenAIGPTImageProvider.ts
//
// OpenAI GPT Image — uses the /v1/images/generations endpoint.
// Defaults to gpt-image-1 (stable). Upgrade to gpt-image-2 by changing MODEL.

import type {
  ImageGenerationProvider,
  ImageProviderCredentials,
  GeneratedImageResult,
} from "./types";
import { base64ToBlob } from "./utils";

const MODEL = "gpt-image-1";
const ENDPOINT = "https://api.openai.com/v1/images/generations";

export const OpenAIGPTImageProvider: ImageGenerationProvider = {
  id: "openai-gpt-image",
  displayName: "OpenAI GPT Image",
  apiKeyLabel: "OpenAI API Key",
  apiKeyPlaceholder: "sk-...",
  requiresSecret: false,
  description: `Uses the ${MODEL} model. Excellent for complex scene composition and detailed fantasy art.`,
  docsUrl: "https://platform.openai.com/api-keys",

  async generate(
    prompt: string,
    credentials: ImageProviderCredentials
  ): Promise<GeneratedImageResult> {
    const { apiKey } = credentials;

    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        n: 1,
        size: "1024x1024",
        response_format: "b64_json",
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
        `OpenAI image request failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`
      );
    }

    const json: any = await response.json();
    const base64Data: string | undefined = json?.data?.[0]?.b64_json;
    if (!base64Data) {
      throw new Error("OpenAI response is missing image data.");
    }

    const mimeType = "image/png";
    return { blob: base64ToBlob(base64Data, mimeType), mimeType };
  },
};
