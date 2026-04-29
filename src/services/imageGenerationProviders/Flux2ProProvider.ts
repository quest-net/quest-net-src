// services/imageGenerationProviders/Flux2ProProvider.ts
//
// Black Forest Labs — FLUX.2 [Pro]
//
// The recommended default FLUX.2 model for image generation.
// Supports arbitrary width/height (minimum 64px each, no multipleOf constraint),
// making it ideal for non-standard aspect ratios like terrain textures.
//
// Flow:
//   POST /v1/flux-2-pro → { id, polling_url }
//   GET  polling_url    → poll until status "Ready"
//   Fetch result.sample → return as Blob

import type {
  ImageGenerationProvider,
  ImageProviderCredentials,
  GeneratedImageResult,
} from "./types";

const GENERATE_ENDPOINT = "https://api.bfl.ai/v1/flux-2-pro";
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 40; // ~80 seconds

const TERMINAL_STATUSES = new Set([
  "Ready",
  "Error",
  "Request Moderated",
  "Content Moderated",
  "Task not found",
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const Flux2ProProvider: ImageGenerationProvider = {
  id: "bfl-flux2-pro",
  displayName: "FLUX.2 Pro (Black Forest Labs)",
  apiKeyLabel: "BFL API Key",
  apiKeyPlaceholder: "Paste your BFL API key",
  requiresSecret: false,
  description:
    "FLUX.2 [Pro] by Black Forest Labs. Supports arbitrary image dimensions — ideal for terrain textures and non-standard aspect ratios. Priced per megapixel (~$0.03 at 1024×1024).",
  docsUrl: "https://bfl.ai",

  async generate(
    prompt: string,
    credentials: ImageProviderCredentials,
    options?: { width?: number; height?: number }
  ): Promise<GeneratedImageResult> {
    const { apiKey } = credentials;

    // Submit generation task
    const body: Record<string, unknown> = {
      prompt,
      output_format: "png",
    };

    // Pass explicit dimensions only if provided; omitting them lets BFL pick a
    // sensible default (1024×1024). Dimensions must be ≥ 64.
    if (options?.width && options.width >= 64) body.width = options.width;
    if (options?.height && options.height >= 64) body.height = options.height;

    const submitResponse = await fetch(GENERATE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
        "x-key": apiKey.trim(),
      },
      body: JSON.stringify(body),
    });

    if (!submitResponse.ok) {
      let detail = "";
      try {
        detail = await submitResponse.text();
      } catch {
        /* ignore */
      }
      throw new Error(
        `FLUX.2 Pro request failed: ${submitResponse.status} ${submitResponse.statusText}${detail ? ` — ${detail}` : ""}`
      );
    }

    const submitJson: any = await submitResponse.json();
    const taskId: string | undefined = submitJson?.id;
    const pollingUrl: string | undefined = submitJson?.polling_url;

    if (!taskId || !pollingUrl) {
      throw new Error(
        "FLUX.2 Pro response did not include a task ID or polling URL."
      );
    }

    // Poll for completion
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_INTERVAL_MS);

      const pollResponse = await fetch(pollingUrl, {
        headers: {
          accept: "application/json",
          "x-key": apiKey.trim(),
        },
      });

      if (!pollResponse.ok) {
        // Transient error — keep trying
        continue;
      }

      const pollJson: any = await pollResponse.json();
      const status: string = pollJson?.status;

      if (!TERMINAL_STATUSES.has(status)) {
        // Still pending — keep polling
        continue;
      }

      if (status === "Ready") {
        const imageUrl: string | undefined = pollJson?.result?.sample;
        if (!imageUrl) {
          throw new Error(
            "FLUX.2 Pro reported Ready but returned no image URL."
          );
        }

        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
          throw new Error(
            `Failed to download the generated image from BFL (${imageResponse.status}).`
          );
        }

        const blob = await imageResponse.blob();
        return { blob, mimeType: blob.type || "image/png" };
      }

      // Any other terminal status is a failure
      throw new Error(`FLUX.2 Pro generation ended with status: "${status}".`);
    }

    throw new Error(
      `FLUX.2 Pro generation timed out after ${(MAX_POLLS * POLL_INTERVAL_MS) / 1000} seconds.`
    );
  },
};
