/**
 * ダメージ計算機（battle-editor の道具）。部隊を組んで攻撃しなくても、攻撃 1 回のダメージを入力から直接出す。
 *
 * - 計算は戦闘と同じ battle-runtime の calcDamage・calcCounter・moraleChange（damage.ts の値を直せばそのまま反映される）。
 * - 攻撃側: 兵種・兵数・士気・統率・武力・知力（magic の兵種は武力の代わりに知力を使う。mightFor）・攻撃（魔術師・上級魔術師は全魔法）・
 *   当たり方（直撃: 狙った相手 / 範囲: 巻き添え（splashPower。反撃なし・撃った側の士気は増減しない）/ 迎撃: 迎撃の構えの間接ユニットの自動攻撃）。
 * - 防御側: 兵種・兵数・士気・統率・武力・知力・地形（人工物の城・砦は攻城の兵種に攻撃されると地形効果が減る）。
 * - 状況: 包囲・迎撃の構え（近接の兵種）・標高差（高所の兵種）・一斉攻撃に加わる味方の数・隣接しているか（反撃を受けるか）。
 *   反撃は攻撃側の HEX の地形・包囲も効くので、攻撃側にも地形・包囲を置く。
 * - 結果: ダメージ（ランダムの真ん中と幅）・反撃・士気の増減・計算の内訳・同じ攻撃を続けたときに倒すまでの回数・防御側の兵種ごとの比較。
 * 入力はブラウザに覚えておく。騎士を選ぶと統率・武力・知力をその騎士の値にする。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FEATURE_DEFS, type FeatureId } from '@norden/map-runtime/core/features';
import { TERRAIN_DEFS, TERRAIN_IDS, type TerrainId } from '@norden/map-runtime/core/terrainTypes';
import { isUnitType, UNIT_DEFS, UNIT_TYPES, type UnitType } from '@norden/map-runtime/core/units';
import {
  ATTACK_DEFS,
  attacksOf,
  basicAttack,
  basicDefense,
  calcCounter,
  calcDamage,
  canFight,
  COMBAT_DEFS,
  CONDITION_DEFS,
  counterRate,
  damageFactors,
  guard,
  MAX_MORALE,
  mightFor,
  moraleChange,
  offense,
  RANDOM_SPREAD,
  resolveAttack,
  SPELL_IDS,
  UNIT_POWER,
  WALLED_FEATURES,
  type Fighter,
  type Hit,
  type MenuAttackId,
  type ResolvedAttack,
} from '@norden/battle-runtime';
import { defaultSoldiers, DEFAULT_MORALE, KNIGHT_GROUPS, knightById, knightLabel } from './gameKnights';

/** 部隊の入力 */
interface SideInput {
  type: UnitType;
  soldiers: number;
  morale: number;
  leadership: number;
  strength: number;
  intelligence: number;
  /** 能力を入れた騎士（手で直したら空） */
  knightId: string;
  /** いる HEX（地形 terrain:ID か人工物 feature:ID） */
  place: string;
  /** 包囲されているか */
  encircled: boolean;
}

/** 当たり方。direct: 狙った相手 / splash: 範囲の巻き添え / intercept: 迎撃の構えの自動攻撃 */
type Mode = 'direct' | 'splash' | 'intercept';

const MODE_NAMES: Record<Mode, string> = { direct: '直撃', splash: '範囲（巻き添え）', intercept: '迎撃（自動攻撃）' };
const MODES = Object.keys(MODE_NAMES) as Mode[];

interface CalcInput {
  attacker: SideInput;
  defender: SideInput;
  attack: MenuAttackId;
  mode: Mode;
  /** 隣接して攻撃するか（射程が 1〜2 の兵種で選ぶ。直接攻撃なら反撃を受ける） */
  adjacent: boolean;
  /** 一斉攻撃に加わる味方の数 */
  supporters: number;
  /** 標高差（攻撃側 − 防御側の標高レベル） */
  elevation: number;
  /** 防御側が迎撃の構えか（近接の兵種だけ効く） */
  guarding: boolean;
}

