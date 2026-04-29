// services/ImageGenerationService.ts
//
// Orchestrator for multi-provider AI image generation.
//
// This module:
//   - Holds the PROVIDER_REGISTRY (all supported providers)
//   - Provides fillPromptTemplate() (provider-agnostic)
//   - Routes generateImageFromPrompt() calls to the correct child provider
//
// To add a new provider: create a file in imageGenerationProviders/,
// implement ImageGenerationProvider, then add it to PROVIDER_REGISTRY below.

import { GoogleGeminiFlashProvider } from "./imageGenerationProviders/GoogleGeminiFlashProvider";
import { OpenAIGPTImageProvider } from "./imageGenerationProviders/OpenAIGPTImageProvider";
import { KlingProvider } from "./imageGenerationProviders/KlingProvider";
import { Flux2ProProvider } from "./imageGenerationProviders/Flux2ProProvider";

export type {
  ImageGenerationProvider,
  ImageProviderCredentials,
  GeneratedImageResult,
} from "./imageGenerationProviders/types";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const PROVIDER_REGISTRY = [
  GoogleGeminiFlashProvider,
  OpenAIGPTImageProvider,
  Flux2ProProvider,
  KlingProvider,
] as const;

export const DEFAULT_PROVIDER_ID = GoogleGeminiFlashProvider.id;

export function getProvider(id: string) {
  return PROVIDER_REGISTRY.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// Prompt template utilities (provider-agnostic)
// ---------------------------------------------------------------------------

export interface ImagePromptContext {
  objectType?: string;
  name?: string;
  description?: string;
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

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

export async function generateImageFromPrompt(options: {
  providerId: string;
  prompt: string;
  credentials: { apiKey: string; apiSecret?: string };
}) {
  const { providerId, prompt, credentials } = options;

  if (!credentials.apiKey?.trim()) {
    throw new Error("Image generation API key is missing.");
  }

  if (!prompt.trim()) {
    throw new Error("Image generation prompt is empty.");
  }

  const provider = getProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown image generation provider: "${providerId}".`);
  }

  return provider.generate(prompt, credentials);
}
