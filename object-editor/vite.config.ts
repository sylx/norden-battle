import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { assetsApi } from './server/vite-plugin-assets.ts';

export default defineConfig({
  base: './',
  server: { port: 5174 },
  plugins: [assetsApi({ assetsDir: fileURLToPath(new URL('../assets', import.meta.url)) })],
});
