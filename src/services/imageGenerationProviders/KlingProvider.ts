// services/imageGenerationProviders/KlingProvider.ts
//
// Kling AI image generation.
//
// Authentication: Kling uses JWT (HS256) signed with your Access Key (AK) and
// Secret Key (SK) from the Kling developer portal. The JWT is generated
// client-side using the Web Crypto API — no external JWT library needed.
//
// Flow: POST to submit task → receive task_id → poll GET until status is
// "succeed" → fetch the image URL and return as a Blob.

import type {
  ImageGenerationProvider,
  ImageProviderCredentials,
  GeneratedImageResult,
} from "./types";

const ENDPOINT = "https://api.klingai.com/v1/images/generations";
const MODEL = "kling-v1";
const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 24; // ~60 seconds total

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

function base64urlEncodeString(str: string): string {
  // Encode a UTF-8 string to base64url
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function base64urlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Generates a short-lived HS256 JWT signed with the Kling AK/SK pair.
 * Valid for 30 minutes; issued with a 5-second not-before leeway to
 * account for minor clock skew.
 */
async function generateKlingJWT(
  accessKey: string,
  secretKey: string
): Promise<string> {
  const encoder = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);

  const headerB64 = base64urlEncodeString(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  );
  const payloadB64 = base64urlEncodeString(
    JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 })
  );

  const signingInput = `${headerB64}.${payloadB64}`;

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(signingInput)
  );

  const signatureB64 = base64urlEncodeBytes(new Uint8Array(signature));
  return `${signingInput}.${signatureB64}`;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const KlingProvider: ImageGenerationProvider = {
  id: "kling",
  displayName: "Kling AI (Image)",
  apiKeyLabel: "Access Key",
  apiKeyPlaceholder: "Your Kling Access Key",
  requiresSecret: true,
  apiSecretLabel: "Secret Key",
  description:
    "Kling AI image generation via the official Kling API. Requires an Access Key and Secret Key from the Kling developer portal.",
  docsUrl: "https://app.klingai.com/global/dev",

  async generate(
    prompt: string,
    credentials: ImageProviderCredentials
  ): Promise<GeneratedImageResult> {
    const { apiKey: accessKey, apiSecret: secretKey } = credentials;

    if (!secretKey?.trim()) {
      throw new Error(
        "Kling requires both an Access Key and a Secret Key. Please enter both in App Settings."
      );
    }

    // --- Submit generation task ---
    const jwt = await generateKlingJWT(accessKey.trim(), secretKey.trim());

    const submitResponse = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        model_name: MODEL,
        prompt,
        n: 1,
        aspect_ratio: "1:1",
      }),
    });

    if (!submitResponse.ok) {
      let detail = "";
      try {
        detail = await submitResponse.text();
      } catch {
        /* ignore */
      }
      throw new Error(
        `Kling task submission failed: ${submitResponse.status} ${submitResponse.statusText}${detail ? ` — ${detail}` : ""}`
      );
    }

    const submitJson: any = await submitResponse.json();
    const taskId: string | undefined = submitJson?.data?.task_id;
    if (!taskId) {
      throw new Error(
        "Kling response did not include a task ID. Check your credentials."
      );
    }

    // --- Poll for completion ---
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_INTERVAL_MS);

      // Re-sign each poll request (JWTs are short-lived)
      const pollJwt = await generateKlingJWT(
        accessKey.trim(),
        secretKey.trim()
      );

      const pollResponse = await fetch(`${ENDPOINT}/${taskId}`, {
        headers: { Authorization: `Bearer ${pollJwt}` },
      });

      if (!pollResponse.ok) {
        // Transient error — keep polling
        continue;
      }

      const pollJson: any = await pollResponse.json();
      const status: string = pollJson?.data?.task_status;

      if (status === "failed") {
        const msg =
          pollJson?.data?.task_status_msg ||
          "The task failed for an unspecified reason.";
        throw new Error(`Kling generation failed: ${msg}`);
      }

      if (status === "succeed") {
        const imageUrl: string | undefined =
          pollJson?.data?.task_result?.images?.[0]?.url;
        if (!imageUrl) {
          throw new Error(
            "Kling reported success but returned no image URL."
          );
        }

        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
          throw new Error(
            `Failed to download the generated image from Kling (${imageResponse.status}).`
          );
        }

        const blob = await imageResponse.blob();
        return { blob, mimeType: blob.type || "image/jpeg" };
      }

      // status is "processing" or similar — keep waiting
    }

    throw new Error(
      `Kling image generation timed out after ${(MAX_POLLS * POLL_INTERVAL_MS) / 1000} seconds.`
    );
  },
};
