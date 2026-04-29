// domains/AppSetting/AppSettingActions.ts

import { isDmAccess } from "../../utils/UrlParser";
import { Context } from "../Context/Context";
import { ContextActions } from "../Context/ContextActions";
import { AppSettings, DEFAULT_IMAGE_PROMPT } from "./AppSetting";
import { SoundEffectService } from "../../services/SoundEffectService";
import { DEFAULT_PROVIDER_ID } from "../../services/ImageGenerationService";

// ---------------------------------------------------------------------------
// Helpers — AppSettings is a flat Record<string, string> on the Context, so
// any value that isn't a plain string must be JSON-serialized.
// ---------------------------------------------------------------------------

function getJson<T>(context: Context, key: string): T | undefined {
  const raw = context.AppSettings[key];
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function setJson<T>(context: Context, key: string, value: T): void {
  context.AppSettings[key] = JSON.stringify(value);
}

// ---------------------------------------------------------------------------

export const AppSettingActions = {
  createDefault(): AppSettings {
    return {
      theme: "light",
      volume: 100,
    };
  },

  /**
   * Sets the player's personal volume (0.0 to 1.0)
   * This is local to the user and doesn't sync
   */
  setPlayerVolume(params: { volume: number }, context: Context): void {
    const volume = Math.max(0, Math.min(1, params.volume));
    context.AppSettings.volume = volume.toString();
    ContextActions.save(context);
  },

  /**
   * Gets the player's personal volume, defaults to 1.0
   */
  getPlayerVolume(context: Context): number {
    const volumeStr = context.AppSettings.volume;
    if (!volumeStr || isDmAccess()) {
      return 1.0;
    }
    const volume = parseFloat(volumeStr);
    return isNaN(volume) ? 0.5 : volume;
  },

  setTheme(params: { theme: "light" | "dark" }, context: Context): void {
    context.AppSettings.theme = params.theme;
    ContextActions.save(context);
  },

  getTheme(context: Context): "light" | "dark" {
    const theme = context.AppSettings.theme;
    if (theme === "light" || theme === "dark") return theme;
    return "light";
  },

  // ---------------------------------------------------------------------------
  // Image generation — provider selection
  // ---------------------------------------------------------------------------

  getImageService(context: Context): string {
    return context.AppSettings.imageService ?? DEFAULT_PROVIDER_ID;
  },

  setImageService(params: { providerId: string }, context: Context): void {
    context.AppSettings.imageService = params.providerId;
    ContextActions.save(context);
  },

  // ---------------------------------------------------------------------------
  // Image generation — per-provider credentials
  // ---------------------------------------------------------------------------

  getProviderApiKey(context: Context, providerId: string): string | undefined {
    const map = getJson<Record<string, string>>(context, "imageApiKeys");
    return map?.[providerId] || undefined;
  },

  setProviderApiKey(
    params: { providerId: string; apiKey: string | undefined },
    context: Context
  ): void {
    const map = getJson<Record<string, string>>(context, "imageApiKeys") ?? {};
    if (params.apiKey?.trim()) {
      map[params.providerId] = params.apiKey.trim();
    } else {
      delete map[params.providerId];
    }
    setJson(context, "imageApiKeys", map);
    ContextActions.save(context);
  },

  getProviderApiSecret(
    context: Context,
    providerId: string
  ): string | undefined {
    const map = getJson<Record<string, string>>(context, "imageApiSecrets");
    return map?.[providerId] || undefined;
  },

  setProviderApiSecret(
    params: { providerId: string; apiSecret: string | undefined },
    context: Context
  ): void {
    const map =
      getJson<Record<string, string>>(context, "imageApiSecrets") ?? {};
    if (params.apiSecret?.trim()) {
      map[params.providerId] = params.apiSecret.trim();
    } else {
      delete map[params.providerId];
    }
    setJson(context, "imageApiSecrets", map);
    ContextActions.save(context);
  },

  // ---------------------------------------------------------------------------
  // Prompt template
  // ---------------------------------------------------------------------------

  getImagePromptTemplate(context: Context): string {
    return context.AppSettings.imagePromptTemplate || DEFAULT_IMAGE_PROMPT;
  },

  setImagePromptTemplate(params: { template: string }, context: Context): void {
    const trimmed = params.template.trim();
    context.AppSettings.imagePromptTemplate = trimmed || DEFAULT_IMAGE_PROMPT;
    ContextActions.save(context);
  },

  // ---------------------------------------------------------------------------
  // SFX
  // ---------------------------------------------------------------------------

  setSfxVolume(params: { volume: number }): void {
    SoundEffectService.setVolume(Math.max(0, Math.min(1, params.volume)));
  },

  getSfxVolume(): number {
    return SoundEffectService.getVolume();
  },

  // ---------------------------------------------------------------------------
  // Aggregate
  // ---------------------------------------------------------------------------

  getSettings(context: Context): AppSettings {
    return {
      theme: this.getTheme(context),
      volume: this.getPlayerVolume(context),
      sfxVolume: this.getSfxVolume(),
      imagePromptTemplate: this.getImagePromptTemplate(context),
      imageService: this.getImageService(context),
      imageApiKeys: getJson<Record<string, string>>(context, "imageApiKeys"),
      imageApiSecrets: getJson<Record<string, string>>(
        context,
        "imageApiSecrets"
      ),
    };
  },
};
