// services/imageGenerationProviders/types.ts

/**
 * Credentials passed to a provider's generate() call.
 * Most providers only need apiKey; Kling additionally requires apiSecret.
 */
export interface ImageProviderCredentials {
  /** Primary API key (all providers) */
  apiKey: string;
  /** Secondary secret key — only required by providers where requiresSecret is true (e.g. Kling) */
  apiSecret?: string;
}

/** The result of a successful image generation call */
export interface GeneratedImageResult {
  blob: Blob;
  mimeType: string;
}

/**
 * Contract every image generation provider module must implement.
 * Each provider file exports a single object conforming to this interface.
 */
export interface ImageGenerationProvider {
  /** Stable unique ID, e.g. "google-gemini-flash". Never change this once persisted. */
  readonly id: string;
  /** Human-readable label shown in the UI dropdown */
  readonly displayName: string;
  /** Label for the primary key input, e.g. "API Key" or "Access Key" */
  readonly apiKeyLabel: string;
  /** Placeholder hint for the primary key input */
  readonly apiKeyPlaceholder?: string;
  /** Whether this provider requires a secondary secret key (currently only Kling) */
  readonly requiresSecret: boolean;
  /** Label for the secondary key input — only relevant when requiresSecret is true */
  readonly apiSecretLabel?: string;
  /** One-line description shown below the key field(s) in settings */
  readonly description: string;
  /** URL to the provider's API key / developer portal page */
  readonly docsUrl: string;

  /**
   * Generate an image from a fully-expanded prompt string.
   * Must return a Blob of the image bytes and its MIME type.
   */
  generate(
    prompt: string,
    credentials: ImageProviderCredentials
  ): Promise<GeneratedImageResult>;
}
