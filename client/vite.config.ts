/// <reference types="vitest/config" />
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    port: 5173,
    // The API runs on :4000; proxying keeps the refresh cookie same-origin in development.
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:4000', changeOrigin: false } },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3')) return 'charts';
          if (id.includes('node_modules/leaflet') || id.includes('react-leaflet')) return 'maps';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    css: false,
  },
});
