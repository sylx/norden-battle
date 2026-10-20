/**
 * 地理情報からの街道マップの生成。
 *
 * 戦略マップの地形（標高・川と湖・山岳度・森・乾燥度と街道の経路）を読み取り、
 * 街道 A–B の両端の都市を描いた街道マップ（mapData.ts の link のあるマップ）を作る。
 *
 * - 北を上に固定し、2 つの都市がマップの内側に収まる縮尺にする（街道ごとに縮尺が変わる）。
 *   マップは 32×20（横長）か 20×32（縦長）で、縮尺が細かくなる方を選ぶ。
 * - 地形は HEX ごとに複数点を読んで決める。川は細いので、点の一部でも水なら川・浅瀬にする。
 * - 街道は経路の点列を HEX のつながりに直す。範囲を通る他の街道も描く（分岐・合流）。水の上は橋。
 * - 両端の都市はテンプレートの城・砦と、周りの村。
 * - 戦闘の範囲・初期配置地点・防衛拠点は仮の値（map-editor で手直しする前提）。
 *
 * 地理情報の読み取り元（GeoSource）は呼び出し側が用意する（座標は読み取り元のワールド座標）。
 */
import { axialDistance, axialRound, HexLayout, type Axial, type GridSpec, type Offset, type Vec2 } from './hex.ts';
import { snapBattleArea } from './battleArea.ts';
import { BATTLE_AREA_SIZE, HexMap, type BattleDeployment, type HexCell, type MapData } from './mapData.ts';
import { mulberry32, Noise } from './noise.ts';
import { dirBetween, setRoad } from './roads.ts';
import { TERRAIN_DEFS, type TerrainId } from './terrainTypes.ts';

/** 地理情報の 1 点 */
export interface GeoSample {
  /** 標高（0 以下は海） */
  elevation: number;
  /** 川・湖の水の割合 0..1（0.5 が岸） */
  water: number;
  /** 湖の中か（川ではなく） */
  lake: boolean;
  /** 川の大きさ 0..1 */
  river: number;
  /** 山岳度 0..1 */
  mountain: number;
  /** 森の密度 0..1 */
  forest: number;
  /** 乾燥度 0..1 */
  aridity: number;
}

export interface GeoSource {
  sample(x: number, z: number): GeoSample;
  /** 街道の経路（x, z の並び）。マップの範囲を通るものが描かれる */
  roads: readonly ArrayLike<number>[];
}

/**
 * 都市のテンプレート
 * - fort    : 砦（中心と周りの 7 HEX）
 * - castle-s: 小さな城（7 HEX。中心が内郭）
 * - castle-m: 城（内郭 7 HEX ＋ 攻め手の側の外郭 7 HEX）
 * - castle-l: 大きな城（19 HEX の三重の城壁）
 */
export type GeoCityTemplate = 'fort' | 'castle-s' | 'castle-m' | 'castle-l';

export interface GeoCity {
  /** 戦略マップの都市 ID */
  id: string;
  /** 読み取り元のワールド座標 */
  x: number;
  z: number;
  template: GeoCityTemplate;
  /** 周りに置く村の HEX 数 */
  villages: number;
}

export interface GeoRoadMapOptions {
  name: string;
  seed: number;
  source: GeoSource;
  /** link.cities の順 */
  cities: readonly [GeoCity, GeoCity];
  /** 2 都市の間の街道（x, z の並び）。攻撃側の初期配置地点の手がかり */
  road?: ArrayLike<number>;
}

/** マップの大きさ（横長の場合。縦長は cols と rows を入れ替える） */
export const GEO_MAP_SIZE = { cols: 32, rows: 20 } as const;

