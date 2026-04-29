import { Context } from "../domains/Context/Context";
import { VersionedMigration } from "./types";

/**
 * Migration 1.4.0: Multi-provider AI image generation
 *
 * AppSettings changes:
 *   - imageApiKey (single string) → imageApiKeys (Record<string, string>)
 *     The legacy key is moved into imageApiKeys['google-gemini-flash'].
 *   - imageService (string) is introduced to track the selected provider.
 *   - imageApiSecrets (Record<string, string>) is introduced for providers
 *     that require a second credential (e.g. Kling's Secret Key).
 */
export const migration_1_4_0: VersionedMigration = {
  version: "1.4.0",

  update: (context: Context): Context => {
    const settings = context.AppSettings as any;

    // Move legacy imageApiKey → imageApiKeys['google-gemini-flash']
    if (settings.imageApiKey) {
      settings.imageApiKeys = {
        ...(settings.imageApiKeys ?? {}),
        "google-gemini-flash": settings.imageApiKey,
      };
      delete settings.imageApiKey;
    }

    return { ...context, version: "1.4.0" };
  },

  reset: (context: Context): Context => {
    const settings = context.AppSettings as any;

    // Move imageApiKeys['google-gemini-flash'] back to imageApiKey
    const geminiKey = settings.imageApiKeys?.["google-gemini-flash"];
    if (geminiKey) {
      settings.imageApiKey = geminiKey;
    }

    // Strip 1.4.0 fields
    delete settings.imageService;
    delete settings.imageApiKeys;
    delete settings.imageApiSecrets;

    return { ...context, version: "1.3.5" };
  },
};
