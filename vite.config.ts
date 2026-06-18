import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// https://vitejs.dev/config/
export default defineConfig(async () => {
	// rollup-plugin-visualizer is ESM-only; this config is loaded via require
	// (no "type": "module" in package.json), so it must be imported dynamically.
	const { visualizer } = await import("rollup-plugin-visualizer");
	return {
	plugins: [
		react(),
		tailwindcss(),
		// WASM voxel mesher: vite-plugin-wasm emits the .wasm asset and rewrites
		// its URL for the configured base; top-level-await supports the glue's
		// async init inside the geometry worker. See docs/wasm-voxel-meshing-plan.md.
		wasm(),
		topLevelAwait(),
		// Bundle-size report: writes build/stats.html after a build. Set ANALYZE
		// to also open it automatically (e.g. ANALYZE=1 npm run build).
		visualizer({
			filename: "build/stats.html",
			template: "treemap",
			gzipSize: true,
			brotliSize: true,
			open: process.env.ANALYZE === "1",
		}),
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
		// Above our largest chunk (the app `index` chunk, ~1.7 MB) so the noisy
		// size warning stays quiet, but real future growth still trips it.
		chunkSizeWarningLimit: 1800,
		rollupOptions: {
			output: {
				// Split large, stable vendor libraries into their own chunks.
				// GitHub Pages can't set Cache-Control, but Vite's content-hashed
				// filenames mean these chunks keep their URL across deploys as long
				// as the dependency is unchanged - so returning visitors re-download
				// only the app code that actually changed, and the browser fetches
				// the vendor chunks in parallel over HTTP/2.
				manualChunks(id) {
					if (!id.includes("node_modules")) return;
					// Three.js + its post-processing pass (the 3D map stack).
					if (id.includes("/three/") || id.includes("/postprocessing/"))
						return "vendor-three";
					// mathjs and the number libs it still drags in.
					if (
						id.includes("/mathjs/") ||
						id.includes("/decimal.js/") ||
						id.includes("/typed-function/") ||
						id.includes("/complex.js/") ||
						id.includes("/fraction.js/")
					)
						return "vendor-mathjs";
					// React runtime, router, and the RND panel libs built on it.
					if (
						id.includes("/react/") ||
						id.includes("/react-dom/") ||
						id.includes("/react-router") ||
						id.includes("/react-rnd/") ||
						id.includes("/react-draggable/") ||
						id.includes("/re-resizable/") ||
						id.includes("/scheduler/")
					)
						return "vendor-react";
					// Animation libraries (gsap + the motion/framer-motion family).
					if (
						id.includes("/gsap/") ||
						id.includes("/framer-motion/") ||
						id.includes("/motion-dom/") ||
						id.includes("/motion-utils/") ||
						id.includes("/motion/")
					)
						return "vendor-motion";
					// Everything else (trystero, colorjs.io, valtio, etc.).
					return "vendor";
				},
			},
		},
	},
	};
});