/** 都市の中心からマップの端までの最小の距離（ワールド座標、hexSize 1） */
const CITY_MARGIN = 6;
/** 標高の段の幅（読み取り元の標高の単位）の最小。山がちな街道では段が増えすぎないよう広げる */
const MIN_LEVEL_STEP = 1.5;
const MAX_LEVEL = 6;
/** HEX の中で地形を読む点（中心と 2 重の輪。hexSize 比） */
const SAMPLE_POINTS: readonly Vec2[] = [
  { x: 0, z: 0 },
  ...ring(6, 0.45, 0),
  ...ring(6, 0.8, Math.PI / 6),
];
/** 川・浅瀬にする、川の上にある点の数 */
const RIVER_HITS = 2;
/** 防衛側・攻撃側の初期配置地点の数 */
const DEFENDER_SLOTS = 16;
const ATTACKER_SLOTS = 9;
/** 攻撃側の初期配置地点を置く、防衛拠点からの最小の HEX 距離 */
const ATTACKER_MIN_DIST = 7;

function ring(n: number, r: number, phase: number): Vec2[] {
  return Array.from({ length: n }, (_, i) => {
    const a = phase + (i * 2 * Math.PI) / n;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  });
}

/** マップの中心ワールド座標の範囲（HEX の中心） */
function centerExtent(grid: GridSpec): { w: number; h: number } {
  return { w: (grid.cols - 1) * 1.5, h: Math.sqrt(3) * (grid.rows - 0.5) };
}

/** 都市の配置に合う向きのマップと、読み取り元 ↔ マップの座標変換 */
function frame(cities: readonly [GeoCity, GeoCity]) {
  const [a, b] = cities;
  const dx = Math.abs(a.x - b.x);
  const dz = Math.abs(a.z - b.z);
  const options = [GEO_MAP_SIZE, { cols: GEO_MAP_SIZE.rows, rows: GEO_MAP_SIZE.cols }].map((size) => {
    const grid: GridSpec = { orientation: 'flat', cols: size.cols, rows: size.rows, hexSize: 1 };
    const { w, h } = centerExtent(grid);
    // 読み取り元の 1 単位あたりのマップの長さの逆数（大きいほど広い範囲を縮めて描く）
    const scale = Math.max(dx / (w - 2 * CITY_MARGIN), dz / (h - 2 * CITY_MARGIN), 1e-3);
    return { grid, scale, w, h };
  });
  const { grid, scale, w, h } = options[0].scale <= options[1].scale ? options[0] : options[1];
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  return {
    grid,
    scale,
    toSource: (p: Vec2): Vec2 => ({ x: mx + (p.x - w / 2) * scale, z: mz + (p.z - h / 2) * scale }),
    toMap: (x: number, z: number): Vec2 => ({ x: w / 2 + (x - mx) / scale, z: h / 2 + (z - mz) / scale }),
  };
}

interface HexGeo {
  /** 陸の点の標高の平均（陸が無ければ中心の標高） */
  elevation: number;
  sea: boolean;
  lake: boolean;
  river: boolean;
  /** 中心の点が川の上か（端をかすめるだけの川と区別する） */
  riverCenter: boolean;
  mountain: number;
  forest: number;
  aridity: number;
}

function readHex(source: GeoSource, center: Vec2, toSource: (p: Vec2) => Vec2): HexGeo {
  let sea = 0, lake = 0, river = 0, land = 0, elev = 0, mountain = 0, forest = 0, aridity = 0;
  let centerElev = 0;
  let riverCenter = false;
  SAMPLE_POINTS.forEach((o, i) => {
    const p = toSource({ x: center.x + o.x, z: center.z + o.z });
    const s = source.sample(p.x, p.z);
    if (i === 0) {
      centerElev = s.elevation;
      riverCenter = s.elevation > 0 && !s.lake && s.water > 0.5;
    }
    mountain += s.mountain;
    forest += s.forest;
    aridity += s.aridity;
    if (s.elevation <= 0) return void sea++;
    if (s.lake) lake++;
    else if (s.water > 0.5) river++;
    land++;
    elev += s.elevation;
  });
  const n = SAMPLE_POINTS.length;
  return {
    elevation: land > 0 ? elev / land : centerElev,
    sea: sea * 2 > n,
    lake: lake * 2 > n,
    river: river >= RIVER_HITS,
    riverCenter,
    mountain: mountain / n,
    forest: forest / n,
    aridity: aridity / n,
  };
}

