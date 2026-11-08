/**
 * マップの人工物（橋・村・砦・城）と荒地の岩のメッシュを組み立てる（1 つのメッシュにまとめる）。
 * 地形は変形させず、建物の基礎を地面に埋め込むことで斜面に対応する。
 * そのため人工物の配置だけが変わったときは地形を作り直さずにこれだけ呼べばよい。
 */
import * as THREE from 'three';
import type { HexMap } from '../../core/mapData.ts';
import type { RoadIndex } from '../../core/roads.ts';
import { Heightmap, type TerrainData } from '../../core/terrainGen.ts';
import { GeoBuilder } from '../geoBuilder.ts';
import { buildBridge } from './bridge.ts';
import { buildFortifications } from './fortifications.ts';
import { buildRocks } from './rocks.ts';
import { createStructureMaterial } from './material.ts';
import type { BuildCtx } from './shapes.ts';
import { buildVillage } from './village.ts';

export function buildStructures(map: HexMap, data: TerrainData, roads: RoadIndex): THREE.Group {
  const group = new THREE.Group();
  group.name = 'structures';
  const ctx: BuildCtx = {
    b: new GeoBuilder(true),
    hm: new Heightmap(data),
    map,
    s: map.layout.size,
    waterLevel: data.waterLevel,
    roads,
  };
  const seed = map.data.seed;
  for (const cell of map.allCells()) {
    if (cell.feature === 'village') buildVillage(ctx, cell, seed);
    else if (cell.feature === 'bridge') buildBridge(ctx, cell, seed);
  }
  buildFortifications(ctx, seed);
  buildRocks(ctx, seed);

  if (ctx.b.count > 0) {
    const mesh = new THREE.Mesh(ctx.b.build(), createStructureMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
