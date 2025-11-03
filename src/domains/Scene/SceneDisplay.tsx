// domains/Scene/SceneDisplay.tsx

import { useMemo, useState, useEffect, useRef } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { ImageDisplay } from "../Image/ImageDisplay";

// Viewport caps (percentages). Tweak to taste.
const CONFIG = {
  default: { vw: 40, vh: 45, opacity: "opacity-80" },
  hovered: { vw: 60, vh: 75, opacity: "opacity-100" },
  focus: {
    maxWidthPercent: 35,
    maxHeightPercent: 50,
    paddingClass: "p-2",
  },
  collapsed: { size: "w-12 h-12" },
};

export function SceneDisplay() {
  const context = useQuestContext();
  const campaign = CampaignActions.getActiveCampaign(context);
  const scene = campaign.GameState.Scene;

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Track previous scene IDs to auto-reveal on change
  const prevSceneRef = useRef({
    environmentId: scene.EnvironmentImageId,
    focusId: scene.FocusImageId,
  });

  useEffect(() => {
    const hasEnvironmentChanged =
      scene.EnvironmentImageId !== prevSceneRef.current.environmentId;
    const hasFocusChanged = scene.FocusImageId !== prevSceneRef.current.focusId;

    if (hasEnvironmentChanged || hasFocusChanged) {
      setIsCollapsed(false);
    }

    prevSceneRef.current = {
      environmentId: scene.EnvironmentImageId,
      focusId: scene.FocusImageId,
    };
  }, [scene.EnvironmentImageId, scene.FocusImageId]);

  // Grab stored dimensions from campaign
  const envMeta = useMemo(
    () => campaign.Images.find((img) => img.Id === scene.EnvironmentImageId),
    [campaign.Images, scene.EnvironmentImageId]
  );

  const envAspect =
    envMeta && envMeta.Height > 0 ? envMeta.Width / envMeta.Height : null;

  const hasEnvironment = !!scene.EnvironmentImageId && !!envAspect;
  const hasFocus = !!scene.FocusImageId;

  if (!hasEnvironment) return null;

  if (isCollapsed) {
    return (
      <div className="absolute top-2 right-2 z-20">
        <button
          onClick={() => setIsCollapsed(false)}
          className={`btn btn-square btn-primary ${CONFIG.collapsed.size} shadow-lg`}
          title="Show scene"
        >
          <span className="icon-[mdi--image] w-6 h-6" />
        </button>
      </div>
    );
  }

  const mode = isHovered ? CONFIG.hovered : CONFIG.default;

  return (
    <div
      className={`absolute top-2 right-2 z-20 transition-all duration-300 ease-in-out ${mode.opacity}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      // CSS variables make this fully responsive without JS:
      // width = min(vwCap, vhCap * aspect), height derives from aspect-ratio
      style={
        {
          "--env-aspect": envAspect || 1,
          "--vwcap": `${mode.vw}vw`,
          "--vhcap": `${mode.vh}vh`,
          width: "min(var(--vwcap), calc(var(--vhcap) * var(--env-aspect)))",
          aspectRatio: String(envAspect || 1),
        } as React.CSSProperties
      }
    >
      <div className="relative w-full h-full rounded-lg overflow-hidden shadow-xl border-2 border-base-300">
        {/* Environment image — container matches image ratio exactly (no crop, no leftover space) */}
        <div className="w-full h-full">
          <ImageDisplay
            imageId={scene.EnvironmentImageId}
            className="w-full h-full object-fit block"
            alt="Scene environment"
          />
        </div>

        {/* Focus image, scaled as % of container */}
        {hasFocus && (
          <div
            className={`absolute bottom-0 right-0 ${CONFIG.focus.paddingClass} pointer-events-none`}
            style={{
              maxWidth: `${CONFIG.focus.maxWidthPercent}%`,
              maxHeight: `${CONFIG.focus.maxHeightPercent}%`,
            }}
          >
            <ImageDisplay
              imageId={scene.FocusImageId}
              className="max-w-full max-h-full object-contain rounded-lg border-2 border-base-300 bg-base-200/90 shadow-lg"
              alt="Scene focus"
            />
          </div>
        )}

        {/* Collapse */}
        <button
          onClick={() => setIsCollapsed(true)}
          className="absolute top-2 right-2 btn btn-circle btn-ghost btn-xs bg-base-100/50 hover:bg-base-100 z-10"
          title="Hide scene"
        >
          <span className="icon-[mdi--close] w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
