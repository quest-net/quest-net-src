// domains/AppSetting/Edit.tsx

import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  useQuestContext,
  triggerContextUpdate,
} from "../Context/ContextProvider";
import { useIsOffscreen, FloatingActionBar } from "../../components/Form/Form";
import { AppSettingUtils } from "./AppSettingUtils";
import { ToggleButton } from "../../components/ui/ToggleButton";
import { FloatingActionButton } from "../../components/ui/FloatingActionButton";
import {
  PROVIDER_REGISTRY,
  DEFAULT_PROVIDER_ID,
} from "../../services/ImageGenerationService";

export function AppSettingEdit() {
  const context = useQuestContext();
  const navigate = useNavigate();

  // Floating save/cancel bar when the footer actions scroll offscreen.
  const footerRef = useRef<HTMLDivElement>(null);
  const footerOffscreen = useIsOffscreen(footerRef, true);

  // --- General settings ---
  const [theme, setTheme] = useState<"light" | "dark">(
    AppSettingUtils.getTheme(context)
  );

  const [volumePercent, setVolumePercent] = useState<number>(
    Math.round(AppSettingUtils.getPlayerVolume(context) * 100)
  );

  const [sfxVolumePercent, setSfxVolumePercent] = useState<number>(
    Math.round(AppSettingUtils.getSfxVolume() * 100)
  );

  const [
    preserveFlyingHeightOnTileMove,
    setPreserveFlyingHeightOnTileMove,
  ] = useState<boolean>(
    AppSettingUtils.getPreserveFlyingHeightOnTileMove(context)
  );

  const [performanceMode, setPerformanceMode] = useState<boolean>(
    AppSettingUtils.getPerformanceMode(context)
  );

  const [critSplashEnabled, setCritSplashEnabled] = useState<boolean>(
    AppSettingUtils.getCritSplashEnabled(context)
  );

  // --- Image generation settings ---
  const [imageService, setImageService] = useState<string>(
    AppSettingUtils.getImageService(context)
  );

  // Per-provider key state: { [providerId]: apiKey }
  const [apiKeys, setApiKeys] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const provider of PROVIDER_REGISTRY) {
      initial[provider.id] =
        AppSettingUtils.getProviderApiKey(context, provider.id) ?? "";
    }
    return initial;
  });

  // Per-provider secret state: { [providerId]: apiSecret }
  const [apiSecrets, setApiSecrets] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const provider of PROVIDER_REGISTRY) {
      if (provider.requiresSecret) {
        initial[provider.id] =
          AppSettingUtils.getProviderApiSecret(context, provider.id) ?? "";
      }
    }
    return initial;
  });

  const [imagePromptTemplate, setImagePromptTemplate] = useState<string>(
    AppSettingUtils.getImagePromptTemplate(context)
  );

  const [isSaving, setIsSaving] = useState(false);

  // Derived: the provider object for the currently selected service
  const selectedProvider =
    PROVIDER_REGISTRY.find((p) => p.id === imageService) ??
    PROVIDER_REGISTRY.find((p) => p.id === DEFAULT_PROVIDER_ID)!;

  const handleSave = () => {
    setIsSaving(true);

    // General
    AppSettingUtils.setTheme({ theme }, context);
    AppSettingUtils.setPlayerVolume({ volume: volumePercent / 100 }, context);
    AppSettingUtils.setSfxVolume({ volume: sfxVolumePercent / 100 });
    AppSettingUtils.setPreserveFlyingHeightOnTileMove(
      { preserve: preserveFlyingHeightOnTileMove },
      context
    );
    AppSettingUtils.setPerformanceMode({ enabled: performanceMode }, context);
    AppSettingUtils.setCritSplashEnabled(
      { enabled: critSplashEnabled },
      context
    );

    // Image service selection
    AppSettingUtils.setImageService({ providerId: imageService }, context);

    // Save ALL entered keys (so switching back to a provider doesn't lose its key)
    for (const provider of PROVIDER_REGISTRY) {
      const key = apiKeys[provider.id]?.trim();
      AppSettingUtils.setProviderApiKey(
        { providerId: provider.id, apiKey: key || undefined },
        context
      );
      if (provider.requiresSecret) {
        const secret = apiSecrets[provider.id]?.trim();
        AppSettingUtils.setProviderApiSecret(
          { providerId: provider.id, apiSecret: secret || undefined },
          context
        );
      }
    }

    // Prompt template
    AppSettingUtils.setImagePromptTemplate(
      { template: imagePromptTemplate },
      context
    );

    triggerContextUpdate();
    setIsSaving(false);
    navigate("/");
  };

  const handleCancel = () => {
    navigate(-1);
  };

  return (
    <div className="min-h-screen bg-base-200">
      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Header */}
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => navigate(-1)}
            >
              <span className="icon-[mdi--arrow-left] w-4 h-4" />
              Back
            </button>
            <h1 className="text-2xl font-bold">App Settings</h1>
          </div>
        </header>

        <div className="space-y-6">
          {/* Theme & Volume */}
          <section className="card bg-base-100 shadow-lg border border-base-300">
            <div className="card-body space-y-4">
              <h2 className="card-title">General</h2>

              {/* Theme */}
              <div className="flex flex-col gap-2">
                <label className="font-medium">Theme</label>
                <div className="join">
                  <ToggleButton
                    active={theme === "light"}
                    className="btn-sm join-item"
                    onClick={() => setTheme("light")}
                  >
                    <span className="icon-[mdi--white-balance-sunny] w-4 h-4 mr-1" />
                    Light
                  </ToggleButton>
                  <ToggleButton
                    active={theme === "dark"}
                    className="btn-sm join-item"
                    onClick={() => setTheme("dark")}
                  >
                    <span className="icon-[mdi--weather-night] w-4 h-4 mr-1" />
                    Dark
                  </ToggleButton>
                </div>
                <p className="text-xs opacity-70">
                  Theme support isn&apos;t fully wired into the UI yet, but you
                  can set your preference here.
                </p>
              </div>

              {/* Volume */}
              <div className="flex flex-col gap-2">
                <label className="font-medium">
                  Player Volume{" "}
                  <span className="text-sm opacity-70">
                    ({volumePercent}%)
                  </span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={volumePercent}
                  onChange={(e) =>
                    setVolumePercent(Number(e.target.value) || 0)
                  }
                  className="range range-primary"
                />
                <p className="text-xs opacity-70">
                  This only affects audio on your device. The DM&apos;s volume
                  choice still controls the &quot;master&quot; level for the
                  table.
                </p>
              </div>

              {/* SFX Volume */}
              <div className="flex flex-col gap-2">
                <label className="font-medium">
                  Sound Effects Volume{" "}
                  <span className="text-sm opacity-70">
                    ({sfxVolumePercent}%)
                  </span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={sfxVolumePercent}
                  onChange={(e) =>
                    setSfxVolumePercent(Number(e.target.value) || 0)
                  }
                  className="range range-secondary"
                />
                <p className="text-xs opacity-70">
                  Controls the volume of short sound effects like sticker
                  pops. Independent of music volume.
                </p>
              </div>

              <div className="form-control">
                <label className="label cursor-pointer justify-start gap-3">
                  <input
                    type="checkbox"
                    className="toggle toggle-primary"
                    checked={preserveFlyingHeightOnTileMove}
                    onChange={(e) =>
                      setPreserveFlyingHeightOnTileMove(e.target.checked)
                    }
                  />
                  <span className="label-text">
                    Keep flying height when clicking lower terrain
                  </span>
                </label>
                <p className="text-xs opacity-70">
                  Flying actors stay at their current height unless the
                  destination column has terrain at or above them.
                </p>
              </div>

              <div className="form-control">
                <label className="label cursor-pointer justify-start gap-3">
                  <input
                    type="checkbox"
                    className="toggle toggle-primary"
                    checked={performanceMode}
                    onChange={(e) => setPerformanceMode(e.target.checked)}
                  />
                  <span className="label-text">Performance mode</span>
                </label>
                <p className="text-xs opacity-70">
                  Uses lower renderer quality and simplified voxel terrain for
                  older laptops. Refresh after changing this from the quick
                  settings menu.
                </p>
              </div>

              <div className="form-control">
                <label className="label cursor-pointer justify-start gap-3">
                  <input
                    type="checkbox"
                    className="toggle toggle-primary"
                    checked={critSplashEnabled}
                    onChange={(e) => setCritSplashEnabled(e.target.checked)}
                  />
                  <span className="label-text">Crit splash animation</span>
                </label>
                <p className="text-xs opacity-70">
                  Plays a full-screen cut-in when an actor rolls a natural crit.
                  When off, crits show as a normal log alert instead.
                </p>
              </div>
            </div>
          </section>

          {/* Image generation settings */}
          <section className="card bg-base-100 shadow-lg border border-base-300">
            <div className="card-body space-y-4">
              <h2 className="card-title">AI Image Generation</h2>
              <p className="text-sm opacity-70">
                Generate images directly inside Quest-Net using your own API
                key. Keys are stored locally in your browser and are never
                shared with other players.
              </p>

              {/* Provider selector */}
              <div className="flex flex-col gap-2">
                <label className="font-medium">Image Generation Service</label>
                <select
                  className="select select-bordered w-full"
                  value={imageService}
                  onChange={(e) => setImageService(e.target.value)}
                >
                  {PROVIDER_REGISTRY.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.displayName}
                    </option>
                  ))}
                </select>
                <p className="text-xs opacity-70">
                  {selectedProvider.description}{" "}
                  <a
                    href={selectedProvider.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link link-primary"
                  >
                    Get API key ↗
                  </a>
                </p>
              </div>

              {/* Primary API key — label/placeholder driven by selected provider */}
              <div className="flex flex-col gap-2">
                <label className="font-medium">
                  {selectedProvider.apiKeyLabel}
                </label>
                <input
                  type="password"
                  className="input input-bordered w-full"
                  placeholder={
                    selectedProvider.apiKeyPlaceholder ?? "Paste your key here"
                  }
                  value={apiKeys[selectedProvider.id] ?? ""}
                  onChange={(e) =>
                    setApiKeys((prev) => ({
                      ...prev,
                      [selectedProvider.id]: e.target.value,
                    }))
                  }
                  autoComplete="off"
                />
              </div>

              {/* Secondary secret key — only shown for providers that need it (e.g. Kling) */}
              {selectedProvider.requiresSecret && (
                <div className="flex flex-col gap-2">
                  <label className="font-medium">
                    {selectedProvider.apiSecretLabel ?? "Secret Key"}
                  </label>
                  <input
                    type="password"
                    className="input input-bordered w-full"
                    placeholder="Paste your secret key here"
                    value={apiSecrets[selectedProvider.id] ?? ""}
                    onChange={(e) =>
                      setApiSecrets((prev) => ({
                        ...prev,
                        [selectedProvider.id]: e.target.value,
                      }))
                    }
                    autoComplete="off"
                  />
                  <p className="text-xs opacity-70">
                    This service requires two credentials. Both are stored
                    locally and never shared.
                  </p>
                </div>
              )}

              {/* Prompt template */}
              <div className="flex flex-col gap-2">
                <label className="font-medium">
                  Image Generation Prompt Template
                </label>
                <textarea
                  className="textarea textarea-bordered w-full font-mono text-sm"
                  rows={5}
                  value={imagePromptTemplate}
                  onChange={(e) => setImagePromptTemplate(e.target.value)}
                />
                <p className="text-xs opacity-70">
                  You can use the following placeholders, which will be filled
                  in by Quest-Net:
                </p>
                <ul className="text-xs opacity-70 list-disc list-inside space-y-1">
                  <li>
                    <code className="kbd kbd-xs">{`{ObjectType}`}</code> – e.g.
                    &quot;item&quot;, &quot;character&quot;, &quot;terrain
                    tile&quot;
                  </li>
                  <li>
                    <code className="kbd kbd-xs">{`{ObjectName}`}</code> – the
                    object&apos;s name
                  </li>
                  <li>
                    <code className="kbd kbd-xs">
                      {`{ObjectDescription}`}
                    </code>{" "}
                    – the object&apos;s description or flavor text
                  </li>
                </ul>
                <p className="text-xs opacity-70">
                  If you clear this field completely, Quest-Net will fall back
                  to the built-in default prompt.
                </p>
              </div>
            </div>
          </section>

          {/* Footer actions */}
          <div ref={footerRef} className="flex justify-between mt-4">
            <button className="btn btn-ghost" onClick={handleCancel}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <span className="loading loading-spinner loading-sm" />
                  Saving...
                </>
              ) : (
                "Save Settings"
              )}
            </button>
          </div>
        </div>
      </div>

      <FloatingActionBar show={footerOffscreen}>
        <FloatingActionButton
          onClick={handleCancel}
          data-tip="Cancel"
          aria-label="Cancel"
        >
          <span className="icon-[mdi--close] h-5 w-5" />
        </FloatingActionButton>
        <FloatingActionButton
          onClick={handleSave}
          variant="primary"
          disabled={isSaving}
          data-tip="Save Settings"
          aria-label="Save Settings"
        >
          {isSaving ? (
            <span className="loading loading-spinner loading-sm" />
          ) : (
            <span className="icon-[mdi--content-save] h-5 w-5" />
          )}
        </FloatingActionButton>
      </FloatingActionBar>
    </div>
  );
}
