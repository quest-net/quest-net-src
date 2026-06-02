// src/index.tsx
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initVoxelCodec } from "./utils/terrain/data/voxelCodecWasm";

// The SVO codec (terrain encode/decode) runs only in WASM -- there is no JS
// fallback -- and its public API is synchronous, so it must be ready before any
// terrain code runs. Block app start on it via top-level await; a failure here
// (e.g. a stale/missing pkg) hard-fails loudly instead of silently degrading.
await initVoxelCodec();

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
