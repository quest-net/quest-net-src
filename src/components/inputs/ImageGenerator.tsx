// components/inputs/ImageGenerator.tsx

import { useEffect, useState } from "react";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { AppSettingActions } from "../../domains/AppSetting/AppSettingActions";
import {
  fillPromptTemplate,
  generateImageFromPrompt,
  getProvider,
} from "../../services/ImageGenerationService";
import { ImageActions } from "../../domains/Image/ImageActions";
import { IndexedDBUtilities } from "../../utils/IndexedDBUtilities";
import type { Image as DomainImage } from "../../domains/Image/Image";

interface ImageGeneratorProps {
  contextInfo?: {
    objectType?: string;
    name?: string;
    description?: string;
  };
  /**
   * Called after the generated image has been saved into the campaign
   * image library. Receives the new Image.Id so the parent can select it.
   */
  onSelectImage: (imageId: string) => void;
}

type GenStatus = "idle" | "loading" | "ready" | "error";

export function ImageGenerator({
  contextInfo,
  onSelectImage,
}: ImageGeneratorProps) {
  const context = useQuestContext();
  const { actionService } = useActionService();

  const providerId = AppSettingActions.getImageService(context);
  const apiKey = AppSettingActions.getProviderApiKey(context, providerId);
  const apiSecret = AppSettingActions.getProviderApiSecret(context, providerId);
  const template = AppSettingActions.getImagePromptTemplate(context);

  const provider = getProvider(providerId);

  const [status, setStatus] = useState<GenStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [generatedBlob, setGeneratedBlob] = useState<Blob | null>(null);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);

  const isDM = context.User.Role === "dm";

  // Cleanup object URL on unmount / when replaced
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Don't render if no provider is configured, no API key, or provider unknown
  if (!provider || !apiKey) {
    return null;
  }

  // For providers that require a secret, also gate on that
  if (provider.requiresSecret && !apiSecret) {
    return null;
  }

  const effectiveContext = contextInfo || {};
  const suggestedName =
    effectiveContext.name?.trim() ||
    effectiveContext.objectType?.trim() ||
    "Generated Image";

  const handleGenerate = async () => {
    setStatus("loading");
    setError(null);

    try {
      const prompt = fillPromptTemplate(template, {
        objectType: effectiveContext.objectType,
        name: effectiveContext.name,
        description: effectiveContext.description,
      });

      setLastPrompt(prompt);

      const { blob } = await generateImageFromPrompt({
        providerId,
        prompt,
        credentials: { apiKey, apiSecret },
      });

      // Revoke previous URL if present
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setGeneratedBlob(blob);
      setStatus("ready");
    } catch (err) {
      console.error("[ImageGenerator] Failed to generate image:", err);
      setGeneratedBlob(null);
      setPreviewUrl(null);
      setStatus("error");
      setError(
        err instanceof Error ? err.message : "Image generation failed."
      );
    }
  };

  const handleAddToLibrary = async () => {
    if (!generatedBlob) return;

    if (!actionService) {
      setStatus("error");
      setError("Not connected to a game session.");
      return;
    }

    const baseName =
      suggestedName ||
      effectiveContext.name ||
      effectiveContext.objectType ||
      "Generated Image";

    // Wrap generated blob in a File so we can reuse existing image pipelines
    const file = new File([generatedBlob], `${baseName}.png`, {
      type: generatedBlob.type || "image/png",
    });

    try {
      setStatus("loading");
      setError(null);

      if (isDM) {
        // DM path: mirror ImageUpload's DM behavior
        const {
          blob: compressed,
          width,
          height,
          mimeType,
        } = await ImageActions.compressImage(file);

        const image: DomainImage = {
          Id: crypto.randomUUID(),
          Name: baseName,
          FileSize: compressed.size,
          MimeType: mimeType,
          Width: width,
          Height: height,
          UploadedBy: undefined, // DM images behave like other DM uploads
        };

        await IndexedDBUtilities.save(image.Id, compressed);
        actionService.execute("image:create", { image });

        onSelectImage(image.Id);
        setStatus("ready");
      } else {
        // Player path: use ImageService, which already handles compression + DM sync
        const imageService = (actionService as any).imageService;
        if (!imageService) {
          throw new Error("Image service not available.");
        }

        const image = await imageService.uploadImage(
          file,
          baseName,
          context.User.Id
        );

        onSelectImage(image.Id);
        setStatus("ready");
      }
    } catch (err) {
      console.error(
        "[ImageGenerator] Failed to save AI-generated image:",
        err
      );
      setStatus("error");
      setError(
        err instanceof Error
          ? err.message
          : "Failed to save generated image."
      );
    }
  };

  const handleCancelPreview = () => {
    setPreviewUrl(null);
    setGeneratedBlob(null);
    setStatus("idle");
    setError(null);
  };

  const hasPreview = !!previewUrl && status === "ready";

  return (
    <div className="mt-4 bg-base-100/80 space-y-3">
      {/* Header (hidden when a preview is displayed) */}
      {!hasPreview && (
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <span className="icon-[mdi--magic-staff] w-5 h-5 text-primary" />
              AI Image Generator
            </h3>
            <p className="text-xs opacity-50">{provider.displayName}</p>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={handleGenerate}
            disabled={status === "loading"}
          >
            {status === "loading" ? (
              <>
                <span className="loading loading-spinner loading-xs" />
                Generating...
              </>
            ) : (
              "Generate image"
            )}
          </button>
        </div>
      )}

      {/* Preview area */}
      {hasPreview && (
        <div className="flex flex-col md:flex-row gap-4">
          <div className="w-full md:w-48 h-48 bg-base-200 rounded-lg overflow-hidden flex items-center justify-center">
            <img
              src={previewUrl!}
              alt={suggestedName}
              className="w-full h-full object-contain"
            />
          </div>
          <div className="flex-1 flex flex-col gap-2 items-stretch">
            <button
              type="button"
              className="btn btn-sm btn-success w-full md:w-auto"
              onClick={handleAddToLibrary}
              disabled={status !== "ready"}
            >
              <span className="icon-[mdi--content-save] w-4 h-4 mr-1" />
              Add to image library &amp; select
            </button>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-sm btn-primary flex-1"
                onClick={handleGenerate}
                disabled={status != "ready"}
              >
                {status != "ready" ? (
                  <>
                    <span className="loading loading-spinner loading-xs" />
                    Generating...
                  </>
                ) : (
                  "Generate another"
                )}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-neutral"
                onClick={handleCancelPreview}
              >
                Cancel
              </button>
            </div>

            {lastPrompt && (
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer opacity-70">
                  View prompt
                </summary>
                <pre className="mt-1 whitespace-pre-wrap bg-base-200 p-2 rounded-md max-h-40 overflow-auto">
                  {lastPrompt}
                </pre>
              </details>
            )}
          </div>
        </div>
      )}

      {/* Error message */}
      {status === "error" && error && (
        <div className="alert alert-error p-2 text-xs">
          <span className="icon-[mdi--alert-circle] w-4 h-4" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
