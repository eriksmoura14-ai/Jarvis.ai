import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/Jarvis.ai/' : '/',
  plugins: [react(), tailwindcss()],
  // Preserve the browser-facing Host so the API can validate same-origin requests
  // through the development proxy, including access from a phone on the LAN.
  server: { port: 5173, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false } } },
  build: { target: 'es2020', outDir: mode === 'pages' ? 'dist-pages' : 'dist' },
}));
