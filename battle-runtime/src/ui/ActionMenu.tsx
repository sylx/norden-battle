/**
 * 選択中のユニットの近くに出す行動メニュー。中身は ActionMenuModel（menuModel.ts）が持つ。
 *
 * - ユニットの絵（移動を予約したら予約した移動先に置いた絵）の右（入らなければ左）に置き、
 *   カメラを動かしても毎フレーム追いかける（位置は再描画せずに DOM を直接動かす）。
 * - 上部はユニットの名前と残り行動力だけ（顔・兵士数・士気・指揮官の能力は、地形の横の部隊のウィンドウ UnitInfoWindow.tsx に出す）。
 * - 2 階層目は 1 階層目の項目の横に開く。マウスは項目に乗せる、タッチはタップで開く。
 *   選べない項目（退却先の無い退却など）は灰色で出し、理由を title に持たせる。
 * - 退却を選んだ後は、項目の代わりに退却先の拠点の一覧と失敗する確率を出す（「戻る」で項目に戻る）。
 * - パネルは norden-ui の細いベゼル（ThinFrame）で囲む。
 */
import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import { ThinFrame } from 'norden-ui';
import { TEAM_DEFS, UNIT_DEFS } from '@norden/map-runtime/core/units';
import type { MenuAction, MenuEntry } from '../actions';
import type { ActionMenuModel, MenuFrame, RetreatMenu } from '../menuModel';
import { useTeamName } from './factionsContext';

/** ユニットの絵とメニューの間隔（CSS ピクセル） */
const GAP = 14;
/** 画面の端からの余白 */
const MARGIN = 8;
/** 1 階層目と 2 階層目の間隔 */
const SUB_GAP = 4;

