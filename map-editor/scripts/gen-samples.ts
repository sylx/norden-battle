/**
 * public/maps/ のサンプルマップを生成する。
 *   npm run gen:samples
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stringifyMapData } from '../src/core/mapData';
import { generateRandomMap } from '../src/core/randomMap';

const outDir = fileURLToPath(new URL('../public/maps/', import.meta.url));

const samples = [
  { file: 'fluen.json', opt: { name: 'フルーエン近郊', seed: 3, cols: 24, rows: 16, orientation: 'flat' as const } },
  { file: 'pointy-test.json', opt: { name: 'pointy-top テスト', seed: 11, cols: 16, rows: 12, orientation: 'pointy' as const } },
];

for (const s of samples) {
  writeFileSync(outDir + s.file, stringifyMapData(generateRandomMap(s.opt)));
  console.log(`wrote ${s.file}`);
}