const quantile = (values: number[], q: number) => {
  const s = [...values].sort((p, r) => p - r);
  return s.length > 0 ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};

/** 点列（マップの座標）が通る HEX（軸座標）。行き戻り・小さな輪は切り詰める */
function traceHexes(layout: HexLayout, points: readonly Vec2[]): Axial[] {
  const out: Axial[] = [];
  const index = new Map<string, number>();
  const key = (a: Axial) => `${a.q},${a.r}`;
  const push = (a: Axial) => {
    const seen = index.get(key(a));
    if (seen !== undefined) {
      for (let i = seen + 1; i < out.length; i++) index.delete(key(out[i]));
      out.length = seen + 1;
      return;
    }
    index.set(key(a), out.length);
    out.push(a);
  };
  for (const p of points) {
    const a = layout.worldToAxial(p.x, p.z);
    const last = out[out.length - 1];
    if (!last) {
      push(a);
      continue;
    }
    const n = axialDistance(last, a);
    // 頂点をまたいで飛んだときは間の HEX を補う
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      push(axialRound(last.q + (a.q - last.q) * t + 1e-6, last.r + (a.r - last.r) * t + 1e-6));
    }
  }
  return out;
}

function pointsOf(path: ArrayLike<number>, toMap: (x: number, z: number) => Vec2): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i + 1 < path.length; i += 2) out.push(toMap(path[i], path[i + 1]));
  return out;
}

/** テンプレートの城・砦の HEX（中心からの軸座標）と郭の段 */
function templateCells(template: GeoCityTemplate, front: Vec2, layout: HexLayout): { a: Axial; ward: number }[] {
  const center = { q: 0, r: 0 };
  const within = (d: number) => {
    const out: Axial[] = [];
    for (let q = -d; q <= d; q++) for (let r = Math.max(-d, -q - d); r <= Math.min(d, -q + d); r++) out.push({ q, r });
    return out;
  };
  const dist = (a: Axial) => axialDistance(center, a);
  switch (template) {
    case 'fort':
    case 'castle-s':
      return within(1).map((a) => ({ a, ward: template === 'castle-s' && dist(a) === 0 ? 2 : 1 }));
    case 'castle-m': {
      const outer = within(2)
        .filter((a) => dist(a) === 2)
        .map((a) => ({ a, d: dot(layout.axialToWorld(a.q, a.r), front) }))
        .sort((p, r) => r.d - p.d)
        .slice(0, 7)
        .map(({ a }) => ({ a, ward: 1 }));
      return [...within(1).map((a) => ({ a, ward: 2 })), ...outer];
    }
    case 'castle-l':
      return within(2).map((a) => ({ a, ward: 3 - dist(a) }));
  }
}

const dot = (p: Vec2, q: Vec2) => p.x * q.x + p.z * q.z;

