import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()  // Add Tailwind as a Vite plugin
  ],
  base: '/',
  server: {
    https: {
      key: fs.readFileSync('./localhost+3-key.pem'),
      cert: fs.readFileSync('./localhost+3.pem')
    },
    host: true
  },
  build: {
    outDir: 'build', // Keep 'build' folder for compatibility with your deploy script
  },
})