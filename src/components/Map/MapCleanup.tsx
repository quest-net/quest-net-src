// MapCleanup.tsx
import { useApplication } from "@pixi/react";
import { useEffect } from "react";

export function HardDestroyOnUnmount({ nukeTextures = false }: { nukeTextures?: boolean }) {
  const { app } = useApplication();

  useEffect(() => {
    return () => {
      try {
        // Stop any updates immediately
        app.ticker?.stop?.();

        // Optional: clear the stage (defensive)
        app.stage?.removeChildren?.();

        // v8 destroy signature:
        // destroy(removeView?: boolean,
        //         stageOptions?: { children?: boolean; texture?: boolean; textureSource?: boolean },
        //         contextOptions?: { context?: boolean })
        app.destroy(
          /* removeView */ true,
          /* stageOptions */ { children: true, texture: nukeTextures, textureSource: nukeTextures },
          /* contextOptions */  // <- IMPORTANT for Graphics buffers in v8
        );
      } catch {
        /* ignore */
      }
    };
  }, [app, nukeTextures]);

  return null;
}
