import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { mapsPlugin } from '../map-runtime/server/vite-plugin-maps.ts';

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));
/** ユニット画像の置き場所（リポジトリ直下。battle-editor の外なので監視対象に加える） */
const unitImagesDir = local('../assets/units');
/** norden-ui（リポジトリの隣。nordencult では同じ親の下のサブモジュール）。ソースをそのまま使う */
const nordenUiDir = local('../../norden-ui');

export default defineConfig({
  base: './',
  server: {
    allowedHosts: ['78b2-113-37-101-195.ngrok-free.app'],
    port: 5175,
    // norden-battle の外にある norden-ui のソース・画像も配る
    fs: { allow: [local('..'), nordenUiDir] },
  },
  resolve: {
    alias: [{ find: /^norden-ui$/, replacement: `${nordenUiDir}/src/index.ts` }],
    // norden-ui の中から import する react も、こちらの node_modules のものにそろえる（2 つ読み込まないように）
    dedupe: ['react', 'react-dom', 'three'],
  },
  plugins: [
    react(),
    // map-editor で保存したマップ（assets/maps/）を読み込む。ここからは書き込まない
    mapsPlugin({ mapsDir: local('../assets/maps'), readOnly: true }),
    {
      name: 'watch-unit-images',
      configureServer(server) {
        server.watcher.add(unitImagesDir);
      },
    },
  ],
});