/** 入力を覚えておく localStorage のキー */
const STORAGE_KEY = 'battle-editor.damageCalc';
/** 標準の能力（統率・武力・知力） */
const STAT = 50;
const MAX_STAT = 100;
const MAX_SOLDIERS = 9999;
const MAX_SUPPORTERS = 5;
const MAX_ELEVATION = 5;
/** 倒すまでの回数を数える上限 */
const MAX_ROUNDS = 99;

const side = (type: UnitType): SideInput => ({
  type,
  soldiers: defaultSoldiers(type),
  morale: DEFAULT_MORALE,
  leadership: STAT,
  strength: STAT,
  intelligence: STAT,
  knightId: '',
  place: 'terrain:plains',
  encircled: false,
});

const DEFAULT_INPUT: CalcInput = {
  attacker: side('infantry'),
  defender: side('infantry'),
  attack: 'attack',
  mode: 'direct',
  adjacent: true,
  supporters: 0,
  elevation: 0,
  guarding: false,
};

/** いる HEX の選択肢（地形と、地形効果のある人工物） */
const PLACES: { id: string; name: string; defense: number; walled: boolean }[] = [
  ...TERRAIN_IDS.map((id: TerrainId) => ({ id: `terrain:${id}`, name: TERRAIN_DEFS[id].name, defense: TERRAIN_DEFS[id].defense, walled: false })),
  ...(Object.keys(FEATURE_DEFS) as FeatureId[])
    .filter((id) => FEATURE_DEFS[id].defense !== undefined)
    .map((id) => ({ id: `feature:${id}`, name: FEATURE_DEFS[id].name, defense: FEATURE_DEFS[id].defense!, walled: WALLED_FEATURES.has(id) })),
];
const placeOf = (id: string) => PLACES.find((p) => p.id === id) ?? PLACES[0];

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.max(min, Math.min(max, n));
};

function parseSide(v: unknown, fallback: SideInput): SideInput {
  if (!v || typeof v !== 'object') return fallback;
  const o = v as Partial<Record<keyof SideInput, unknown>>;
  const type = isUnitType(o.type) ? o.type : fallback.type;
  return {
    type,
    soldiers: clamp(o.soldiers, 1, MAX_SOLDIERS, fallback.soldiers),
    morale: clamp(o.morale, 0, MAX_MORALE, fallback.morale),
    leadership: clamp(o.leadership, 0, MAX_STAT, fallback.leadership),
    strength: clamp(o.strength, 0, MAX_STAT, fallback.strength),
    intelligence: clamp(o.intelligence, 0, MAX_STAT, fallback.intelligence),
    knightId: typeof o.knightId === 'string' && knightById(o.knightId) ? o.knightId : '',
    place: typeof o.place === 'string' && PLACES.some((p) => p.id === o.place) ? o.place : fallback.place,
    encircled: o.encircled === true,
  };
}

function loadInput(): CalcInput {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Record<keyof CalcInput, unknown>> | null;
    if (!v || typeof v !== 'object') return DEFAULT_INPUT;
    return {
      attacker: parseSide(v.attacker, DEFAULT_INPUT.attacker),
      defender: parseSide(v.defender, DEFAULT_INPUT.defender),
      attack: typeof v.attack === 'string' && v.attack in ATTACK_DEFS && v.attack !== 'interceptFire' ? (v.attack as MenuAttackId) : DEFAULT_INPUT.attack,
      mode: MODES.includes(v.mode as Mode) ? (v.mode as Mode) : DEFAULT_INPUT.mode,
      adjacent: v.adjacent !== false,
      supporters: clamp(v.supporters, 0, MAX_SUPPORTERS, 0),
      elevation: clamp(v.elevation, -MAX_ELEVATION, MAX_ELEVATION, 0),
      guarding: v.guarding === true,
    };
  } catch {
    return DEFAULT_INPUT;
  }
}

