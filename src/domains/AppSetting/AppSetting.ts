import type { MapCameraMode } from "../../utils/camera/CameraModes";

export interface AppSettings {
  theme: "light" | "dark"; // I haven't implemented this yet
  volume: number; // percentage. This is used when a player may want a different volume than the DM chose
  sfxVolume?: number; // 0-1. Sound effects volume (stickers, etc.), separate from music
  preserveFlyingHeightOnTileMove?: boolean;
  performanceMode?: boolean;
  /** Unified map camera mode. `freecam` is DM-only; actor modes need a
   *  controlled actor to anchor to. Device-local (not profile-synced) — camera
   *  choice can reasonably differ per device. */
  cameraMode?: MapCameraMode;
  /** When false, natural crits show as normal log alerts instead of the full-screen splash. Defaults to enabled. */
  critSplashEnabled?: boolean;
  /** When false, disables the hero-occlusion cutout that reveals the focused actor behind terrain. Defaults to enabled. */
  heroOcclusionEnabled?: boolean;
  /** World-space radius of the focused-actor terrain cutout. Roughly one unit per tactical tile. */
  heroOcclusionRadius?: number;
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

/**
 * The UI exposes four friendly stops, while persistence stores the actual
 * world-space value so hand-edited/custom radii remain representable.
 */
export const HERO_OCCLUSION_RADIUS_SETTING = {
  DEFAULT: 1.25,
  MIN: 1.25,
  MAX: 10,
  PRESETS: [
    { label: "Tight", value: 1.25 },
    { label: "Small", value: 2.5 },
    { label: "Medium", value: 4 },
    { label: "Wide", value: 6 },
  ],
} as const;

export const DEFAULT_IMAGE_PROMPT =
  'Produce a square image that will serve as an icon for a {ObjectType} ' +
  'with name: {ObjectName} and description: {ObjectDescription}. ' +
  'White background, no text, fantasy illustration style.';
