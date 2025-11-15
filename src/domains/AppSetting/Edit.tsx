// domains/AppSetting/Edit.tsx

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useQuestContext,
  triggerContextUpdate,
} from "../Context/ContextProvider";
import { AppSettingActions } from "./AppSettingActions";

export function AppSettingEdit() {
  const context = useQuestContext();
  const navigate = useNavigate();

  // Initial values from actions
  const [theme, setTheme] = useState<"light" | "dark">(
    AppSettingActions.getTheme(context)
  );

  const [volumePercent, setVolumePercent] = useState<number>(
    Math.round(AppSettingActions.getPlayerVolume(context) * 100)
  );

  const [imageApiKey, setImageApiKey] = useState<string>(
    AppSettingActions.getImageApiKey(context) ?? ""
  );

  const [imagePromptTemplate, setImagePromptTemplate] = useState<string>(
    AppSettingActions.getImagePromptTemplate(context)
  );

  const [isSaving, setIsSaving] = useState(false);

  const handleSave = () => {
    setIsSaving(true);

    // Theme
    AppSettingActions.setTheme({ theme }, context);

    // Volume (0–1)
    AppSettingActions.setPlayerVolume(
      { volume: volumePercent / 100 },
      context
    );

    // API key – allow clearing
    const trimmedKey = imageApiKey.trim();
    AppSettingActions.setImageApiKey(
      { apiKey: trimmedKey || undefined },
      context
    );

    // Prompt template – allow resetting to default behavior
    AppSettingActions.setImagePromptTemplate(
      { template: imagePromptTemplate },
      context
    );

    // Persist + rerender
    triggerContextUpdate();
    setIsSaving(false);

    // Navigate back home (or you could stay on page)
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
                  <button
                    type="button"
                    className={`btn btn-sm join-item ${
                      theme === "light" ? "btn-active btn-primary" : ""
                    }`}
                    onClick={() => setTheme("light")}
                  >
                    <span className="icon-[mdi--white-balance-sunny] w-4 h-4 mr-1" />
                    Light
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm join-item ${
                      theme === "dark" ? "btn-active btn-primary" : ""
                    }`}
                    onClick={() => setTheme("dark")}
                  >
                    <span className="icon-[mdi--weather-night] w-4 h-4 mr-1" />
                    Dark
                  </button>
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
            </div>
          </section>

          {/* Image generation settings */}
          <section className="card bg-base-100 shadow-lg border border-base-300">
            <div className="card-body space-y-4">
              <h2 className="card-title">AI Image Generation</h2>
              <p className="text-sm opacity-80">
                Configure optional AI image generation using your own Google AI
                Studio API key. Keys are stored locally in your browser and are
                never shared with other players.
              </p>

              {/* API Key */}
              <div className="flex flex-col gap-2">
                <label className="font-medium">Google AI API Key</label>
                <input
                  type="password"
                  className="input input-bordered w-full"
                  placeholder="AIza..."
                  value={imageApiKey}
                  onChange={(e) => setImageApiKey(e.target.value)}
                  autoComplete="off"
                />
                <p className="text-xs opacity-70">
                  Used to call the{" "}
                  <code className="kbd kbd-xs">gemini-2.5-flash-image</code>{" "}
                  model (a.k.a. nano-banana) to generate images. Leave blank to
                  disable in-app generation.
                </p>
              </div>

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

          {/* Footer actions (optional extra buttons) */}
          <div className="flex justify-between mt-4">
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
    </div>
  );
}
