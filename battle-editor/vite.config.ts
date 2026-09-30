import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { mapsPlugin } from '../map-runtime/server/vite-plugin-maps.ts';

/** ユニット画像の置き場所（リポジトリ直下。battle-editor の外なので監視対象に加える） */
const unitImagesDir = fileURLToPath(new URL('../assets/units', import.meta.url));

export default defineConfig({
  base: './',
  server: { port: 5175 },
  plugins: [
    // map-editor で保存したマップ（assets/maps/）を読み込む。ここからは書き込まない
    mapsPlugin({ mapsDir: fileURLToPath(new URL('../assets/maps', import.meta.url)), readOnly: true }),
    {
      name: 'watch-unit-images',
      configureServer(server) {
        server.watcher.add(unitImagesDir);
      },
    },
  ],
});
