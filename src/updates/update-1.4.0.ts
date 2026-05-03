import { VersionedMigration } from "./types";

/**
 * Migration 1.4.0: Multi-provider AI image generation
 *
 * AppSettings is a flat Record<string, string>, so nested structures are
 * stored as JSON strings. This migration:
 *   - Moves the legacy imageApiKey string into a JSON map under imageApiKeys
 *     so it becomes imageApiKeys['google-gemini-flash'].
 *   - imageService and imageApiSecrets are new fields (no prior data to move).
 */
export const migration_1_4_0: VersionedMigration = {
  version: "1.4.0",

  update: (context: any): any => {
    const settings = context.AppSettings;

    // Move legacy flat imageApiKey → JSON map under imageApiKeys
    const legacyKey = settings["imageApiKey"];
    if (legacyKey) {
      const existing: Record<string, string> = (() => {
        try { return JSON.parse(settings["imageApiKeys"] ?? "{}"); } catch { return {}; }
      })();
      existing["google-gemini-flash"] = legacyKey;
      settings["imageApiKeys"] = JSON.stringify(existing);
      delete settings["imageApiKey"];
    }

    return { ...context, version: "1.4.0" };
  },

  reset: (context: any): any => {
    const settings = context.AppSettings;

    // Move imageApiKeys['google-gemini-flash'] back to flat imageApiKey
    try {
      const map: Record<string, string> = JSON.parse(settings["imageApiKeys"] ?? "{}");
      const geminiKey = map["google-gemini-flash"];
      if (geminiKey) {
        settings["imageApiKey"] = geminiKey;
      }
    } catch {
      /* ignore malformed JSON */
    }

    // Strip 1.4.0 fields
    delete settings["imageService"];
    delete settings["imageApiKeys"];
    delete settings["imageApiSecrets"];

    return { ...context, version: "1.3.5" };
  },
};
