/**
 * 戦況のパネル（画面の上の中央）。将棋の形勢のグラフのように、軍ごとの兵数の合計の比を 1 本の帯で出す。
 *
 * - 帯は軍の色で、兵数の合計に比例して分ける（攻撃側が左、防衛側が右。PANEL_ORDER）。真ん中に互角の目印を引く。
 * - 帯の上に、勢力の名前・陣営・兵数の合計・割合・部隊数を文字で出す（色だけに頼らない）。帯にカーソルを乗せても出る。
 * - 配備・攻撃・迎撃で兵数が変わるたびに、帯がなめらかに動く。
 * - 枠は norden-ui の ThinFrame（細いベゼル）。
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { ThinFrame } from 'norden-ui';
import { TEAM_DEFS, type TeamId } from '@norden/map-runtime/core/units';
import type { BattleApp } from '../app';
import { SIDE_NAMES, SIDE_TEAM } from '../deployment';
import { useTeamName } from './factionsContext';

/** 帯に並べる軍の順（攻撃側が左） */
const PANEL_ORDER: readonly TeamId[] = [SIDE_TEAM.attacker, SIDE_TEAM.defender, 'green'];

interface Force {
  team: TeamId;
  soldiers: number;
  units: number;
  /** 割合（%。合計が 100 になるように丸める） */
  percent: number;
}

export default function SituationPanel({ app }: { app: BattleApp }) {
  const [, setVersion] = useState(0);
  const teamName = useTeamName();
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const offs = [app.on('load', bump), app.on('phase', bump), app.on('deploy', bump), app.on('execute', bump), app.on('turn', bump)];
    return () => {
      for (const off of offs) off();
    };
  }, [app]);

  const forces = forcesOf(app);
  if (forces.length === 0) return null;
  return (
    <div className="battle-situation" role="group" aria-label="戦況">
      <ThinFrame />
      <div className="situation-sides">
        {forces.map((f) => (
          <div key={f.team} className="situation-side" style={{ '--team': TEAM_DEFS[f.team].color } as CSSProperties}>
            <span className="name">
              {teamName(f.team)}
              {sideName(f.team) && <small>{sideName(f.team)}</small>}
            </span>
            <span className="total">
              <output>{f.soldiers.toLocaleString()}</output>
              <span className="percent">{f.percent}%</span>
            </span>
            <span className="units">{f.units} 部隊</span>
          </div>
        ))}
      </div>
      <div className="situation-bar">
        {forces.map((f) => (
          <i
            key={f.team}
            style={{ flexGrow: f.soldiers, background: TEAM_DEFS[f.team].color }}
            title={`${teamName(f.team)}: 兵数 ${f.soldiers.toLocaleString()}（${f.percent}%）・${f.units} 部隊`}
          />
        ))}
        <span className="situation-even" />
      </div>
    </div>
  );
}

/** 防衛側・攻撃側の名前（どちらでもない軍は無し） */
function sideName(team: TeamId): string | null {
  if (team === SIDE_TEAM.defender) return SIDE_NAMES.defender;
  if (team === SIDE_TEAM.attacker) return SIDE_NAMES.attacker;
  return null;
}

/** 部隊のいる軍ごとの兵数の合計（PANEL_ORDER の順） */
function forcesOf(app: BattleApp): Force[] {
  const sums = new Map<TeamId, { soldiers: number; units: number }>();
  for (const [unit, status] of app.statuses) {
    const s = sums.get(unit.team) ?? { soldiers: 0, units: 0 };
    s.soldiers += Math.max(0, status.soldiers);
    s.units++;
    sums.set(unit.team, s);
  }
  const list = PANEL_ORDER.filter((team) => sums.has(team)).map((team) => ({ team, ...sums.get(team)!, percent: 0 }));
  const total = list.reduce((a, f) => a + f.soldiers, 0);
  if (total <= 0) return list;
  // 丸めた割合の合計が 100 になるよう、最後の軍で合わせる
  let rest = 100;
  list.forEach((f, i) => {
    f.percent = i === list.length - 1 ? rest : Math.round((f.soldiers / total) * 100);
    rest -= f.percent;
  });
  return list;
}