export default function ActionMenu({ model }: { model: ActionMenuModel }) {
  const { ctx, entries, openIndex, retreat } = useSyncExternalStore(model.subscribe, model.getState);
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLLIElement | null)[]>([]);
  const teamName = useTeamName();

  useEffect(
    () =>
      model.onFrame((frame) => {
        const root = rootRef.current;
        const main = mainRef.current;
        if (root && main) place(frame, model, root, main, subRef.current, items.current);
      }),
    [model],
  );

  if (!ctx) return null;
  const { unit, status } = ctx;
  const team = TEAM_DEFS[unit.team];
  const sub = openIndex !== null ? entries[openIndex]?.children : undefined;

  return (
    <div ref={rootRef} className="action-menu" style={{ '--team': team.color } as CSSProperties}>
      <div ref={mainRef} className="menu-panel main">
        <ThinFrame />
        <div className="menu-body">
          <div className="menu-head">
            <div className="menu-title">
              {teamName(unit.team)} {UNIT_DEFS[unit.type].name}
            </div>
            <div className="menu-ap">
              <span className="label">行動力</span>
              <span className="value">{ctx.ap}</span>
              <span className="max">/{status.maxAp}</span>
              {/* 予約で使う分は欠けて見せる（0.5 刻みなので半分の印もある） */}
              <span className="pips">
                {Array.from({ length: status.maxAp }, (_, i) => (
                  <i key={i} className={i + 1 <= ctx.ap ? 'on' : i < ctx.ap ? 'half' : i < status.ap ? 'spent' : ''} />
                ))}
              </span>
            </div>
          </div>
          {retreat ? (
            <RetreatList retreat={retreat} model={model} />
          ) : (
            <ul className="menu-items">
              {entries.map((entry, i) => (
                <Item key={i} entry={entry} open={openIndex === i} model={model} index={i} itemRef={(el) => void (items.current[i] = el)} />
              ))}
            </ul>
          )}
        </div>
      </div>
      {sub && (
        <div ref={subRef} className="menu-panel sub">
          <ThinFrame />
          <ul className="menu-body menu-items">
            {sub.map(({ reason, ...a }) =>
              reason ? (
                <li key={a.id} className="menu-item disabled" title={reason}>
                  <span className="name">{a.name}</span>
                  {a.cost !== undefined && <Cost n={a.cost} />}
                </li>
              ) : (
                <li key={a.id} className="menu-item" onClick={() => model.choose(a)}>
                  <span className="name">{a.name}</span>
                  {a.cost !== undefined && <Cost n={a.cost} />}
                </li>
              ),
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function Item({
  entry,
  open,
  model,
  index,
  itemRef,
}: {
  entry: MenuEntry;
  open: boolean;
  model: ActionMenuModel;
  index: number;
  itemRef: (el: HTMLLIElement | null) => void;
}) {
  const { action, children } = entry;
  const kind = action?.id === 'confirm' || action?.id === 'cancel' ? ` ${action.id}` : '';
  const content = (
    <>
      <span className="name">{entry.name}</span>
      {action?.cost !== undefined && <Cost n={action.cost} />}
      {children && <span className="arrow" />}
    </>
  );
  if (!entry.enabled) {
    return (
      <li ref={itemRef} className={`menu-item disabled${kind}`} title={entry.reason ?? ''}>
        {content}
      </li>
    );
  }
  if (action) {
    const a: MenuAction = action;
    return (
      <li ref={itemRef} className={`menu-item${kind}`} onPointerEnter={() => model.closeSub()} onClick={() => model.choose(a)}>
        {content}
      </li>
    );
  }
  return (
    <li
      ref={itemRef}
      className={`menu-item has-sub${open ? ' open' : ''}`}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') model.openSub(index);
      }}
      onClick={() => (open ? model.closeSub() : model.openSub(index))}
    >
      {content}
    </li>
  );
}

/** 退却先の拠点の一覧（項目の代わりに出す） */
function RetreatList({ retreat, model }: { retreat: RetreatMenu; model: ActionMenuModel }) {
  const { destinations, enemies, failChance } = retreat;
  return (
    <>
      <div className="menu-note">
        退却先を選択
        <span className="fail" title={`隣接する敵 ${enemies} 部隊`}>
          失敗 {Math.round(failChance * 100)}%
        </span>
      </div>
      <ul className="menu-items">
        {destinations.map((d) => (
          <li key={d.id} className="menu-item" onClick={() => model.chooseRetreat(d)}>
            <span className="name">{d.name}</span>
          </li>
        ))}
        <li className="menu-item back" onClick={() => model.closeRetreat()}>
          <span className="name">戻る</span>
        </li>
      </ul>
    </>
  );
}

/** 消費する行動力 */
function Cost({ n }: { n: number }) {
  return (
    <span className="cost" title={`行動力 ${n}`}>
      {n}
    </span>
  );
}

/** メニューをユニットの絵の横へ動かす。絵が画面の外か、メニューを隠している間は隠す */
function place(
  { sprite, width: w, height: h }: MenuFrame,
  model: ActionMenuModel,
  root: HTMLElement,
  main: HTMLElement,
  sub: HTMLElement | null,
  items: readonly (HTMLLIElement | null)[],
): void {
  const offscreen = !sprite || sprite.r < 0 || sprite.l > w || sprite.b < 0 || sprite.t > h;
  const hidden = offscreen || model.suspended;
  root.style.visibility = hidden ? 'hidden' : 'visible';
  if (hidden || !sprite) return;

  const { openIndex } = model.getState();
  const openItem = openIndex !== null ? items[openIndex] : null;
  const mw = main.offsetWidth;
  const mh = main.offsetHeight;
  const sw = openItem && sub ? sub.offsetWidth + SUB_GAP : 0;
  // 1 階層目は絵の右に入れば右、だめなら左。2 階層目の開け閉めではメニューを動かさない（逃げるように見えるため）
  const onRight = sprite.r + GAP + mw <= w - MARGIN || sprite.l - GAP - mw < MARGIN;
  let x = onRight ? sprite.r + GAP : sprite.l - GAP - mw;
  x = Math.min(Math.max(x, MARGIN), w - MARGIN - mw);
  const y = Math.min(Math.max(sprite.t, MARGIN), h - MARGIN - mh);
  root.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;

  if (openItem && sub) {
    // 2 階層目は開いた項目の高さにそろえ、外側（絵と反対側）へ開く。画面からはみ出すなら内側へ
    const subRight = onRight ? x + mw + sw <= w - MARGIN : x - sw < MARGIN;
    sub.style.left = subRight ? `${mw + SUB_GAP}px` : `${-sw}px`;
    const body = sub.querySelector<HTMLElement>('.menu-body');
    const top = openItem.offsetTop - (body?.offsetTop ?? 0);
    sub.style.top = `${Math.min(Math.max(top, MARGIN - y), h - MARGIN - y - sub.offsetHeight)}px`;
  }
}