/** type の兵種が使える攻撃（magic の兵種は全魔法） */
const attacksFor = (type: UnitType): MenuAttackId[] => attacksOf(type, { spells: [...SPELL_IDS] });

/** 攻撃 r でできる当たり方 */
function modesFor(type: UnitType, r: ResolvedAttack | null): Mode[] {
  return MODES.filter((m) =>
    m === 'intercept' ? COMBAT_DEFS[type].ranged : r !== null && (m === 'direct' ? r.aim !== 'self' : r.shape.kind !== 'single'),
  );
}

/** 入力から戦闘の計算に渡す部隊 */
function fighterOf(s: SideInput, extra: Pick<Fighter, 'guarding' | 'supporters' | 'elevation'>): Fighter {
  const place = placeOf(s.place);
  return {
    type: s.type,
    soldiers: s.soldiers,
    morale: s.morale,
    leadership: s.leadership,
    strength: mightFor(s.type, s),
    encircled: s.encircled,
    defense: place.defense,
    walled: place.walled,
    ...extra,
  };
}

/** 攻撃 1 回の結果 */
interface Outcome {
  damage: number;
  counter: number;
  morale: { attacker: number; defender: number };
}

/** 計算の場面（入力から組み立てたもの） */
interface Scene {
  att: Fighter;
  def: Fighter;
  hit: Hit;
  /** 反撃を受けるか */
  direct: boolean;
  /** 範囲の巻き添えか（撃った側の士気は増減しない） */
  splash: boolean;
}

function outcome({ att, def, hit, direct, splash }: Scene, damageRoll: number, counterRoll: number): Outcome {
  const damage = calcDamage(att, def, hit, damageRoll);
  const counter = direct ? calcCounter(att, { ...def, soldiers: def.soldiers - damage }, counterRoll) : 0;
  const morale = moraleChange(damage, counter, att.strength, def.strength);
  return { damage, counter, morale: splash ? { ...morale, attacker: 0 } : morale };
}

/** 同じ攻撃を続けたとき（ランダムは真ん中。兵数・士気の増減を反映）に防御側を倒すまでの回数。倒せなければ null */
function roundsToRout(scene: Scene): { rounds: number; attackerLeft: number } | null {
  let att = scene.att;
  let def = scene.def;
  for (let n = 1; n <= MAX_ROUNDS; n++) {
    const o = outcome({ ...scene, att, def }, 0, 0);
    if (o.damage <= 0) return null;
    const morale = (m: number, d: number) => Math.max(0, Math.min(MAX_MORALE, m + d));
    def = { ...def, soldiers: def.soldiers - o.damage, morale: morale(def.morale, o.morale.defender) };
    att = { ...att, soldiers: att.soldiers - o.counter, morale: morale(att.morale, o.morale.attacker) };
    if (def.soldiers <= 0) return { rounds: n, attackerLeft: att.soldiers };
    if (att.soldiers <= 0) return null;
  }
  return null;
}

