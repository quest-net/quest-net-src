export interface AppSettings {
  theme: "light" | "dark"; // I haven't implemented this yet
  volume: number; // percentage. This is used when a player may want a different volume than the DM chose
  sfxVolume?: number; // 0-1. Sound effects volume (stickers, etc.), separate from music
  preserveFlyingHeightOnTileMove?: boolean;
  performanceMode?: boolean;
  imagePromptTemplate?: string;

  /** The selected image generation provider ID (e.g. "google-gemini-flash") */
  imageService?: string;

  /**
   * Primary API keys per provider, keyed by provider ID.
   * e.g. { "google-gemini-flash": "AIza...", "openai-gpt-image": "sk-..." }
   */
  imageApiKeys?: Record<string, string>;

  /**
   * Secondary secret keys per provider, keyed by provider ID.
   * Currently only used by Kling (Access Key + Secret Key JWT auth).
   */
  imageApiSecrets?: Record<string, string>;
}

export const DEFAULT_IMAGE_PROMPT =
  'Produce a square image that will serve as an icon for a {ObjectType} ' +
  'with name: {ObjectName} and description: {ObjectDescription}. ' +
  'White background, no text, fantasy illustration style.';
