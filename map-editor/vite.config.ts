import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { mapsPlugin } from '../map-runtime/server/vite-plugin-maps.ts';

/** ユニット画像の置き場所（リポジトリ直下。map-editor の外なので監視対象に加える） */
const unitImagesDir = fileURLToPath(new URL('../assets/units', import.meta.url));

export default defineConfig({
  base: './',
  server: { port: 5173 },
  plugins: [
    // マップ JSON はリポジトリ直下の assets/maps/ に読み書きする（battle-editor と共有）
    mapsPlugin({ mapsDir: fileURLToPath(new URL('../assets/maps', import.meta.url)) }),
    {
      name: 'watch-unit-images',
      // 画像を置いたり消したりしたら、開発サーバーを再起動しなくても反映されるようにする
      configureServer(server) {
        server.watcher.add(unitImagesDir);
      },
    },
  ],
});
