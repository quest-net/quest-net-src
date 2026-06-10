// domains/Scene/SceneDisplay.tsx

import { Rnd } from "react-rnd";
import { useMemo, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { ImageDisplay } from "../Image/ImageDisplay";
import { useIsMobile } from "../../hooks/useIsMobile";
import { LocalStorageUtilities } from "../../utils/LocalStorageUtilities";

type SceneMode = "fixed" | "window";

export function SceneDisplay({
  dmToolbar = false,
}: {
  /** Reserve room at the top so the panel clears the DM's full-width map toolbar. */
  dmToolbar?: boolean;
} = {}) {
  const context = useQuestContext();
  const campaign = CampaignActions.getActiveCampaign(context);
  const scene = campaign.GameState.Scene;
  const isMobile = useIsMobile();

  // The fixed/collapsed panel sits in the top-right corner; nudge it below the
  // DM toolbar (which spans the full width) when one is present.
  const topClass = dmToolbar ? "top-12" : "top-2";

  // Load preferences from localStorage
  const [mode, setMode] = useState<SceneMode>(() => {
    try {
      return (localStorage.getItem("questnet.sceneMode") as SceneMode) || "fixed";
    } catch {
      return "fixed";
    }
  });

  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem("questnet.sceneCollapsed") === "true";
    } catch {
      return false;
    }
  });

  const [collapsedMode, setCollapsedMode] = useState<SceneMode>(() => {
    try {
      return (localStorage.getItem("questnet.sceneCollapsedMode") as SceneMode) || "fixed";
    } catch {
      return "fixed";
    }
  });

  const [isHovered, setIsHovered] = useState(false);

  // Window mode is not usable on mobile — force fixed when resizing into mobile.
  useEffect(() => {
    if (isMobile && mode === "window") {
      setMode("fixed");
    }
  }, [isMobile, mode]);

  const [windowState, setWindowState] = useState(() => {
    try {
      const saved = localStorage.getItem("questnet.sceneWindow");
      return saved ? JSON.parse(saved) : {
        x: window.innerWidth - 520,
        y: dmToolbar ? 64 : 16,
        width: 500,
        height: 281, // Default 16:9 aspect ratio
      };
    } catch {
      return {
        x: window.innerWidth - 520,
        y: dmToolbar ? 64 : 16,
        width: 500,
        height: 281,
      };
    }
  });

  const fixedRef = useRef<HTMLDivElement>(null);

  // Save mode preference (best-effort; saveString handles its own errors)
  useEffect(() => {
    LocalStorageUtilities.saveString("questnet.sceneMode", mode);
  }, [mode]);

  // Save collapsed state
  useEffect(() => {
    LocalStorageUtilities.saveString(
      "questnet.sceneCollapsed",
      String(isCollapsed)
    );
  }, [isCollapsed]);

  // Save collapsed mode
  useEffect(() => {
    LocalStorageUtilities.saveString("questnet.sceneCollapsedMode", collapsedMode);
  }, [collapsedMode]);

  // Save window state
  useEffect(() => {
    LocalStorageUtilities.trySave("questnet.sceneWindow", windowState);
  }, [windowState]);

  // Handle browser window resize - keep scene window in bounds
  useEffect(() => {
    const handleResize = () => {
      if (mode === "window") {
        const padding = 20; // Minimum distance from edge
        const maxX = window.innerWidth - windowState.width - padding;
        const maxY = window.innerHeight - windowState.height - padding;

        let needsUpdate = false;
        const newState = { ...windowState };

        // Check if window is off-screen or too close to edges
        if (windowState.x > maxX) {
          newState.x = Math.max(padding, maxX);
          needsUpdate = true;
        }
        if (windowState.y > maxY) {
          newState.y = Math.max(padding, maxY);
          needsUpdate = true;
        }
        if (windowState.x < padding) {
          newState.x = padding;
          needsUpdate = true;
        }
        if (windowState.y < padding) {
          newState.y = padding;
          needsUpdate = true;
        }

        if (needsUpdate) {
          setWindowState(newState);
        }
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [mode, windowState]);

 

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

  // Look up image metadata for aspect ratios
  const envMeta = useMemo(
    () => campaign.Images.find((img) => img.Id === scene.EnvironmentImageId),
    [campaign.Images, scene.EnvironmentImageId]
  );

  const focusMeta = useMemo(
    () => campaign.Images.find((img) => img.Id === scene.FocusImageId),
    [campaign.Images, scene.FocusImageId]
  );

  const envAspect =
    envMeta && envMeta.Height > 0 ? envMeta.Width / envMeta.Height : 16 / 9;

  const focusAspect =
    focusMeta && focusMeta.Height > 0 ? focusMeta.Width / focusMeta.Height : 1;
	// Adjust window dimensions when aspect ratio changes (new environment image)
	useEffect(() => {
	  if (mode === "window") {
		// Recalculate dimensions to match new aspect ratio
		const currentHeight = windowState.height;
		const newWidth = Math.round(currentHeight * envAspect);
		
		// Use the new height based on current width
		setWindowState((prev: any) => ({
		  ...prev,
		  width: newWidth,
		}));
	  }
	}, [envAspect, mode]);
  const hasEnvironment = !!scene.EnvironmentImageId;
  const hasFocus = !!scene.FocusImageId;
  // Prevent body overflow/scrollbars when window is rendered via portal
  useEffect(() => {
    if (mode === "window" && !isCollapsed && hasEnvironment) {
      // Store original overflow values
      const originalOverflowX = document.body.style.overflowX;
      const originalOverflowY = document.body.style.overflowY;
      const originalHtmlOverflowX = document.documentElement.style.overflowX;
      const originalHtmlOverflowY = document.documentElement.style.overflowY;

      // Prevent scrollbars
      document.body.style.overflowX = "hidden";
      document.body.style.overflowY = "hidden";
      document.documentElement.style.overflowX = "hidden";
      document.documentElement.style.overflowY = "hidden";

      return () => {
        // Restore original values
        document.body.style.overflowX = originalOverflowX;
        document.body.style.overflowY = originalOverflowY;
        document.documentElement.style.overflowX = originalHtmlOverflowX;
        document.documentElement.style.overflowY = originalHtmlOverflowY;
      };
    }
  }, [mode, isCollapsed, hasEnvironment]);

  const handleCollapse = () => {
    setCollapsedMode(mode);
    setIsCollapsed(true);
  };

  const handleExpand = () => {
    setIsCollapsed(false);
    setMode(collapsedMode);
  };

  const handleToggleMode = () => {
    // When switching from fixed to window, capture current position
    if (mode === "fixed" && fixedRef.current) {
      const rect = fixedRef.current.getBoundingClientRect();
      setWindowState({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    }
    setMode((m) => (m === "fixed" ? "window" : "fixed"));
  };

  if (!hasEnvironment) return null;

  // Collapsed state
  if (isCollapsed) {
    return (
      <div className={`absolute ${topClass} right-14 lg:right-2 z-20`}>
        <button
          onClick={handleExpand}
          className="btn btn-square btn-primary w-12 h-12 shadow-lg"
          title="Show scene"
        >
          <span className="icon-[mdi--image] w-6 h-6" />
        </button>
      </div>
    );
  }

  // Fixed mode (top-right with hover-to-expand)
  if (mode === "fixed") {
    const maxVw = isHovered ? 50 : 40;
    const maxVh = isHovered ? 65 : 45;
    const emphasisClass = isHovered ? "brightness-100" : "brightness-90";
    const focusMaxWidthPercent = 35;
    const focusMaxHeightPercent = 50;

    return (
      <div
        ref={fixedRef}
        className={`absolute ${topClass} right-14 lg:right-2 z-20 ${emphasisClass} transition-all duration-300 ease-in-out`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div
          className="relative rounded-lg overflow-hidden shadow-xl border-2 border-base-300 transition-all duration-300 ease-in-out"
          style={{
            width: `min(${maxVw}vw, calc(${maxVh}vh * ${envAspect}))`,
            aspectRatio: `${envAspect}`,
          }}
        >
          <ImageDisplay
            imageId={scene.EnvironmentImageId}
            className="w-full h-full"
            alt="Scene environment"
          />

          {hasFocus && (
            <div
              className="absolute bottom-2 right-2 pointer-events-none transition-all duration-300 ease-in-out"
              style={{
                width: `min(${focusMaxWidthPercent}%, calc(${focusMaxHeightPercent}% * ${focusAspect}))`,
                aspectRatio: `${focusAspect}`,
              }}
            >
              <ImageDisplay
                imageId={scene.FocusImageId}
                className="w-full h-full rounded-lg border-2 border-base-300 bg-base-200/90 shadow-lg"
                alt="Scene focus"
              />
            </div>
          )}

          {/* Control buttons */}
          <div className="absolute top-2 right-2 flex gap-1 z-10">
            {!isMobile && (
              <button
                onClick={handleToggleMode}
                className="btn btn-circle btn-ghost btn-xs bg-base-100/50 hover:bg-base-100"
                title="Switch to window mode"
              >
                <span className="icon-[mdi--window-restore] w-4 h-4" />
              </button>
            )}
            <button
              onClick={handleCollapse}
              className="btn btn-circle btn-ghost btn-xs bg-base-100/50 hover:bg-base-100"
              title="Hide scene"
            >
              <span className="icon-[mdi--close] w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Window mode (draggable/resizable)
  const focusMaxWidthPercent = 35;
  const focusMaxHeightPercent = 50;

  const windowContent = (
    <Rnd
      position={{ x: windowState.x, y: windowState.y }}
      size={{ width: windowState.width, height: windowState.height }}
      onDragStop={(_e, d) => {
        // Final position constraint on drag stop
        const maxX = window.innerWidth - windowState.width;
        const maxY = window.innerHeight - windowState.height;
        
        setWindowState((prev: any) => ({
          ...prev,
          x: Math.max(0, Math.min(d.x, maxX)),
          y: Math.max(0, Math.min(d.y, maxY)),
        }));
      }}
      onResizeStop={(_e, _direction, ref, _delta, position) => {
        const newWidth = parseInt(ref.style.width);
        const newHeight = parseInt(ref.style.height);
        
        // Ensure window stays within viewport after resize
        const maxX = window.innerWidth - newWidth;
        const maxY = window.innerHeight - newHeight;
        
        setWindowState({
          width: newWidth,
          height: newHeight,
          x: Math.max(0, Math.min(position.x, maxX)),
          y: Math.max(0, Math.min(position.y, maxY)),
        });
      }}
      minWidth={200}
      minHeight={150}
      lockAspectRatio={envAspect}
      className="z-50"
      enableResizing={{
        top: true,
        right: true,
        bottom: true,
        left: true,
        topRight: true,
        bottomRight: true,
        bottomLeft: true,
        topLeft: true,
      }}
    >
      <div 
        className="w-full h-full rounded-lg overflow-hidden shadow-xl border-2 border-base-300 bg-base-100 cursor-move select-none"
        onMouseDown={(e) => {
          // Prevent image drag interference
          e.preventDefault();
        }}
      >
        <div className="relative w-full h-full">
          <ImageDisplay
            imageId={scene.EnvironmentImageId}
            className="w-full h-full object-contain pointer-events-none"
            alt="Scene environment"
          />

          {hasFocus && (
            <div
              className="absolute bottom-2 right-2 pointer-events-none"
              style={{
                width: `min(${focusMaxWidthPercent}%, calc(${focusMaxHeightPercent}% * ${focusAspect}))`,
                aspectRatio: `${focusAspect}`,
              }}
            >
              <ImageDisplay
                imageId={scene.FocusImageId}
                className="w-full h-full rounded-lg border-2 border-base-300 bg-base-200/90 shadow-lg pointer-events-none"
                alt="Scene focus"
              />
            </div>
          )}

          {/* Control buttons */}
          <div className="absolute top-2 right-2 flex gap-1 z-10 pointer-events-auto">
            <button
              onClick={handleToggleMode}
              className="btn btn-circle btn-ghost btn-xs bg-base-100/50 hover:bg-base-100"
              title="Switch to fixed mode"
            >
              <span className="icon-[mdi--pin] w-4 h-4" />
            </button>
            <button
              onClick={handleCollapse}
              className="btn btn-circle btn-ghost btn-xs bg-base-100/50 hover:bg-base-100"
              title="Hide scene"
            >
              <span className="icon-[mdi--close] w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </Rnd>
  );

  // Use portal to render window mode at body level (allows dragging over everything)
  return createPortal(windowContent, document.body);
}
