import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [
		react(),
		tailwindcss(),
		// WASM voxel mesher: vite-plugin-wasm emits the .wasm asset and rewrites
		// its URL for the configured base; top-level-await supports the glue's
		// async init inside the geometry worker. See docs/wasm-voxel-meshing-plan.md.
		wasm(),
		topLevelAwait(),
	],
	// Vite bundles Web Workers through a SEPARATE plugin pipeline, so the
	// top-level `plugins` above do NOT apply to voxelGeometryWorker.ts. The WASM
	// glue is imported inside that worker, so vite-plugin-wasm (+ top-level-await)
	// must be registered here too or the production build fails with
	// "ESM integration proposal for Wasm is not supported". `format: "es"` is
	// required because the worker is spawned as a module worker and the glue
	// relies on top-level await.
	worker: {
		format: "es",
		plugins: () => [wasm(), topLevelAwait()],
	},
	base: "/",
	server: {
		port: 3000,
	},
	build: {
		outDir: "build",
	},
});