/** 戦略マップの地理情報から街道マップを作る */
export function generateGeoRoadMap(opt: GeoRoadMapOptions): MapData {
  const { source, cities } = opt;
  const { grid, toSource, toMap } = frame(cities);
  const layout = new HexLayout(grid);
  const noise = new Noise(opt.seed);
  const { cols, rows } = grid;
  const idx = (o: Offset) => o.row * cols + o.col;
  const inBounds = (o: Offset) => layout.inBounds(o.col, o.row);

  // --- 地形 ---
  const geo: HexGeo[] = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) geo.push(readHex(source, layout.offsetToWorld(col, row), toSource));
  const landElev = geo.filter((g) => !g.sea && !g.lake && !g.river).map((g) => g.elevation);
  const base = quantile(landElev, 0.05);
  const step = Math.max(MIN_LEVEL_STEP, (quantile(landElev, 0.98) - base) / (MAX_LEVEL - 1));

  const cells: HexCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const g = geo[row * cols + col];
      const w = layout.offsetToWorld(col, row);
      const n1 = noise.fbm(w.x * 0.33, w.z * 0.33, 3);
      const n2 = noise.fbm(w.x * 0.21 + 50, w.z * 0.21 - 30, 3);
      // 戦略マップの縮尺では見えない木立・小丘
      const copse = noise.fbm(w.x * 0.27 - 70, w.z * 0.27 + 20, 3);
      const knoll = noise.fbm(w.x * 0.4 + 15, w.z * 0.4 + 80, 2);
      let terrain: TerrainId;
      let elevation = 0;
      if (g.sea) terrain = g.elevation < -1 ? 'deep_water' : 'water';
      else if (g.lake) terrain = 'deep_water';
      else if (g.river) terrain = 'water';
      else {
        elevation = Math.min(MAX_LEVEL, Math.max(1, 1 + Math.round((g.elevation - base) / step + n1 * 0.3)));
        const dry = g.aridity + n1 * 0.2;
        if (g.mountain > 0.7 && g.elevation > 15 && n2 > 0) terrain = 'snow';
        else if (g.mountain + n1 * 0.1 > 0.58) terrain = 'mountain';
        else if (g.mountain + n1 * 0.15 > 0.3 || knoll > 0.5) terrain = 'hills';
        else if (g.forest + n2 * 0.35 > 0.45 || (copse > 0.28 && dry < 0.3)) terrain = 'forest';
        else if (dry > 0.7) terrain = copse > 0.35 ? 'wasteland' : 'desert';
        else if (dry > 0.35 || n2 > 0.55) terrain = 'wasteland';
        else terrain = 'plains';
      }
      cells.push({ col, row, terrain, elevation });
    }
  }
  const at = (o: Offset) => cells[idx(o)];
  const isWater = (o: Offset) => TERRAIN_DEFS[at(o).terrain].isWater;
  // 湖の岸と、陸に接する海は浅瀬
  for (const c of cells) {
    if (c.terrain !== 'deep_water') continue;
    const g = geo[idx(c)];
    if (g.lake ? layout.neighbors(c.col, c.row).some((n) => !geo[idx(n)].lake) : layout.neighbors(c.col, c.row).some((n) => !isWater(n)))
      c.terrain = 'water';
  }
  // 水辺の低地の一部は湿地
  for (const c of cells) {
    if (c.elevation !== 1 || c.terrain === 'forest' || TERRAIN_DEFS[c.terrain].isWater) continue;
    const w = layout.offsetToWorld(c.col, c.row);
    if (layout.neighbors(c.col, c.row).some((n) => isWater(n) && !geo[idx(n)].sea) && noise.fbm(w.x * 0.5 - 90, w.z * 0.5, 2) > 0.25)
      c.terrain = 'swamp';
  }

  const map = new HexMap({ version: 1, name: opt.name, seed: opt.seed, grid, cells });
  const cell = (o: Offset) => map.get(o.col, o.row)!;

  // --- 都市（テンプレートの城・砦） ---
  const placed = cities.map((city, i) => {
    const other = cities[1 - i];
    const p = toMap(city.x, city.z);
    const q = toMap(other.x, other.z);
    const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    const front = { x: (q.x - p.x) / len, z: (q.z - p.z) / len };
    const center = nearestLand(layout, layout.worldToOffset(p.x, p.z), (o) => inBounds(o) && !isWater(o));
    const ca = layout.offsetToAxial(center.col, center.row);
    const level = cell(center).elevation || 1;
    const feature = city.template === 'fort' ? 'fort' : 'castle';
    const footprint: Offset[] = [];
    for (const { a, ward } of templateCells(city.template, front, layout)) {
      const o = layout.axialToOffset(ca.q + a.q, ca.r + a.r);
      // 城の中を流れる川は埋める（海・湖の岸では城がそこで切れる）
      if (!inBounds(o) || (isWater(o) && !geo[idx(o)].river)) continue;
      const c = cell(o);
      c.terrain = 'plains';
      c.elevation = level;
      map.setFeature(o.col, o.row, feature, undefined, ward);
      footprint.push(o);
    }
    return { city, center, front, footprint };
  });

  // --- 街道 ---
  const tracedRoads = source.roads.map((path) => traceHexes(layout, pointsOf(path, toMap)).map((a) => layout.axialToOffset(a.q, a.r)));
  for (const hexes of tracedRoads) {
    for (let i = 1; i < hexes.length; i++) {
      const a = hexes[i - 1];
      const b = hexes[i];
      if (inBounds(a) && inBounds(b)) setRoad(map, a, b, true);
      else if (inBounds(a) || inBounds(b)) {
        // マップの端から出入りする道（外側の方向だけ持たせる）
        const [inner, outer] = inBounds(a) ? [a, b] : [b, a];
        const c = cell(inner);
        c.roads = [...new Set([...(c.roads ?? []), dirBetween(map, inner, outer)])].sort((p, q) => p - q);
      }
    }
  }
  // 水の上の道は橋。川の端をかすめるだけの道は岸の陸にする（川沿いの道に橋が並ばないように）
  for (const c of map.allCells()) {
    if (!c.roads || !TERRAIN_DEFS[c.terrain].isWater) continue;
    const g = geo[idx(c)];
    if (g.river && !g.riverCenter) {
      const banks = layout.neighbors(c.col, c.row).map(cell).filter((n) => !TERRAIN_DEFS[n.terrain].isWater);
      c.terrain = 'plains';
      c.elevation = Math.max(1, Math.min(...banks.map((n) => n.elevation), MAX_LEVEL));
      continue;
    }
    c.terrain = 'water';
    map.setFeature(c.col, c.row, 'bridge');
  }

  // --- 村 ---
  const rand = mulberry32(opt.seed * 31 + 7);
  for (const { city, center, footprint } of placed) {
    const taken = new Set(footprint.map(idx));
    const reach = Math.max(...footprint.map((o) => hexDist(layout, center, o)), 0);
    const candidates: { o: Offset; score: number }[] = [];
    for (const c of map.allCells()) {
      const d = hexDist(layout, center, c);
      if (d < reach + 2 || d > reach + 4 || c.feature || TERRAIN_DEFS[c.terrain].isWater || c.terrain === 'mountain' || c.terrain === 'snow') continue;
      const nearRoad = c.roads || layout.neighbors(c.col, c.row).some((n) => cell(n).roads);
      candidates.push({ o: { col: c.col, row: c.row }, score: (nearRoad ? 2 : 0) + (c.terrain === 'plains' ? 1 : 0) - (d - reach - 2) * 0.5 + rand() * 1.5 });
    }
    candidates.sort((p, q) => q.score - p.score);
    const villages: Offset[] = [];
    for (const { o } of candidates) {
      if (villages.length >= city.villages) break;
      if (villages.some((v) => hexDist(layout, v, o) < 2) || taken.has(idx(o))) continue;
      villages.push(o);
      const c = cell(o);
      if (c.terrain === 'forest' || c.terrain === 'swamp') c.terrain = 'plains';
      map.setFeature(o.col, o.row, 'village');
    }
  }

  // --- 戦闘の範囲・防衛拠点・初期配置地点（仮） ---
  const battleAreas: Record<string, Offset> = {};
  const strongholds: Record<string, Offset> = {};
  const deployments: Record<string, BattleDeployment> = {};
  const passable = (o: Offset) => {
    const c = cell(o);
    return !TERRAIN_DEFS[c.terrain].isWater && TERRAIN_DEFS[c.terrain].moveCost !== null;
  };
  const roadHexes = opt.road ? traceHexes(layout, pointsOf(opt.road, toMap)).map((a) => layout.axialToOffset(a.q, a.r)) : [];
  for (const { city, center, front, footprint } of placed) {
    // 都市を範囲の奥寄りに置き、手前（もう一方の都市の側）を広く取る
    const cw = layout.offsetToWorld(center.col, center.row);
    const target = { x: cw.x + front.x * 4.5 - 7.5 * 1.5, z: cw.z + front.z * 4.5 - 7.5 * Math.sqrt(3) };
    let area = snapBattleArea(map.data, layout.worldToOffset(target.x, target.z));
    const keep = 3;
    area = snapBattleArea(map.data, {
      col: Math.min(Math.max(area.col, center.col - (BATTLE_AREA_SIZE.cols - 1 - keep)), center.col - keep),
      row: Math.min(Math.max(area.row, center.row - (BATTLE_AREA_SIZE.rows - 1 - keep)), center.row - keep),
    });
    const inArea = (o: Offset) =>
      o.col >= area.col && o.row >= area.row && o.col < area.col + BATTLE_AREA_SIZE.cols && o.row < area.row + BATTLE_AREA_SIZE.rows;
    battleAreas[city.id] = area;
    strongholds[city.id] = { ...center };

    const used = new Set<number>();
    const defender = [...footprint, ...ringsAround(layout, footprint, 2).filter(passable)]
      .filter((o) => inArea(o))
      .slice(0, DEFENDER_SLOTS);
    defender.forEach((o) => used.add(idx(o)));

    // 攻撃側: 街道が範囲に入ってくる HEX の周り（街道が無ければ範囲の手前の端）
    const fromCity = roadHexes.length > 0 && hexDist(layout, roadHexes[0], center) > hexDist(layout, roadHexes[roadHexes.length - 1], center)
      ? [...roadHexes].reverse()
      : roadHexes;
    let entry: Offset | undefined;
    for (const o of fromCity) if (inBounds(o) && inArea(o)) entry = o;
    if (!entry) {
      const ew = { x: cw.x + front.x * 20, z: cw.z + front.z * 20 };
      entry = layout.worldToOffset(ew.x, ew.z);
    }
    const ew = layout.offsetToWorld(entry.col, entry.row);
    const attacker = map
      .allCells()
      .filter((c) => inArea(c) && passable(c) && !c.feature && !used.has(idx(c)) && hexDist(layout, c, center) >= ATTACKER_MIN_DIST)
      .map((c) => ({ o: { col: c.col, row: c.row }, d: Math.hypot(layout.offsetToWorld(c.col, c.row).x - ew.x, layout.offsetToWorld(c.col, c.row).z - ew.z) }))
      .sort((p, q) => p.d - q.d)
      .slice(0, ATTACKER_SLOTS)
      .map(({ o }) => o);
    deployments[city.id] = { attacker, defender: defender.map((o) => ({ col: o.col, row: o.row })) };
  }

  const out = map.toJSON();
  return {
    ...out,
    link: { cities: [cities[0].id, cities[1].id] },
    battleAreas,
    strongholds,
    deployments,
  };
}

