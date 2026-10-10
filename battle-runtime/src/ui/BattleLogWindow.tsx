/**
 * 戦闘記録のウィンドウ（画面の右下、ターン表示の上）。攻撃・迎撃を実行するたびに 1 件ずつ足す。
 * 行動メニューより奥に表示する（battle.css の z-index）。
 *
 * - 枠は norden-ui の ThinFrameWithTitle（細いベゼルと題名の札）。
 * - ターンが変わって最初の記録の前に、飾り罫の区切り（第 n ターン）を入れる。
 * - 新しい記録は下に足し、いちばん下までスクロールする（上を読んでいる間は動かさない）。
 * - 題名の横のボタンで畳める。マップを読み込み直すと空にする。
 * - 記録の一覧と畳むボタン以外（題名の札・枠）をつかんでドラッグで動かせる。画面の外へは出さない。
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ThinFrameWithTitle } from 'norden-ui';
import type { Offset } from '@norden/map-runtime/core/hex';
import { TEAM_DEFS, UNIT_DEFS, type UnitData } from '@norden/map-runtime/core/units';
import type { BattleApp, ExecuteReport } from '../app';
import type { MoraleChange } from '../morale';

/** 攻撃 1 回分の記録 */
export interface AttackLogEntry {
  /** intercept: 迎撃の構えの間接ユニットの自動攻撃 */
  kind?: 'intercept';
  turn: number;
  attacker: UnitData;
  target: UnitData;
  /** 行動の名前（攻撃・斉射・突撃など） */
  actionName: string;
  damage: number;
  /** 反撃による減少（直接攻撃でなければ使わない） */
  counter: number;
  direct: boolean;
  /** 相手が包囲されていたか */
  encircled: boolean;
  morale: MoraleChange;
  /** 攻撃の後の兵数 */
  attackerLeft: number;
  targetLeft: number;
  /** 突撃で飛び出た HEX */
  landing: Offset | null;
  /** 迎撃で相手の行動を止めたか */
  halted?: boolean;
}

/** 下端からこれ以内にいれば「最新を見ている」とみなして自動でスクロールする（CSS ピクセル） */
const STICK_BOTTOM = 24;
/** 動かすときに空ける画面の端との間（上は題名の札が枠からはみ出す分も空ける） */
const MARGIN = 6;
const MARGIN_TOP = 16;