export default function DamageTool() {
  const [input, setInput] = useState<CalcInput>(loadInput);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(input));
    } catch {
      // 覚えられなくても、この画面の間は使える
    }
  }, [input]);
  const set = (patch: Partial<CalcInput>) => setInput((i) => ({ ...i, ...patch }));
  const setSide = (key: 'attacker' | 'defender', patch: Partial<SideInput>) => setInput((i) => ({ ...i, [key]: { ...i[key], ...patch } }));

  const { attacker, defender } = input;
  const attacks = attacksFor(attacker.type);
  const attackId = attacks.includes(input.attack) ? input.attack : attacks[0];
  const chosen = attackId ? resolveAttack(attacker.type, attackId) : null;
  const modes = modesFor(attacker.type, chosen);
  const mode = modes.includes(input.mode) ? input.mode : modes[0];
  const r = mode === 'intercept' ? resolveAttack(attacker.type, 'interceptFire') : chosen;

  // 隣接するか（射程が 1 だけなら必ず、2 からなら隣接しない）
  const adjacentFixed = !r || r.range.max <= 1 ? true : r.range.min >= 2 ? false : null;
  const adjacent = adjacentFixed ?? input.adjacent;
  const guardable = !COMBAT_DEFS[defender.type].ranged;

  const scene = useMemo((): Scene | null => {
    if (!r || !mode) return null;
    const hit: Hit = { power: mode === 'splash' ? r.splashPower : r.power, magic: r.magic, volley: r.special === 'volley' };
    return {
      att: fighterOf(attacker, { guarding: false, supporters: hit.volley ? input.supporters : 0, elevation: Math.max(0, input.elevation) }),
      def: fighterOf(defender, { guarding: input.guarding && guardable, supporters: 0, elevation: Math.max(0, -input.elevation) }),
      hit,
      direct: mode === 'direct' && !r.indirect && adjacent && canFight(defender.type),
      splash: mode === 'splash',
    };
  }, [attacker, defender, input.supporters, input.elevation, input.guarding, guardable, r, mode, adjacent]);

  // 高所の兵種か（標高差が効くか）
  const highGroundApplies = scene && damageFactors({ ...scene.att, elevation: 1 }, { ...scene.def, elevation: 0 }, scene.hit).highGroundLevels > 0;

  return (
    <div className="damage-calc">
      <div className="dc-sides">
        <SideForm
          title="攻撃側"
          value={attacker}
          onChange={(p) => setSide('attacker', p)}
          extra={
            <>
              <label className="row">
                <span>攻撃</span>
                <select value={attackId ?? ''} disabled={!attackId || mode === 'intercept'} onChange={(e) => set({ attack: e.target.value as MenuAttackId })}>
                  {attacks.length === 0 && <option value="">（攻撃しない）</option>}
                  {attacks.map((id) => (
                    <option key={id} value={id}>
                      {ATTACK_DEFS[id].name}（×{ATTACK_DEFS[id].power}）
                    </option>
                  ))}
                </select>
              </label>
              <div className="buttons dc-modes">
                {MODES.map((m) => (
                  <button key={m} className={m === mode ? 'active' : ''} disabled={!modes.includes(m)} onClick={() => set({ mode: m })}>
                    {MODE_NAMES[m]}
                  </button>
                ))}
              </div>
              <label className="check">
                <input type="checkbox" checked={adjacent} disabled={adjacentFixed !== null} onChange={(e) => set({ adjacent: e.target.checked })} />
                隣接して攻撃（直接攻撃なら反撃を受ける）
              </label>
              <NumRow
                label="一斉攻撃"
                value={input.supporters}
                min={0}
                max={MAX_SUPPORTERS}
                disabled={!scene?.hit.volley}
                suffix="隊"
                onChange={(v) => set({ supporters: v })}
              />
              <NumRow
                label="標高差"
                value={input.elevation}
                min={-MAX_ELEVATION}
                max={MAX_ELEVATION}
                onChange={(v) => set({ elevation: v })}
                title="攻撃側の標高レベル − 防御側の標高レベル。高所の兵種が高い HEX から撃つとダメージが増える（反撃は逆）"
              />
            </>
          }
        />
        <SideForm
          title="防御側"
          value={defender}
          onChange={(p) => setSide('defender', p)}
          extra={
            <label className="check">
              <input type="checkbox" checked={input.guarding && guardable} disabled={!guardable} onChange={(e) => set({ guarding: e.target.checked })} />
              迎撃の構え（近接の兵種。受けるダメージが減り、反撃が増える。魔法には効かない）
            </label>
          }
        />
      </div>
      {scene && r ? <Results scene={scene} r={r} mode={mode!} highGroundApplies={!!highGroundApplies} defender={defender} /> : <p className="hint">この兵種は攻撃しません</p>}
      <div className="buttons">
        <button
          onClick={() => setInput((i) => ({ ...i, attacker: i.defender, defender: i.attacker, elevation: -i.elevation }))}
          title="攻撃側と防御側の部隊を入れ替える"
        >
          攻守を入れ替える
        </button>
        <button onClick={() => setInput(DEFAULT_INPUT)}>既定に戻す</button>
      </div>
    </div>
  );
}

