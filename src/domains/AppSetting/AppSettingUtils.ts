// domains/AppSetting/AppSettingUtils.ts

import { isDmAccess } from "../../utils/UrlParser";
import { Context } from "../Context/Context";
import { AppSettings, DEFAULT_IMAGE_PROMPT } from "./AppSetting";
import { SoundEffectService } from "../../services/SoundEffectService";
import { DEFAULT_PROVIDER_ID } from "../../services/ImageGenerationService";
import { markProfileUpdated } from "../Context/contextStore";

/**
 * AppSettings keys that sync as part of the "Quest-Net account" profile
 * (cloud profile.json). Preferences + image-gen credentials. Deliberately
 * EXCLUDES `cloudBackup` (device-specific connection/email/status). Every setter
 * that writes one of these keys must call markProfileUpdated(); keep this list
 * and those setters in lockstep.
 */
export const PROFILE_SYNCED_APP_SETTING_KEYS = [
  "theme",
  "volume",
  "performanceMode",
  "preserveFlyingHeightOnTileMove",
  "critSplashEnabled",
  "imagePromptTemplate",
  "imageService",
  "imageApiKeys",
  "imageApiSecrets",
] as const;

/** Persisted Google Drive backup connection + last-result status. */
export interface CloudBackupState {
  connected: boolean;
  email?: string;
  lastStatus?: { time: number; ok: boolean; error?: string };
}

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

export const AppSettingUtils = {
  createDefault(): AppSettings {
    return {
      theme: "light",
      volume: 100,
      preserveFlyingHeightOnTileMove: false,
      performanceMode: false,
      critSplashEnabled: true,
    };
  },

  /**
   * Sets the player's personal volume (0.0 to 1.0). Not broadcast to peers, but
   * synced across the user's own devices via the cloud account profile.
   */
  setPlayerVolume(params: { volume: number }, context: Context): void {
    const volume = Math.max(0, Math.min(1, params.volume));
    context.AppSettings.volume = volume.toString();
    markProfileUpdated();
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
    markProfileUpdated();
  },

  getTheme(context: Context): "light" | "dark" {
    const theme = context.AppSettings.theme;
    if (theme === "light" || theme === "dark") return theme;
    return "light";
  },

  setPreserveFlyingHeightOnTileMove(
    params: { preserve: boolean },
    context: Context
  ): void {
    context.AppSettings.preserveFlyingHeightOnTileMove = params.preserve
      ? "true"
      : "false";
    markProfileUpdated();
  },

  getPreserveFlyingHeightOnTileMove(context: Context): boolean {
    return context.AppSettings.preserveFlyingHeightOnTileMove === "true";
  },

  setPerformanceMode(
    params: { enabled: boolean },
    context: Context
  ): void {
    context.AppSettings.performanceMode = params.enabled ? "true" : "false";
    markProfileUpdated();
  },

  getPerformanceMode(context: Context): boolean {
    return context.AppSettings.performanceMode === "true";
  },

  setCritSplashEnabled(
    params: { enabled: boolean },
    context: Context
  ): void {
    context.AppSettings.critSplashEnabled = params.enabled ? "true" : "false";
    markProfileUpdated();
  },

  /** Defaults to enabled when the setting has never been set. */
  getCritSplashEnabled(context: Context): boolean {
    return context.AppSettings.critSplashEnabled !== "false";
  },

  // ---------------------------------------------------------------------------
  // Image generation — provider selection
  // ---------------------------------------------------------------------------

  getImageService(context: Context): string {
    return context.AppSettings.imageService ?? DEFAULT_PROVIDER_ID;
  },

  setImageService(params: { providerId: string }, context: Context): void {
    context.AppSettings.imageService = params.providerId;
    markProfileUpdated();
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
    markProfileUpdated();
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
    markProfileUpdated();
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
    markProfileUpdated();
  },

  // ---------------------------------------------------------------------------
  // Cloud backup (Google Drive) — connection + last-result status
  // ---------------------------------------------------------------------------

  getCloudBackup(context: Context): CloudBackupState | undefined {
    return getJson<CloudBackupState>(context, "cloudBackup");
  },

  setCloudBackupConnected(
    params: { connected: boolean; email?: string },
    context: Context
  ): void {
    const prev = getJson<CloudBackupState>(context, "cloudBackup") ?? {
      connected: false,
    };
    setJson<CloudBackupState>(context, "cloudBackup", {
      ...prev,
      connected: params.connected,
      email: params.email ?? prev.email,
    });
  },

  setCloudBackupStatus(
    params: { ok: boolean; error?: string },
    context: Context
  ): void {
    const prev = getJson<CloudBackupState>(context, "cloudBackup") ?? {
      connected: false,
    };
    setJson<CloudBackupState>(context, "cloudBackup", {
      ...prev,
      lastStatus: {
        time: Date.now(),
        ok: params.ok,
        error: params.ok ? undefined : params.error,
      },
    });
  },

  clearCloudBackup(context: Context): void {
    delete context.AppSettings.cloudBackup;
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
      preserveFlyingHeightOnTileMove:
        this.getPreserveFlyingHeightOnTileMove(context),
      performanceMode: this.getPerformanceMode(context),
      critSplashEnabled: this.getCritSplashEnabled(context),
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
