/**
 * 対戦シミュレータ（npm run sim）。描画なしで CPU（やランダムな打ち手）どうしを何度も戦わせ、勝率・決着の理由・ターン数・
 * 兵種ごとのダメージを表に出す。シードを固定すれば同じ結果になる。run.mjs が Vite のモジュールランナーでこのファイルを動かす。
 *
 *   npm run sim -- [--map <ファイル|all>] [--area <都市 ID>] [--runs 20] [--seed 1] [--max-turns 30]
 *                  [--attacker normal] [--defender normal] [--rosters rosters.json] [--attacker-faction <勢力 ID>] [--defender-faction <勢力 ID>]
 *                  [--no-retreat] [--verbose]
 *
 * - マップ: assets/maps/ のファイル（既定は戦闘の範囲のある最初のファイル）。all ならすべてのマップのすべての範囲を回す。
 *   範囲は既定で最初のもの。マップの範囲を切り出し、両軍を自動配置して始める（battle-editor の「自動配置」と同じ）
 * - 打ち手: 陣営ごとに easy・normal・hard（CPU の難易度）か random（ランダムな仮の打ち手）
 * - 編成: battle-editor の部隊の道具の「編成を書き出す」で書き出した JSON（--rosters）。無ければ勢力 ID ごとの既定の編成
 *   （--attacker-faction・--defender-faction。省略すると battle-editor の既定と同じ）
 * - 退却先: 既定は両軍にダミーの拠点を 1 つずつ渡す（退却・強制退却が起きる）。--no-retreat で渡さない
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cropBattleArea } from '@norden/map-runtime/core/battleArea';
import { HexMap, parseMapData, type MapData } from '@norden/map-runtime/core/mapData';
import { UNIT_DEFS, type TeamId, type UnitData, type UnitType } from '@norden/map-runtime/core/units';
import { cpuPlayer, DIFFICULTIES, type Difficulty } from '@norden/battle-runtime/cpu';
import { createBattleState, randomPlayer, runBattle, seededRng, type ExecuteReport, type FacilityReport, type Player, type SplashHit } from '@norden/battle-runtime/engine';
import { BATTLE_END_REASON_NAMES, Deployment, SIDE_NAMES, SIDE_TEAM, type BattleEndReason, type RetreatDestinations } from '@norden/battle-runtime/rules';
import { DEFAULT_ROSTERS, defaultRoster, factionName, parseRosters, rosterStatuses, rosterTroops, type Rosters } from '../src/gameKnights';

type Who = Difficulty | 'random';

interface Args {
  map: string | null;
  area: string | null;
  runs: number;
  seed: number;
  maxTurns: number;
  attacker: Who;
  defender: Who;
  rosters: string | null;
  attackerFaction: string | null;
  defenderFaction: string | null;
  retreat: boolean;
  verbose: boolean;
}

const USAGE = `npm run sim -- [--map <ファイル|all>] [--area <都市 ID>] [--runs 20] [--seed 1] [--max-turns 30]
                 [--attacker easy|normal|hard|random] [--defender easy|normal|hard|random]
                 [--rosters rosters.json] [--attacker-faction <勢力 ID>] [--defender-faction <勢力 ID>] [--no-retreat] [--verbose]`;

function parseArgs(argv: readonly string[]): Args {
  const a: Args = { map: null, area: null, runs: 20, seed: 1, maxTurns: 30, attacker: 'normal', defender: 'normal', rosters: null, attackerFaction: null, defenderFaction: null, retreat: true, verbose: false };
  const who = (v: string): Who => {
    if (v === 'random' || (DIFFICULTIES as readonly string[]).includes(v)) return v as Who;
    throw new Error(`打ち手は easy・normal・hard・random のどれか: ${v}`);
  };
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
    else if (key === '--rosters') a.rosters = next();
    else if (key === '--attacker-faction') a.attackerFaction = next();
    else if (key === '--defender-faction') a.defenderFaction = next();
    else if (key === '--no-retreat') a.retreat = false;
    else if (key === '--verbose') a.verbose = true;
    else if (key === '--help' || key === '-h') throw new Error(USAGE);
    else throw new Error(`知らない引数: ${key}\n${USAGE}`);
  }
  return a;
}

const playerOf = (who: Who): Player => (who === 'random' ? randomPlayer : cpuPlayer({ difficulty: who }));

/** 兵種ごとの集計 */
interface TypeStats {
  dealt: number;
  taken: number;
  friendly: number;
  wipedOut: number;
}