/** 部隊の入力（兵種・兵数・士気・統率・武力・知力・いる HEX・包囲） */
function SideForm({ title, value, onChange, extra }: { title: string; value: SideInput; onChange: (p: Partial<SideInput>) => void; extra: ReactNode }) {
  const magic = COMBAT_DEFS[value.type].magic;
  const stat = (p: Partial<SideInput>) => onChange({ ...p, knightId: '' });
  return (
    <fieldset className="dc-side">
      <legend>{title}</legend>
      <label className="row">
        <span>兵種</span>
        <select value={value.type} onChange={(e) => onChange({ type: e.target.value as UnitType, soldiers: defaultSoldiers(e.target.value as UnitType) })}>
          {UNIT_TYPES.map((t) => (
            <option key={t} value={t}>
              {UNIT_DEFS[t].name}（攻{UNIT_POWER[t].attack} 防{UNIT_POWER[t].defense}）
            </option>
          ))}
        </select>
      </label>
      <NumRow label="兵数" value={value.soldiers} min={1} max={MAX_SOLDIERS} step={10} slider={false} onChange={(v) => onChange({ soldiers: v })} />
      <NumRow label="士気" value={value.morale} min={0} max={MAX_MORALE} onChange={(v) => onChange({ morale: v })} />
      <label className="row">
        <span>騎士</span>
        <select
          value={value.knightId}
          onChange={(e) => {
            const k = knightById(e.target.value);
            onChange(k ? { knightId: k.id, leadership: k.leadership, strength: k.strength, intelligence: k.intelligence } : { knightId: '' });
          }}
        >
          <option value="">（手で入れる）</option>
          {KNIGHT_GROUPS.map((g) => (
            <optgroup key={g.name} label={g.name}>
              {g.knights.map((k) => (
                <option key={k.id} value={k.id}>
                  {knightLabel(k)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <NumRow label="統率" value={value.leadership} min={0} max={MAX_STAT} onChange={(v) => stat({ leadership: v })} />
      <NumRow label="武力" value={value.strength} min={0} max={MAX_STAT} dim={magic} onChange={(v) => stat({ strength: v })} />
      <NumRow label="知力" value={value.intelligence} min={0} max={MAX_STAT} dim={!magic} onChange={(v) => stat({ intelligence: v })} />
      <label className="row">
        <span>地形</span>
        <select value={value.place} onChange={(e) => onChange({ place: e.target.value })}>
          {PLACES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.defense ? `（−${Math.round(p.defense * 100)}%）` : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={value.encircled} onChange={(e) => onChange({ encircled: e.target.checked })} />
        包囲されている
      </label>
      {extra}
      <p className="hint">
        {magic ? '魔法の兵種なので武力の代わりに知力を使う。' : ''}基本攻撃力 {basicAttack({ ...value, strength: mightFor(value.type, value) })}・基本防御力{' '}
        {basicDefense({ ...value, strength: mightFor(value.type, value) })}
      </p>
    </fieldset>
  );
}

/** 数の入力（スライダーと数字） */
function NumRow({
  label,
  value,
  min,
  max,
  step = 1,
  slider = true,
  disabled,
  dim,
  suffix,
  title,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  slider?: boolean;
  disabled?: boolean;
  /** 計算に使わない値（薄く出す） */
  dim?: boolean;
  suffix?: string;
  title?: string;
  onChange: (v: number) => void;
}) {
  const change = (v: string) => onChange(Math.max(min, Math.min(max, Math.round(Number(v) || 0))));
  return (
    <label className={`row dc-num${dim ? ' dim' : ''}`} title={title ?? (dim ? 'この兵種の計算には使わない' : undefined)}>
      <span>{label}</span>
      {slider && <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => change(e.target.value)} />}
      <input type="number" className="num" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => change(e.target.value)} />
      {suffix && <em>{suffix}</em>}
    </label>
  );
}

const fmt = (v: number, digits = 2) => (Number.isInteger(v) ? String(v) : v.toFixed(digits));
const signed = (v: number) => (v > 0 ? `+${v}` : String(v));
const range = ([a, b]: [number, number]) => (a === b ? String(a) : `${a}〜${b}`);

function Results({
  scene,
  r,
  mode,
  highGroundApplies,
  defender,
}: {
  scene: Scene;
  r: ResolvedAttack;
  mode: Mode;
  highGroundApplies: boolean;
  defender: SideInput;
}) {
  const { att, def, hit } = scene;
  // 与えるダメージが少ないほど相手の兵が残って反撃が増える（attackForecast と同じ）
  const mid = outcome(scene, 0, 0);
  const low = outcome(scene, -1, 1);
  const high = outcome(scene, 1, -1);
  const f = damageFactors(att, def, hit);
  const o = offense(att);
  const g = guard(def);
  const rout = roundsToRout(scene);
  const left = def.soldiers - mid.damage;
  const counterF = scene.direct ? damageFactors(def, att, { power: ATTACK_DEFS.attack.power, magic: false, volley: false }) : null;

  return (
    <section className="dc-result">
      <div className="dc-headline">
        <div>
          <span className="dc-label">ダメージ</span>
          <strong>{mid.damage}</strong>
          <span className="dc-range">
            {low.damage}〜{high.damage}
          </span>
        </div>
        <div>
          <span className="dc-label">反撃</span>
          <strong className={scene.direct ? '' : 'none'}>{scene.direct ? mid.counter : '-'}</strong>
          {scene.direct && <span className="dc-range">{range([high.counter, low.counter])}</span>}
        </div>
        <div>
          <span className="dc-label">防御側の残り</span>
          <strong>{left}</strong>
          <span className="dc-range">{def.soldiers > 0 ? `${Math.round((mid.damage / def.soldiers) * 100)}% 減` : ''}</span>
        </div>
      </div>
      <p className="hint">
        {MODE_NAMES[mode]}・{r.name}（倍率 ×{hit.power}
        {hit.magic ? '・魔法' : ''}
        {r.indirect ? '・反撃なし' : ''}）。ランダム ±{Math.round(RANDOM_SPREAD * 100)}% の幅。士気の増減: 攻撃側 {signed(mid.morale.attacker)}（{att.morale}→
        {Math.max(0, Math.min(MAX_MORALE, att.morale + mid.morale.attacker))}）・防御側 {signed(mid.morale.defender)}（{def.morale}→
        {Math.max(0, Math.min(MAX_MORALE, def.morale + mid.morale.defender))}）
      </p>
      {r.inflicts.length > 0 && (
        <p className="hint">
          当たると {r.inflicts.map((i) => `${CONDITION_DEFS[i.condition].name} ${Math.round(i.chance * 100)}%（${i.turns} ターン）`).join('・')}
        </p>
      )}
      <p className="hint">
        同じ攻撃を続けると（ランダムは真ん中、兵数・士気の増減を反映）:{' '}
        {rout ? `${rout.rounds} 回で殲滅（攻撃側の残り ${rout.attackerLeft}）` : mid.damage <= 0 ? 'ダメージが無いので倒せない' : `${MAX_ROUNDS} 回では倒せない`}
      </p>
      <table className="dc-breakdown">
        <tbody>
          <tr>
            <th>兵の攻め</th>
            <td>{fmt(o.troops)}</td>
            <td>兵数 × 兵種の攻撃力 {UNIT_POWER[att.type].attack} × 統率</td>
          </tr>
          <tr>
            <th>× 攻撃の倍率</th>
            <td>{fmt(hit.power)}</td>
            <td>{mode === 'splash' ? '巻き添えの倍率（splashPower）' : r.name}</td>
          </tr>
          <tr>
            <th>÷ 相手の兵の守り</th>
            <td>{fmt(g.troops, 3)}</td>
            <td>兵種の防御力 {UNIT_POWER[def.type].defense} ÷ 統率</td>
          </tr>
          <tr>
            <th>＋ 武力</th>
            <td>{fmt(o.might - (hit.magic ? 0 : g.might))}</td>
            <td>
              {COMBAT_DEFS[att.type].magic ? '知力' : '武力'} {fmt(o.might)}
              {hit.magic ? '（魔法なので相手の軽減なし）' : ` − 相手の${COMBAT_DEFS[def.type].magic ? '知力' : '武力'} ${fmt(g.might)}`}
            </td>
          </tr>
          <tr>
            <th>× 士気</th>
            <td>{fmt(o.morale, 3)}</td>
            <td />
          </tr>
          <tr className="sum">
            <th>= 基本ダメージ</th>
            <td>{fmt(f.base, 1)}</td>
            <td />
          </tr>
          <Factor name="包囲" v={f.encircled} note={def.encircled ? '防御側が包囲されている' : ''} />
          <Factor
            name="地形"
            v={f.terrain}
            note={f.defense ? `地形効果 ${Math.round(f.defense * 100)}%${f.defense < def.defense ? '（攻城の兵種なので減る）' : ''}` : ''}
          />
          <Factor
            name="高所"
            v={f.highGround}
            note={f.highGroundLevels ? `標高差 ${f.highGroundLevels}` : highGroundApplies ? '' : '高所の兵種ではない'}
          />
          <Factor name="迎撃の構え" v={f.intercept} note={def.guarding && hit.magic ? '魔法には効かない' : ''} />
          <Factor name="一斉攻撃" v={f.volley} note={hit.volley ? `味方 ${att.supporters} 隊` : ''} />
          <tr className="sum">
            <th>= ダメージ</th>
            <td>{mid.damage}</td>
            <td>× ランダム {fmt(1 - RANDOM_SPREAD)}〜{fmt(1 + RANDOM_SPREAD)}（兵数が上限）</td>
          </tr>
          {counterF && (
            <tr>
              <th>反撃</th>
              <td>{mid.counter}</td>
              <td>
                防御側（残り {left}）の通常攻撃 × {fmt(counterRate(def))}
                {def.guarding ? '（迎撃の構えで増える）' : ''}。地形 ×{fmt(counterF.terrain)}・包囲 ×{fmt(counterF.encircled)}
                {counterF.highGround !== 1 ? `・高所 ×${fmt(counterF.highGround)}` : ''}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <TypeComparison scene={scene} defender={defender} />
    </section>
  );
}

function Factor({ name, v, note }: { name: string; v: number; note: string }) {
  return (
    <tr className={v === 1 ? 'idle' : ''}>
      <th>× {name}</th>
      <td>{fmt(v)}</td>
      <td>{note}</td>
    </tr>
  );
}

/** 同じ攻撃・同じ防御側の能力で、防御側の兵種だけを変えたときのダメージと反撃 */
function TypeComparison({ scene, defender }: { scene: Scene; defender: SideInput }) {
  return (
    <details className="dc-compare">
      <summary>防御側の兵種ごとの比較（兵数・能力・状況はそのまま）</summary>
      <table>
        <thead>
          <tr>
            <th>兵種</th>
            <th>ダメージ</th>
            <th>反撃</th>
          </tr>
        </thead>
        <tbody>
          {UNIT_TYPES.map((t) => {
            const def: Fighter = { ...scene.def, type: t, strength: mightFor(t, defender), guarding: scene.def.guarding && !COMBAT_DEFS[t].ranged };
            const o = outcome({ ...scene, def, direct: scene.direct && canFight(t) }, 0, 0);
            return (
              <tr key={t} className={t === scene.def.type ? 'current' : ''}>
                <th>{UNIT_DEFS[t].name}</th>
                <td>{o.damage}</td>
                <td>{scene.direct && canFight(t) ? o.counter : '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}