export default function BattleLogWindow({ app }: { app: BattleApp }) {
  const [entries, setEntries] = useState<AttackLogEntry[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  /** 足す前にいちばん下を見ていたか */
  const stick = useRef(true);
  /** 一度でも動かしたか（動かすまでは CSS の右下の位置のまま） */
  const moved = useRef(false);
  /** ドラッグ中のポインターと、つかんだ位置（ウィンドウの左上から） */
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    const offLoad = app.on('load', () => setEntries([]));
    const offExecute = app.on('execute', (report) => {
      const added = logEntries(app, report);
      if (added.length === 0) return;
      const list = listRef.current;
      stick.current = !list || list.scrollHeight - list.scrollTop - list.clientHeight <= STICK_BOTTOM;
      setEntries((prev) => [...prev, ...added]);
    });
    return () => {
      offLoad();
      offExecute();
    };
  }, [app]);

  /** 左上を (x, y)（画面の左上から）へ動かす（画面からはみ出さないように詰める） */
  const moveTo = (x: number, y: number) => {
    const root = rootRef.current;
    const area = root?.offsetParent;
    if (!root || !area) return;
    const left = Math.max(MARGIN, Math.min(x, area.clientWidth - MARGIN - root.offsetWidth));
    const top = Math.max(MARGIN_TOP, Math.min(y, area.clientHeight - MARGIN - root.offsetHeight));
    const st = root.style;
    st.left = `${Math.round(left)}px`;
    st.top = `${Math.round(top)}px`;
    st.right = st.bottom = 'auto';
    moved.current = true;
  };
  /** 動かした後に画面の大きさ・ウィンドウの高さが変わったら、はみ出さないように詰め直す */
  const clampToView = () => {
    const root = rootRef.current;
    if (moved.current && root) moveTo(root.offsetLeft, root.offsetTop);
  };

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && stick.current) list.scrollTop = list.scrollHeight;
    clampToView();
  }, [entries, collapsed]);

  useEffect(() => {
    window.addEventListener('resize', clampToView);
    return () => window.removeEventListener('resize', clampToView);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    const root = rootRef.current;
    if (!root || e.button !== 0 || (e.target as Element).closest('.log-list, .log-toggle')) return;
    const r = root.getBoundingClientRect();
    drag.current = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
    root.setPointerCapture(e.pointerId);
    setMoving(true);
    e.preventDefault();
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    const area = rootRef.current?.offsetParent?.getBoundingClientRect();
    if (d?.id === e.pointerId && area) moveTo(e.clientX - area.left - d.dx, e.clientY - area.top - d.dy);
  };
  const onPointerEnd = (e: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    setMoving(false);
  };

  return (
    <ThinFrameWithTitle
      ref={rootRef}
      title="戦闘記録"
      className={`battle-window battle-log${collapsed ? ' collapsed' : ''}${moving ? ' moving' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <button
        type="button"
        className="log-toggle"
        title={collapsed ? '広げる' : '畳む'}
        aria-expanded={!collapsed}
        onClick={() => {
          stick.current = collapsed; // 広げたら最新を見せる
          setCollapsed(!collapsed);
        }}
      />
      <span className="log-count">{entries.length} 件</span>
      <ol ref={listRef} className="log-list">
        {entries.length === 0 ? <li className="log-empty">まだ戦闘はありません</li> : entries.map((e, i) => (
          <Fragment key={i}>
            {e.turn !== entries[i - 1]?.turn && (
              <li className="log-turn">
                <span>第 {e.turn} ターン</span>
              </li>
            )}
            <Entry entry={e} />
          </Fragment>
        ))}
      </ol>
    </ThinFrameWithTitle>
  );
}

function Entry({ entry: e }: { entry: AttackLogEntry }) {
  return (
    // 足したときだけ光らせる（畳んで広げたときにもう一度光らないよう、終わったら外す）
    <li className={`log-entry fresh${e.kind ? ` ${e.kind}` : ''}`} onAnimationEnd={(ev) => ev.currentTarget.classList.remove('fresh')}>
      <div className="log-who">
        <Unit unit={e.attacker} />
        <span className="log-verb">が</span>
        <Unit unit={e.target} />
        <span className="log-verb">に</span>
        {e.encircled && <span className="log-encircled">包囲</span>}
        <span className="log-action">{e.actionName}</span>
      </div>
      <div className="log-result">
        <Loss label="損害" kind="damage" n={e.damage} left={e.targetLeft} morale={e.morale.defender} />
        {e.direct ? (
          <Loss label="反撃" kind="counter" n={e.counter} left={e.attackerLeft} morale={e.morale.attacker} />
        ) : (
          <span className="log-none">
            反撃なし
            <Morale n={e.morale.attacker} />
          </span>
        )}
      </div>
      {e.landing && e.attackerLeft > 0 && <div className="log-note">({e.landing.col}, {e.landing.row}) へ突破</div>}
      {e.halted && e.targetLeft > 0 && <div className="log-note halted">迎撃で足止めされ、行動を中断</div>}
    </li>
  );
}

/** 軍の色の印を付けたユニット名 */
function Unit({ unit }: { unit: UnitData }) {
  const team = TEAM_DEFS[unit.team];
  return (
    <span className="log-unit" style={{ '--team': team.color } as CSSProperties}>
      {team.name} {UNIT_DEFS[unit.type].name}
    </span>
  );
}

/** 兵数の減少（減った数と残り。0 なら壊滅）と士気の増減 */
function Loss({ label, kind, n, left, morale }: { label: string; kind: string; n: number; left: number; morale: number }) {
  let rest: ReactNode;
  if (left <= 0) rest = <span className="log-destroyed">壊滅</span>;
  else
    rest = (
      <>
        <span className="left">残 {left}</span>
        <Morale n={morale} />
      </>
    );
  return (
    <span className={`log-loss ${kind}`}>
      <span className="label">{label}</span>
      <b>−{n}</b>
      {rest}
    </span>
  );
}

/** 士気の増減（変わらなければ出さない） */
function Morale({ n }: { n: number }) {
  if (n === 0) return null;
  return <span className={`log-morale ${n > 0 ? 'up' : 'down'}`}>士気 {n > 0 ? '+' : '−'}{Math.abs(n)}</span>;
}

/** 実行の結果から記録を作る（攻撃の前の移動で受けた迎撃 → 攻撃 → 攻撃の後の移動で受けた迎撃の順） */
function logEntries(app: BattleApp, { unit, attack, intercepts }: ExecuteReport): AttackLogEntry[] {
  const out: AttackLogEntry[] = [];
  const addIntercepts = (afterAttack: boolean) => {
    for (const i of intercepts) {
      if (i.afterAttack !== afterAttack) continue;
      const { result } = i;
      out.push({
        kind: 'intercept',
        turn: app.turn,
        attacker: i.unit,
        target: unit,
        actionName: '迎撃',
        damage: result.damage,
        counter: 0,
        direct: false,
        encircled: result.encircled,
        morale: result.morale,
        attackerLeft: app.statuses.get(i.unit)?.soldiers ?? 0,
        targetLeft: i.targetLeft,
        landing: null,
        halted: i.halted,
      });
    }
  };
  addIntercepts(false);
  if (attack) {
    const { result } = attack;
    out.push({
      turn: app.turn,
      attacker: unit,
      target: attack.target,
      // 一斉攻撃は加わった隊の数（自分を含む）も出す
      actionName: result.supporters > 0 ? `${attack.action.name} ${result.supporters + 1}隊` : attack.action.name,
      damage: result.damage,
      counter: result.counter,
      direct: result.direct,
      encircled: result.encircled,
      morale: result.morale,
      attackerLeft: attack.unitLeft,
      targetLeft: attack.targetLeft,
      landing: attack.landing,
    });
  }
  addIntercepts(true);
  return out;
}
