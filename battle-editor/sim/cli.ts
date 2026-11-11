/**
 * 対戦シミュレータ（npm run sim）。描画なしで CPU（やランダムな打ち手）どうしを何度も戦わせ、勝率・決着の理由・ターン数・
 * 兵種ごとのダメージを表に出す。シードを固定すれば同じ結果になる。run.mjs が Vite のモジュールランナーでこのファイルを動かす。
 *
 *   npm run sim -- [--map <ファイル|all>] [--area <都市 ID>] [--runs 20] [--seed 1] [--max-turns 30]
 *                  [--attacker normal] [--defender normal] [--rosters rosters.json] [--attacker-faction <勢力 ID>] [--defender-faction <勢力 ID>]
 *                  [--attacker-style roster] [--defender-style roster] [--no-retreat] [--verbose] [--trace]
 *
 * - マップ: assets/maps/ のファイル（既定は戦闘の範囲のある最初のファイル）。all ならすべてのマップのすべての範囲を回す。
 *   範囲は既定で最初のもの。マップの範囲を切り出し、両軍を配備して始める（CPU は兵種に合わせて置く。basic・random は battle-editor の「自動配置」と同じ）
 * - 打ち手: 陣営ごとに easy・normal・hard（CPU の難易度）、basic（段階 1 の CPU。BASIC_FEATURES）、random（ランダムな仮の打ち手）。
 *   --attacker-off・--defender-off で CPU の考える要素（CpuFeatures の allAttacks・danger・stances・strategy・focus・teamwork・personality・deploy）を切れる
 *   （どの要素が効いているかを比べる）。--attacker-noise・--defender-noise で、手を選ぶときのノイズ（点数）を難易度のものから変えられる
 * - 性格: --attacker-style・--defender-style で、その陣営のすべての部隊（軍団長も）の騎士の性格を aggressive・cautious・valiant・pragmatic・none（標準）に
 *   差し替える（既定の roster は編成の騎士の性格のまま）。陣営ごとの手の傾向（敵との距離・自分からの退却・構え・鼓舞・兵の損耗）を表に出す
 * - 編成: battle-editor の部隊の道具の「編成を書き出す」で書き出した JSON（--rosters）。無ければ勢力 ID ごとの既定の編成
 *   （--attacker-faction・--defender-faction。省略すると battle-editor の既定と同じ）
 * - 退却先: 既定は両軍にダミーの拠点を 1 つずつ渡す（退却・強制退却が起きる）。--no-retreat で渡さない
 * - --verbose で 1 戦ごとの結果と同じ所の行き来、--trace でさらに行動を 1 つずつ出す（範囲とシードを絞って使う）
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cropBattleArea } from '@norden/map-runtime/core/battleArea';
import { HexMap, parseMapData, type MapData } from '@norden/map-runtime/core/mapData';
import { UNIT_DEFS, type TeamId, type UnitData, type UnitType } from '@norden/map-runtime/core/units';
import { BASIC_FEATURES, cpuPlayer, DIFFICULTIES, FULL_FEATURES, type CpuFeatures, type Difficulty } from '@norden/battle-runtime/cpu';
import { createBattleState, randomPlayer, type BattleState, runBattle, seededRng, type ExecuteReport, type FacilityReport, type Player, type SplashHit } from '@norden/battle-runtime/engine';
import { axialDistance } from '@norden/map-runtime/core/hex';
import {
  ATTACK_DEFS,
  BATTLE_END_REASON_NAMES,
  BATTLE_STYLES,
  Deployment,
  FACILITY_NAMES,
  SIDE_NAMES,
  SIDE_TEAM,
  type BattleEndReason,
  type BattleStyle,
  type RetreatDestinations,
} from '@norden/battle-runtime/rules';
import { DEFAULT_ROSTERS, defaultRoster, factionName, parseRosters, rosterStatuses, rosterTroops, type Rosters } from '../src/gameKnights';

/** 打ち手: CPU の難易度・段階 1 の CPU（basic）・ランダムな仮の打ち手（random） */
type Who = Difficulty | 'basic' | 'random';
/** 陣営の部隊の性格: 編成の騎士のまま（roster）・標準（none）・すべて差し替える */
type Style = 'roster' | 'none' | BattleStyle;
type Side = 'attacker' | 'defender';

