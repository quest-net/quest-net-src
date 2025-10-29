import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [
		react(),
		tailwindcss(), // Add Tailwind as a Vite plugin
	],
	base: "/",
	server: {
		port: 3000,
	},
	build: {
		outDir: "build", // Keep 'build' folder for compatibility with your deploy script
	},
});