/** 1 つの範囲の集計 */
interface Tally {
  label: string;
  runs: number;
  wins: Record<'attacker' | 'defender', number>;
  reasons: Map<BattleEndReason, number>;
  stalled: number;
  turns: number[];
  actions: number;
  byType: Map<UnitType, TypeStats>;
  /** 同じ所を行き来した回数（部隊の番の終わりの位置が 2 つ前の番と同じで 1 つ前と違い、その 2 つの番に攻撃していない） */
  backAndForth: number;
}

function newTally(label: string): Tally {
  return { label, runs: 0, wins: { attacker: 0, defender: 0 }, reasons: new Map(), stalled: 0, turns: [], actions: 0, byType: new Map(), backAndForth: 0 };
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

/** マップの戦闘の範囲を切り出し、両軍を自動配置した戦闘の状態を作る */
function setup(source: MapData, area: string, rosters: Rosters, retreat: boolean) {
  const data = cropBattleArea(source, area);
  if (!data.deploy) throw new Error(`${area} の範囲に初期配置地点がない`);
  const map = new HexMap(data);
  const statuses = rosterStatuses(rosters)(map.allUnits());
  const deployment = new Deployment(map, data.deploy, rosterTroops(rosters)(data.deploy), statuses);
  while (deployment.side) {
    deployment.auto();
    if (!deployment.finish()) throw new Error(`${area}: ${SIDE_NAMES[deployment.side]}の配備を終えられない（部隊が無い・軍団長を置けない）`);
  }
  const retreats: RetreatDestinations = retreat
    ? { [SIDE_TEAM.defender]: [{ id: 'sim-defender', name: '防衛側の後方' }], [SIDE_TEAM.attacker]: [{ id: 'sim-attacker', name: '攻撃側の後方' }] }
    : {};
  return createBattleState(map, statuses, { stronghold: data.stronghold ?? null, retreats, troopIds: deployment.troopIds() });
}

/** source の area で runs 回戦わせて集計する */
function simulate(t: Tally, source: MapData, area: string, args: Args, rosters: Rosters): void {
  const players = { [SIDE_TEAM.attacker]: playerOf(args.attacker), [SIDE_TEAM.defender]: playerOf(args.defender) };
  for (let i = 0; i < args.runs; i++) {
    const seed = args.seed + i;
    const state = setup(source, area, rosters, args.retreat);
    /** 部隊ごとの、番の終わりの位置と攻撃したか（ターン順） */
    const track = new Map<UnitData, Map<number, { at: string; attacked: boolean }>>();
    const result = runBattle(state, {
      players,
      rng: seededRng(seed),
      playerRng: seededRng(seed * 7919 + 17),
      maxTurns: args.maxTurns,
      onAction: (r) => {
        countAction(t, r);
        let turns = track.get(r.unit);
        if (!turns) track.set(r.unit, (turns = new Map()));
        const prev = turns.get(state.turn);
        turns.set(state.turn, { at: `${r.unit.col},${r.unit.row}`, attacked: !!prev?.attacked || !!r.attack });
      },
      onFacility: (r) => countFacility(t, r),
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
    t.runs++;
    t.actions += result.actions;
    t.turns.push(result.turn);
    const o = result.outcome;
    if (o) {
      t.wins[o.winner]++;
      t.reasons.set(o.reason, (t.reasons.get(o.reason) ?? 0) + 1);
    } else t.stalled++;
    if (args.verbose) {
      console.log(`  ${t.label} seed ${seed}: ${o ? `${SIDE_NAMES[o.winner]}の勝ち（${BATTLE_END_REASON_NAMES[o.reason]}）` : '決着せず'} ターン ${result.turn} 行動 ${result.actions}`);
      for (const line of bf) console.log(`    行き来 ${line}`);
    }
  }
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
  console.table(Object.fromEntries([...t.reasons].map(([r, n]) => [BATTLE_END_REASON_NAMES[r], { 回数: n, 割合: pct(n, t.runs) }])));
  console.log(`ターン数: 平均 ${avg.toFixed(1)}・最短 ${turns[0] ?? '-'}・中央 ${turns[Math.floor(turns.length / 2)] ?? '-'}・最長 ${turns.at(-1) ?? '-'}。1 戦の行動 平均 ${(t.actions / Math.max(1, t.runs)).toFixed(1)}・同じ所の行き来 平均 ${(t.backAndForth / Math.max(1, t.runs)).toFixed(2)} 回`);
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
    `攻撃側: ${factionName(rosters.attacker.factionId)}（${args.attacker}）・防衛側: ${factionName(rosters.defender.factionId)}（${args.defender}）・` +
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