interface Args {
  map: string | null;
  area: string | null;
  runs: number;
  seed: number;
  maxTurns: number;
  attacker: Who;
  defender: Who;
  /** CPU の考える要素のうち切るもの（陣営ごと） */
  attackerOff: (keyof CpuFeatures)[];
  defenderOff: (keyof CpuFeatures)[];
  attackerStyle: Style;
  defenderStyle: Style;
  /** 手を選ぶときのノイズ（省略すると難易度のもの） */
  attackerNoise: number | null;
  defenderNoise: number | null;
  rosters: string | null;
  attackerFaction: string | null;
  defenderFaction: string | null;
  retreat: boolean;
  verbose: boolean;
  /** 行動を 1 つずつ出す */
  trace: boolean;
}

const USAGE = `npm run sim -- [--map <ファイル|all>] [--area <都市 ID>] [--runs 20] [--seed 1] [--max-turns 30]
                 [--attacker easy|normal|hard|basic|random] [--defender easy|normal|hard|basic|random]
                 [--attacker-off <要素,…>] [--defender-off <要素,…>]
                 [--attacker-style roster|none|aggressive|cautious|valiant|pragmatic] [--defender-style …]
                 [--attacker-noise <点数>] [--defender-noise <点数>]
                 [--rosters rosters.json] [--attacker-faction <勢力 ID>] [--defender-faction <勢力 ID>] [--no-retreat] [--verbose] [--trace]`;

