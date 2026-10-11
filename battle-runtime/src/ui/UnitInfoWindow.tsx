/**
 * 部隊（騎士）のウィンドウ（画面の左下、地形のウィンドウの右に固定）。
 *
 * - カーソルの下のユニット → 選択中のユニット → 調べている相手方のユニットの順に、1 部隊の情報を出す。どれも無ければ隠す。
 * - 顔・兵士数・士気（情報札と同じ中身）、残り行動力、指揮官の統率・武力・知力とスキル、いまの様子（行動済み・迎撃の構えなど）。
 * - 枠は norden-ui の ThinFrameWithTitle（細いベゼルと題名の札）。表示するだけなので、マウスは下のマップへ通す。
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { ThinFrameWithTitle } from 'norden-ui';
import { TEAM_DEFS, UNIT_DEFS, type UnitData } from '@norden/map-runtime/core/units';
import { SKILL_DEFS } from '../actions';
import type { BattleApp } from '../app';
import { COMBAT_DEFS } from '../combat';
import type { UnitStatus } from '../unitStatus';
import StatusCard from './StatusCard';

export default function UnitInfoWindow({ app }: { app: BattleApp }) {
  // 中身は app から毎回読む（状態は書き換えられるので、知らせを受けたら描き直す）
  const [, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const offs = [
      app.on('load', bump),
      app.on('phase', bump),
      app.on('deploy', bump),
      app.on('hover', bump),
      app.on('select', bump),
      app.on('planChange', bump),
      app.on('execute', bump),
      app.on('turn', bump),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [app]);

  const unit = app.infoUnit();
  const status = unit && app.statuses.get(unit);
  if (!unit || !status) return null;

  const team = TEAM_DEFS[unit.team];
  const magic = COMBAT_DEFS[unit.type].magic;
  return (
    <ThinFrameWithTitle title="騎士" className="battle-window unit-info" style={{ '--team': team.color } as CSSProperties}>
      <div className="info-head">
        <span className="info-name">
          {team.name} {UNIT_DEFS[unit.type].name}
        </span>
        <State app={app} unit={unit} status={status} />
      </div>
      <StatusCard status={status} className="in-info" />
      <dl>
        <dt>最大兵数</dt>
        <dd>{status.maxSoldiers}</dd>
        <dt>行動力</dt>
        <dd>
          <b>{status.ap}</b> / {status.maxAp}
        </dd>
        <dt>スキル</dt>
        <dd>{status.skills.length > 0 ? status.skills.map((s) => SKILL_DEFS[s].name).join('・') : <span className="none">なし</span>}</dd>
      </dl>
      {/* 指揮官の能力（0..100）。魔術師は武力の代わりに知力を使う */}
      <div className="info-stats">
        <Stat label="統率" n={status.leadership} />
        <Stat label="武力" n={status.strength} unused={magic} />
        <Stat label="知力" n={status.intelligence} unused={!magic} />
      </div>
    </ThinFrameWithTitle>
  );
}

/** いまの様子（配備フェーズ・相手方・行動済み・迎撃の構え） */
function State({ app, unit, status }: { app: BattleApp; unit: UnitData; status: UnitStatus }) {
  if (app.deployment) return <span className="info-state">配備中</span>;
  if (status.intercepting) return <span className="info-state">迎撃の構え</span>;
  if (unit.team !== app.activeTeam) return <span className="info-state">相手方</span>;
  if (app.done.has(unit))
    return (
      <span className="info-state done">
        <b>E</b>行動済み
      </span>
    );
  return <span className="info-state">行動できる</span>;
}

/** 指揮官の能力の値とグラフ */
function Stat({ label, n, unused = false }: { label: string; n: number; unused?: boolean }) {
  return (
    <div className={`stat${unused ? ' unused' : ''}`}>
      <span className="label">{label}</span>
      <span className="value">{n}</span>
      <div className="track">
        <div className="fill" style={{ width: `${Math.max(0, Math.min(100, n))}%` }} />
      </div>
    </div>
  );
}
