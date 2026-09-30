import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/** ユニット画像の置き場所（リポジトリ直下。map-editor の外なので監視対象に加える） */
const unitImagesDir = fileURLToPath(new URL('../assets/units', import.meta.url));

export default defineConfig({
  base: './',
  server: { port: 5173 },
  plugins: [
    {
      name: 'watch-unit-images',
      // 画像を置いたり消したりしたら、開発サーバーを再起動しなくても反映されるようにする
      configureServer(server) {
        server.watcher.add(unitImagesDir);
      },
    },
  ],
});