function hexDist(layout: HexLayout, a: Offset, b: Offset): number {
  return axialDistance(layout.offsetToAxial(a.col, a.row), layout.offsetToAxial(b.col, b.row));
}

/** start から近い順に探して、ok を満たす最初の HEX（無ければ start） */
function nearestLand(layout: HexLayout, start: Offset, ok: (o: Offset) => boolean): Offset {
  if (ok(start)) return start;
  const seen = new Set([`${start.col},${start.row}`]);
  let frontier = [start];
  for (let d = 0; d < 6 && frontier.length > 0; d++) {
    const next: Offset[] = [];
    for (const o of frontier) {
      for (const n of layout.neighbors(o.col, o.row)) {
        const k = `${n.col},${n.row}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (ok(n)) return n;
        next.push(n);
      }
    }
    frontier = next;
  }
  return start;
}

/** HEX の集まりの外側 depth 重の HEX（内側から順に） */
function ringsAround(layout: HexLayout, hexes: readonly Offset[], depth: number): Offset[] {
  const seen = new Set(hexes.map((o) => `${o.col},${o.row}`));
  const out: Offset[] = [];
  let frontier = [...hexes];
  for (let d = 0; d < depth; d++) {
    const next: Offset[] = [];
    for (const o of frontier) {
      for (const n of layout.neighbors(o.col, o.row)) {
        const k = `${n.col},${n.row}`;
        if (seen.has(k)) continue;
        seen.add(k);
        next.push(n);
      }
    }
    out.push(...next);
    frontier = next;
  }
  return out;
}
