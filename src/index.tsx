// src/index.tsx
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initVoxelCodec } from "./utils/terrain/data/voxelCodecWasm";
// Register material passability / editor-color rules in the data layer before
// any terrain query runs. Eager (not lazy) so there is no window where
// spawn/collision sees unregistered defaults.
import "./components/Map/Terrain/materials";

// The SVO codec (terrain encode/decode) runs only in WASM -- there is no JS
// fallback -- and its public API is synchronous, so it must be ready before any
// terrain code runs. Block app start on it via top-level await; a failure here
// (e.g. a stale/missing pkg) hard-fails loudly instead of silently degrading.
await initVoxelCodec();

// Ask the browser to exempt this origin from storage eviction. Without it the
// origin is "best effort" and IndexedDB/OPFS (images + terrain voxels) can be
// silently wiped under storage pressure, which is exactly how DMs have lost
// binary data. Chrome grants this without a prompt on engagement heuristics;
// Firefox prompts; a denial just leaves us where we already were, so this is
// fire-and-forget and never blocks startup.
void navigator.storage?.persist?.().catch(() => {});

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
