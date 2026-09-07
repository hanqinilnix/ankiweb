import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['sql-wasm.wasm'],
      manifest: {
        name: 'Anki Local',
        short_name: 'Anki',
        display: 'standalone',
        background_color: '#111',
        theme_color: '#111',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,wasm,svg}'], maximumFileSizeToCacheInBytes: 5e6 },
    }),
  ],
  test: { environment: 'node' },
});
