/**
 * public/maps/ のサンプルマップを生成する。
 *   npm run gen:samples
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HexMap, stringifyMapData } from '../src/core/mapData';
import { generateRandomMap } from '../src/core/randomMap';
import { deployDemoUnits } from '../src/core/units';

const outDir = fileURLToPath(new URL('../public/maps/', import.meta.url));

const samples = [
  { file: 'fluen.json', opt: { name: 'フルーエン近郊', seed: 3, cols: 16, rows: 16, orientation: 'flat' as const } },
  { file: 'pointy-test.json', opt: { name: 'pointy-top テスト', seed: 11, cols: 16, rows: 16, orientation: 'pointy' as const } },
];

for (const s of samples) {
  const map = new HexMap(generateRandomMap(s.opt));
  map.replaceUnits(deployDemoUnits(map));
  writeFileSync(outDir + s.file, stringifyMapData(map.toJSON()));
  console.log(`wrote ${s.file}`);
}