function parseArgs(argv: readonly string[]): Args {
  const a: Args = { map: null, area: null, runs: 20, seed: 1, maxTurns: 30, attacker: 'normal', defender: 'normal', attackerOff: [], defenderOff: [], attackerStyle: 'roster', defenderStyle: 'roster', attackerNoise: null, defenderNoise: null, rosters: null, attackerFaction: null, defenderFaction: null, retreat: true, verbose: false, trace: false };
  const who = (v: string): Who => {
    if (v === 'random' || v === 'basic' || (DIFFICULTIES as readonly string[]).includes(v)) return v as Who;
    throw new Error(`打ち手は easy・normal・hard・basic・random のどれか: ${v}`);
  };
  const style = (v: string): Style => {
    if (v === 'roster' || v === 'none' || (BATTLE_STYLES as readonly string[]).includes(v)) return v as Style;
    throw new Error(`性格は roster・none・${BATTLE_STYLES.join('・')} のどれか: ${v}`);
  };
  const off = (v: string): (keyof CpuFeatures)[] =>
    v.split(',').map((f) => {
      if (!(f in FULL_FEATURES)) throw new Error(`切れる要素は ${Object.keys(FULL_FEATURES).join('・')}: ${f}`);
      return f as keyof CpuFeatures;
    });
  const num = (v: string, name: string): number => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${name} は数: ${v}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${key} の値がない`);
      return v;
    };
    if (key === '--map') a.map = next();
    else if (key === '--area') a.area = next();
    else if (key === '--runs') a.runs = num(next(), key);
    else if (key === '--seed') a.seed = num(next(), key);
    else if (key === '--max-turns') a.maxTurns = num(next(), key);
    else if (key === '--attacker') a.attacker = who(next());
    else if (key === '--defender') a.defender = who(next());
    else if (key === '--attacker-off') a.attackerOff = off(next());
    else if (key === '--defender-off') a.defenderOff = off(next());
    else if (key === '--attacker-noise') a.attackerNoise = num(next(), key);
    else if (key === '--defender-noise') a.defenderNoise = num(next(), key);
    else if (key === '--attacker-style') a.attackerStyle = style(next());
    else if (key === '--defender-style') a.defenderStyle = style(next());
    else if (key === '--rosters') a.rosters = next();
    else if (key === '--attacker-faction') a.attackerFaction = next();
    else if (key === '--defender-faction') a.defenderFaction = next();
    else if (key === '--no-retreat') a.retreat = false;
    else if (key === '--verbose') a.verbose = true;
    else if (key === '--trace') a.trace = a.verbose = true;
    else if (key === '--help' || key === '-h') throw new Error(USAGE);
    else throw new Error(`知らない引数: ${key}\n${USAGE}`);
  }
  return a;
}

const playerOf = (who: Who, off: readonly (keyof CpuFeatures)[], noise: number | null): Player => {
  if (who === 'random') return randomPlayer;
  // 段階 1 の CPU はノイズ無し（段階 2 までと同じ）
  const features: Partial<CpuFeatures> = who === 'basic' ? { ...BASIC_FEATURES } : {};
  for (const f of off) features[f] = false;
  return cpuPlayer({ difficulty: who === 'basic' ? 'normal' : who, features, noise: noise ?? (who === 'basic' ? 0 : undefined) });
};

/** 兵種ごとの集計 */
interface TypeStats {
  dealt: number;
  taken: number;
  friendly: number;
  wipedOut: number;
}

/** 陣営ごとの手の傾向 */
interface SideStats {
  /** 行動の数と、行動を終えたときのいちばん近い敵までの距離の合計（前に出る度合い） */
  actions: number;
  distance: number;
  /** 自分から退却した部隊（軍団長でない） */
  retreats: number;
  /** 負けを認めた（軍団長の部隊が自分から退却した） */
  concedes: number;
  intercepts: number;
  inspires: number;
  /** 攻撃した回数・相手の軍団長の部隊を狙った回数・攻撃で相手を殲滅した回数 */
  attacks: number;
  commanderHits: number;
  kills: number;
  /** 敵ユニットを狙う攻撃で与えた・反撃で受けた兵数 */
  dealt: number;
  countered: number;
  /** 敵ユニットを狙う攻撃の数と、狙った相手の攻撃の前の兵の残り（戦闘の初めに対する割合）の合計 */
  aimed: number;
  aimedHealth: number;
  /** 殲滅された部隊・軍団長の部隊 */
  wipedOut: number;
  commanderLost: number;
  /** 戦闘の初めの兵数と、失った兵数（殲滅・退却した部隊の残りは失ったものに数えない） */
  initial: number;
  lost: number;
}

const newSideStats = (): SideStats => ({ actions: 0, distance: 0, retreats: 0, concedes: 0, intercepts: 0, inspires: 0, attacks: 0, commanderHits: 0, kills: 0, dealt: 0, countered: 0, aimed: 0, aimedHealth: 0, wipedOut: 0, commanderLost: 0, initial: 0, lost: 0 });

/** 1 つの範囲の集計 */
interface Tally {
  label: string;
  runs: number;
  wins: Record<'attacker' | 'defender', number>;
  /** 決着の理由（勝った陣営ごと。キーは「陣営:理由」） */
  reasons: Map<`${'attacker' | 'defender'}:${BattleEndReason}`, number>;
  stalled: number;
  turns: number[];
  actions: number;
  byType: Map<UnitType, TypeStats>;
  /** 同じ所を行き来した回数（部隊の番の終わりの位置が 2 つ前の番と同じで 1 つ前と違い、その 2 つの番に攻撃していない） */
  backAndForth: number;
  sides: Record<Side, SideStats>;
}

function newTally(label: string): Tally {
  return { label, runs: 0, wins: { attacker: 0, defender: 0 }, reasons: new Map(), stalled: 0, turns: [], actions: 0, byType: new Map(), backAndForth: 0, sides: { attacker: newSideStats(), defender: newSideStats() } };
}

const sideOfTeam = (team: TeamId): Side => (team === SIDE_TEAM.attacker ? 'attacker' : 'defender');

/** 行動を陣営ごとの手の傾向に数える */
function countSide(t: Tally, state: BattleState, r: ExecuteReport): void {
  const s = t.sides[sideOfTeam(r.unit.team)];
  const status = state.statuses.get(r.unit) ?? state.retreated.find((x) => x.unit === r.unit)?.status;
  if (r.retreat && !r.retreat.forced) {
    if (status?.commander) s.concedes++;
    else s.retreats++;
  }
  if (r.intercept) s.intercepts++;
  if (r.inspire !== undefined) s.inspires++;
  const a = r.attack;
  if (a) {
    s.attacks++;
    if (a.targetDestroyed) s.kills++;
    if (a.target && a.result) {
      const ts = state.statuses.get(a.target) ?? state.wipedOut.find((w) => w.unit === a.target)?.status;
      if (ts?.commander) s.commanderHits++;
      s.dealt += a.result.damage;
      s.countered += a.result.counter;
      if (ts) {
        s.aimed++;
        s.aimedHealth += Math.min(1, (ts.soldiers + a.result.damage) / Math.max(1, ts.initialSoldiers));
      }
    }
  }
  if (!state.statuses.has(r.unit)) return;
  const l = state.map.layout;
  const enemies = state.map.allUnits().filter((u) => u.team !== r.unit.team);
  if (enemies.length === 0) return;
  const at = l.offsetToAxial(r.unit.col, r.unit.row);
  s.actions++;
  s.distance += Math.min(...enemies.map((e) => axialDistance(at, l.offsetToAxial(e.col, e.row))));
}

/** 1 戦の終わりに、陣営ごとの兵の損耗・殲滅された部隊を数える */
function countLosses(t: Tally, state: BattleState): void {
  const add = (team: TeamId, initial: number, now: number) => {
    const s = t.sides[sideOfTeam(team)];
    s.initial += initial;
    s.lost += initial - now;
  };
  for (const [u, st] of state.statuses) add(u.team, st.initialSoldiers, st.soldiers);
  for (const r of state.retreated) add(r.unit.team, r.status.initialSoldiers, r.status.soldiers);
  for (const w of state.wipedOut) {
    add(w.unit.team, w.status.initialSoldiers, 0);
    const s = t.sides[sideOfTeam(w.unit.team)];
    s.wipedOut++;
    if (w.status.commander) s.commanderLost++;
  }
}

function addSideStats(to: SideStats, from: SideStats): void {
  for (const k of Object.keys(to) as (keyof SideStats)[]) to[k] += from[k];
}

function typeStats(t: Tally, type: UnitType): TypeStats {
  let s = t.byType.get(type);
  if (!s) t.byType.set(type, (s = { dealt: 0, taken: 0, friendly: 0, wipedOut: 0 }));
  return s;
}

/** 行動の結果を兵種ごとに数える（攻撃・反撃・巻き添え・迎撃） */
function countAction(t: Tally, r: ExecuteReport): void {
  const splash = (from: UnitType, team: TeamId, hits: readonly SplashHit[]) => {
    for (const h of hits) {
      if (h.friendly) typeStats(t, from).friendly += h.result.damage;
      else typeStats(t, from).dealt += h.result.damage;
      typeStats(t, h.unit.type).taken += h.result.damage;
    }
    void team;
  };
  const a = r.attack;
  if (a?.result && a.target) {
    typeStats(t, r.unit.type).dealt += a.result.damage;
    typeStats(t, a.target.type).taken += a.result.damage;
    typeStats(t, a.target.type).dealt += a.result.counter;
    typeStats(t, r.unit.type).taken += a.result.counter;
  }
  if (a) splash(r.unit.type, r.unit.team, a.splash);
  for (const i of r.intercepts) {
    typeStats(t, i.unit.type).dealt += i.result.damage;
    typeStats(t, r.unit.type).taken += i.result.damage;
    splash(i.unit.type, i.unit.team, i.splash);
  }
  for (const w of r.wipeouts) typeStats(t, w.unit.type).wipedOut++;
}

function countFacility(t: Tally, r: FacilityReport): void {
  typeStats(t, r.target.type).taken += r.result.damage;
  if (r.destroyed) typeStats(t, r.target.type).wipedOut++;
}

/** マップの戦闘の範囲を切り出し、両軍を配備した戦闘の状態を作る（打ち手の deploy。無ければ battle-editor の「自動配置」と同じ） */
function setup(source: MapData, area: string, rosters: Rosters, args: Args, players: Partial<Record<TeamId, Player>>): BattleState {
  const { retreat } = args;
  const data = cropBattleArea(source, area);
  if (!data.deploy) throw new Error(`${area} の範囲に初期配置地点がない`);
  const map = new HexMap(data);
  const statuses = rosterStatuses(rosters)(map.allUnits());
  const retreats: RetreatDestinations = retreat
    ? { [SIDE_TEAM.defender]: [{ id: 'sim-defender', name: '防衛側の後方' }], [SIDE_TEAM.attacker]: [{ id: 'sim-attacker', name: '攻撃側の後方' }] }
    : {};
  const state = createBattleState(map, statuses, { stronghold: data.stronghold ?? null, retreats });
  const deployment = new Deployment(map, data.deploy, rosterTroops(rosters)(data.deploy), statuses);
  while (deployment.side) {
    const player = players[SIDE_TEAM[deployment.side]];
    if (player?.deploy) player.deploy(state, deployment);
    else deployment.auto();
    if (!deployment.finish()) throw new Error(`${area}: ${SIDE_NAMES[deployment.side]}の配備を終えられない（部隊が無い・軍団長を置けない）`);
  }
  state.troopIds = deployment.troopIds();
  // 性格を差し替える（配備した部隊の状態は配備のときに入るので、配備を終えてから）
  for (const side of ['attacker', 'defender'] as const) {
    const style = side === 'attacker' ? args.attackerStyle : args.defenderStyle;
    if (style === 'roster') continue;
    for (const [u, st] of state.statuses) {
      if (u.team !== SIDE_TEAM[side]) continue;
      if (style === 'none') delete st.personality;
      else st.personality = style;
    }
  }
  return state;
}

/** source の area で runs 回戦わせて集計する */
function simulate(t: Tally, source: MapData, area: string, args: Args, rosters: Rosters): void {
  const players = {
    [SIDE_TEAM.attacker]: playerOf(args.attacker, args.attackerOff, args.attackerNoise),
    [SIDE_TEAM.defender]: playerOf(args.defender, args.defenderOff, args.defenderNoise),
  };
  for (let i = 0; i < args.runs; i++) {
    const seed = args.seed + i;
    const state = setup(source, area, rosters, args, players);
    /** 部隊ごとの、番の終わりの位置と攻撃したか（ターン順） */
    const track = new Map<UnitData, Map<number, { at: string; attacked: boolean }>>();
    const result = runBattle(state, {
      players,
      rng: seededRng(seed),
      playerRng: seededRng(seed * 7919 + 17),
      maxTurns: args.maxTurns,
      onAction: (r) => {
        countAction(t, r);
        countSide(t, state, r);
        if (args.trace) console.log(`    ${traceLine(state, r)}`);
        let turns = track.get(r.unit);
        if (!turns) track.set(r.unit, (turns = new Map()));
        const prev = turns.get(state.turn);
        turns.set(state.turn, { at: `${r.unit.col},${r.unit.row}`, attacked: !!prev?.attacked || !!r.attack });
      },
      onFacility: (r) => {
        countFacility(t, r);
        if (args.trace) console.log(`    t${r.turn} ${FACILITY_NAMES[r.kind]} → ${unitLabel(state, r.target)} −${r.result.damage}${r.destroyed ? ' 殲滅' : ''}`);
      },
    });
    const bf: string[] = [];
    for (const [unit, turns] of track) {
      for (const [turn, cur] of turns) {
        const p1 = turns.get(turn - 1);
        const p2 = turns.get(turn - 2);
        if (p1 && p2 && cur.at === p2.at && cur.at !== p1.at && !cur.attacked && !p1.attacked) bf.push(`${unit.team}:${unit.type} t${turn - 2}〜${turn} ${p2.at}→${p1.at}→${cur.at}`);
      }
    }
    t.backAndForth += bf.length;
    countLosses(t, state);
    t.runs++;
    t.actions += result.actions;
    t.turns.push(result.turn);
    const o = result.outcome;
    if (o) {
      t.wins[o.winner]++;
      const key = `${o.winner}:${o.reason}` as const;
      t.reasons.set(key, (t.reasons.get(key) ?? 0) + 1);
    } else t.stalled++;
    if (args.verbose) {
      console.log(`  ${t.label} seed ${seed}: ${o ? `${SIDE_NAMES[o.winner]}の勝ち（${BATTLE_END_REASON_NAMES[o.reason]}）` : '決着せず'} ターン ${result.turn} 行動 ${result.actions}`);
      for (const line of bf) console.log(`    行き来 ${line}`);
    }
  }
}

/** 行動の跡に出す部隊の名前（陣営・兵種・軍団長の印・HEX） */
function unitLabel(state: BattleState, u: UnitData, at: { col: number; row: number } = u): string {
  const s = state.statuses.get(u) ?? state.wipedOut.find((w) => w.unit === u)?.status ?? state.retreated.find((r) => r.unit === u)?.status;
  return `${u.team === SIDE_TEAM.attacker ? '攻' : '防'}${UNIT_DEFS[u.type].name}${s?.commander ? '★' : ''}(${at.col},${at.row})`;
}

/** 行動 1 つの跡（--trace） */
function traceLine(state: BattleState, r: ExecuteReport): string {
  const moved = r.from.col !== r.unit.col || r.from.row !== r.unit.row;
  const parts = [`t${state.turn} ${unitLabel(state, r.unit, r.from)}${moved ? `→(${r.unit.col},${r.unit.row})` : ''}`];
  for (const i of r.intercepts) parts.push(`迎撃を受けた ${unitLabel(state, i.unit)} −${i.result.damage}${i.halted ? ' 足止め' : ''}`);
  const a = r.attack;
  if (a) {
    const name = ATTACK_DEFS[a.id].name;
    if (a.target && a.result) parts.push(`${name} → ${unitLabel(state, a.target)} −${a.result.damage}（反撃 −${a.result.counter}）${a.targetDestroyed ? ' 殲滅' : ''}${a.unitDestroyed ? ' 壊滅' : ''}`);
    else parts.push(`${name} (${a.at.col},${a.at.row})`);
    for (const h of a.splash) parts.push(`巻き添え ${unitLabel(state, h.unit)} −${h.result.damage}${h.destroyed ? ' 殲滅' : ''}`);
    if (a.plowed) parts.push('耕した');
  }
  if (r.intercept) parts.push('迎撃の構え');
  if (r.wait && !a && !moved) parts.push('待機');
  if (r.inspire !== undefined) parts.push(`鼓舞 +${r.inspire}`);
  if (r.retreat) parts.push(`${r.retreat.forced ? '強制' : ''}退却${r.retreat.captured ? '（捕縛）' : ''}`);
  if (r.lost) parts.push('迎撃で壊滅');
  return parts.join(' / ');
}

const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '-');

function report(t: Tally): void {
  const turns = [...t.turns].sort((a, b) => a - b);
  const avg = turns.reduce((s, x) => s + x, 0) / Math.max(1, turns.length);
  console.log(`\n■ ${t.label}（${t.runs} 戦）`);
  console.table({
    攻撃側の勝ち: { 回数: t.wins.attacker, 割合: pct(t.wins.attacker, t.runs) },
    防衛側の勝ち: { 回数: t.wins.defender, 割合: pct(t.wins.defender, t.runs) },
    '決着せず（ターンの上限）': { 回数: t.stalled, 割合: pct(t.stalled, t.runs) },
  });
  const reasonName = (key: string) => {
    const [side, reason] = key.split(':') as ['attacker' | 'defender', BattleEndReason];
    return `${SIDE_NAMES[side]}の勝ち（${BATTLE_END_REASON_NAMES[reason]}）`;
  };
  console.table(Object.fromEntries([...t.reasons].sort((a, b) => a[0].localeCompare(b[0])).map(([r, n]) => [reasonName(r), { 回数: n, 割合: pct(n, t.runs) }])));
  console.log(`ターン数: 平均 ${avg.toFixed(1)}・最短 ${turns[0] ?? '-'}・中央 ${turns[Math.floor(turns.length / 2)] ?? '-'}・最長 ${turns.at(-1) ?? '-'}。1 戦の行動 平均 ${(t.actions / Math.max(1, t.runs)).toFixed(1)}・同じ所の行き来 平均 ${(t.backAndForth / Math.max(1, t.runs)).toFixed(2)} 回`);
  const side = (s: SideStats) => ({
    敵との距離: (s.distance / Math.max(1, s.actions)).toFixed(2),
    攻撃: (s.attacks / t.runs).toFixed(1),
    軍団長を狙った: pct(s.commanderHits, s.attacks),
    殲滅した: (s.kills / t.runs).toFixed(2),
    '与えた÷反撃': (s.dealt / Math.max(1, s.countered)).toFixed(2),
    狙った相手の残り: pct(s.aimedHealth, s.aimed),
    構え: (s.intercepts / t.runs).toFixed(2),
    鼓舞: (s.inspires / t.runs).toFixed(2),
    退却: (s.retreats / t.runs).toFixed(2),
    負けを認めた: (s.concedes / t.runs).toFixed(2),
    殲滅された: (s.wipedOut / t.runs).toFixed(2),
    軍団長を討たれた: pct(s.commanderLost, t.runs),
    兵の損耗: pct(s.lost, s.initial),
  });
  console.table({ 攻撃側: side(t.sides.attacker), 防衛側: side(t.sides.defender) });
  console.table(
    Object.fromEntries(
      [...t.byType]
        .sort((a, b) => b[1].dealt - a[1].dealt)
        .map(([type, s]) => [UNIT_DEFS[type].name, { 与えた: Math.round(s.dealt / t.runs), 受けた: Math.round(s.taken / t.runs), 味方へ: Math.round(s.friendly / t.runs), 殲滅された: (s.wipedOut / t.runs).toFixed(2) }]),
    ),
  );
}

/** 対戦シミュレータの本体。mapsDir は assets/maps/ */
export function main(argv: readonly string[], mapsDir: string): void {
  const args = parseArgs(argv);
  const rosters = args.rosters
    ? (parseRosters(JSON.parse(readFileSync(args.rosters, 'utf8'))) ?? (() => { throw new Error(`${args.rosters} は編成として読めない（騎士・兵種がいまのデータに無い）`); })())
    : {
        attacker: args.attackerFaction ? defaultRoster(args.attackerFaction) : DEFAULT_ROSTERS.attacker,
        defender: args.defenderFaction ? defaultRoster(args.defenderFaction) : DEFAULT_ROSTERS.defender,
      };
  const files = readdirSync(mapsDir).filter((f) => f.endsWith('.json')).sort();
  const load = (f: string) => parseMapData(JSON.parse(readFileSync(join(mapsDir, f), 'utf8')));
  const withAreas = (f: string, data: MapData) => Object.keys(data.deployments ?? {}).filter((city) => data.battleAreas?.[city]).map((city) => ({ f, data, city }));
  let targets: { f: string; data: MapData; city: string }[];
  if (args.map === 'all') targets = files.flatMap((f) => withAreas(f, load(f)));
  else {
    const f = args.map ?? files.find((x) => withAreas(x, load(x)).length > 0);
    if (!f) throw new Error('戦闘の範囲のあるマップが assets/maps/ に無い');
    const all = withAreas(f, load(f));
    const picked = args.area ? all.filter((x) => x.city === args.area) : all.slice(0, 1);
    if (picked.length === 0) throw new Error(`${f} に範囲 ${args.area} が無い（あるのは ${all.map((x) => x.city).join('・')}）`);
    targets = picked;
  }
  const t0 = performance.now();
  console.log(
    `攻撃側: ${factionName(rosters.attacker.factionId)}（${args.attacker}${args.attackerOff.map((f) => ` -${f}`).join('')}${args.attackerStyle === 'roster' ? '' : ` 性格 ${args.attackerStyle}`}）・` +
      `防衛側: ${factionName(rosters.defender.factionId)}（${args.defender}${args.defenderOff.map((f) => ` -${f}`).join('')}${args.defenderStyle === 'roster' ? '' : ` 性格 ${args.defenderStyle}`}）・` +
      `${targets.length} 範囲 × ${args.runs} 戦・シード ${args.seed}〜・ターンの上限 ${args.maxTurns}${args.retreat ? '' : '・退却先なし'}`,
  );
  const total = newTally('合計');
  for (const { f, data, city } of targets) {
    const t = newTally(`${data.name}（${f}）${city} の範囲`);
    try {
      simulate(t, data, city, args, rosters);
    } catch (e) {
      console.log(`× ${t.label}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (targets.length === 1) report(t);
    else console.log(`${t.label}: 攻撃側 ${pct(t.wins.attacker, t.runs)}・防衛側 ${pct(t.wins.defender, t.runs)}・決着せず ${t.stalled}・平均 ${(t.turns.reduce((s, x) => s + x, 0) / t.runs).toFixed(1)} ターン・行き来 ${t.backAndForth}`);
    total.runs += t.runs;
    total.actions += t.actions;
    total.turns.push(...t.turns);
    total.stalled += t.stalled;
    total.backAndForth += t.backAndForth;
    addSideStats(total.sides.attacker, t.sides.attacker);
    addSideStats(total.sides.defender, t.sides.defender);
    total.wins.attacker += t.wins.attacker;
    total.wins.defender += t.wins.defender;
    for (const [r, n] of t.reasons) total.reasons.set(r, (total.reasons.get(r) ?? 0) + n);
    for (const [type, s] of t.byType) {
      const x = typeStats(total, type);
      x.dealt += s.dealt;
      x.taken += s.taken;
      x.friendly += s.friendly;
      x.wipedOut += s.wipedOut;
    }
  }
  if (targets.length > 1) report(total);
  console.log(`\n${((performance.now() - t0) / 1000).toFixed(1)} 秒`);
}
