/**
 * 対戦シミュレータ（sim/cli.ts）を Node で動かす（npm run sim）。TypeScript とワークスペースのパッケージは Vite のモジュールランナーで読む。
 */
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const local = (path) => fileURLToPath(new URL(path, import.meta.url));

try {
  const { module } = await runnerImport(local('./cli.ts'), { configFile: false, root: local('..'), logLevel: 'error' });
  module.main(process.argv.slice(2), local('../../assets/maps'));
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
