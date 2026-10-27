/**
 * 選択中のユニットの近くに出す行動メニュー。中身は ActionMenuModel（menuModel.ts）が持つ。
 *
 * - ユニットの絵（移動を予約したら予約した移動先に置いた絵）の横に置き、カメラを動かしても毎フレーム追いかける
 *   （位置は再描画せずに DOM を直接動かす）。置く位置は、絵の右・左に上端をそろえる・下端をそろえるの 4 通りのうち、
 *   予約した移動のルート・攻撃の矢印をいちばん隠さないところ（同じくらいなら右に上端をそろえる・前のフレームと同じ位置）。
 * - 上部はユニットの名前と残り行動力だけ（顔・兵士数・士気・指揮官の能力は、地形の横の部隊のウィンドウ UnitInfoWindow.tsx に出す）。
 * - 2 階層目は 1 階層目の項目の横に開く。マウスは項目に乗せる、タッチはタップで開く。
 *   選べない項目（退却先の無い退却など）は灰色で出し、理由を title に持たせる。
 * - 退却を選んだ後は、項目の代わりに退却先の拠点の一覧と失敗する確率を出す（「戻る」で項目に戻る）。
 *   強制退却（負けた陣営に残った部隊）は、メニューを赤い縁で囲み、項目の上に赤い「強制退却」の帯を出して、「戻る」を出さない。
 * - 選べる行動が無い（行動済みの E の印が付く。待機は数えない）ときは、項目の上に赤い「行動終了」の帯を出す。
 * - パネルは norden-ui の細いベゼル（ThinFrame）で囲む。
 */
import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import { ThinFrame } from 'norden-ui';
import { TEAM_DEFS } from '@norden/map-runtime/core/units';
import { canAct, type MenuAction, type MenuEntry } from '../actions';
import { lengthInRect, type ActionMenuModel, type MenuFrame, type RetreatMenu, type ScreenRect } from '../menuModel';
import { useUnitName } from './factionsContext';

/** ユニットの絵とメニューの間隔（CSS ピクセル） */
const GAP = 14;
/** 画面の端からの余白 */
const MARGIN = 8;
/** 1 階層目と 2 階層目の間隔 */
const SUB_GAP = 4;
/** ルート・矢印を隠す長さを測るときの刻み（CSS ピクセル） */
const AVOID_STEP = 4;
/** 置く位置の候補ごとの、ルート・矢印を隠す長さに足す量（右に上端をそろえるのを優先する） */
const SLOT_BIAS = [0, 6, 12, 18];
/** 前のフレームと同じ位置の候補から引く量（カメラを動かしたときに行き来しないように） */
const KEEP_BONUS = 24;

export default function ActionMenu({ model }: { model: ActionMenuModel }) {
  const { ctx, entries, openIndex, retreat } = useSyncExternalStore(model.subscribe, model.getState);
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLLIElement | null)[]>([]);
  const unitName = useUnitName();

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
    <div ref={rootRef} className={`action-menu${retreat?.forced ? ' is-forced' : ''}`} style={{ '--team': team.color } as CSSProperties}>
      <div ref={mainRef} className="menu-panel main">
        <ThinFrame />
        <div className="menu-body">
          <div className="menu-head">
            <div className="menu-title">
              {unitName(unit, status.name)}
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
          {!retreat && !ctx.planned && !canAct(ctx) && (
            <div className="menu-ended" title="移動・攻撃・迎撃・特殊のどれも選べない">
              行動終了
            </div>
          )}
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
                <li key={a.id} className="menu-item" data-sound="click" onClick={() => model.choose(a)}>
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
      <li ref={itemRef} className={`menu-item${kind}`} data-sound="click" onPointerEnter={() => model.closeSub()} onClick={() => model.choose(a)}>
        {content}
      </li>
    );
  }
  return (
    <li
      ref={itemRef}
      className={`menu-item has-sub${open ? ' open' : ''}`}
      data-sound="click"
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
  const { destinations, enemies, failChance, forced } = retreat;
  return (
    <>
      {forced && (
        <div className="menu-forced" role="note">
          <b>強制退却</b>
          <span>退却先を選んでください</span>
        </div>
      )}
      <div className="menu-note">
        {forced ? '退却先' : '退却先を選択'}
        <span className="fail" title={`隣接する敵 ${enemies} 部隊`}>
          失敗 {Math.round(failChance * 100)}%
        </span>
      </div>
      <ul className="menu-items">
        {destinations.map((d) => (
          <li key={d.id} className="menu-item" data-sound="click" onClick={() => model.chooseRetreat(d)}>
            <span className="name">{d.name}</span>
          </li>
        ))}
        {!forced && (
          <li className="menu-item back" data-sound="click" onClick={() => model.closeRetreat()}>
            <span className="name">戻る</span>
          </li>
        )}
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
  frame: MenuFrame,
  model: ActionMenuModel,
  root: HTMLElement,
  main: HTMLElement,
  sub: HTMLElement | null,
  items: readonly (HTMLLIElement | null)[],
): void {
  const { sprite, width: w, height: h } = frame;
  const offscreen = !sprite || sprite.r < 0 || sprite.l > w || sprite.b < 0 || sprite.t > h;
  const hidden = offscreen || model.suspended;
  root.style.visibility = hidden ? 'hidden' : 'visible';
  if (hidden || !sprite) return;

  const { openIndex } = model.getState();
  const openItem = openIndex !== null ? items[openIndex] : null;
  const mw = main.offsetWidth;
  const mh = main.offsetHeight;
  const sw = openItem && sub ? sub.offsetWidth + SUB_GAP : 0;
  // 1 階層目は絵の右・左に上端・下端をそろえる 4 通りから、画面に入るもののうちルート・矢印をいちばん隠さないところ
  // （どれも入らなければ右に上端をそろえる）。2 階層目の開け閉めではメニューを動かさない（逃げるように見えるため）
  const fitsRight = sprite.r + GAP + mw <= w - MARGIN;
  const fitsLeft = sprite.l - GAP - mw >= MARGIN;
  const slots = [
    { right: true, top: true },
    { right: false, top: true },
    { right: true, top: false },
    { right: false, top: false },
  ];
  // 前のフレームの位置を優先するのは、避ける線があるときだけ（予約が無くなったら右に上端をそろえる位置へ戻る）
  const prev = frame.avoid.length > 0 ? Number(root.dataset.slot ?? 0) : -1;
  let best = 0;
  let bestCost = Infinity;
  let bestRect = menuRect(sprite, true, true, mw, mh, w, h);
  for (let i = 0; i < slots.length; i++) {
    const { right, top } = slots[i];
    if (right ? !fitsRight && fitsLeft : !fitsLeft) continue;
    const rect = menuRect(sprite, right, top, mw, mh, w, h);
    const cost = lengthInRect(rect, frame.avoid, AVOID_STEP) + SLOT_BIAS[i] - (i === prev ? KEEP_BONUS : 0);
    if (cost < bestCost) {
      best = i;
      bestCost = cost;
      bestRect = rect;
    }
  }
  root.dataset.slot = String(best);
  const { l: x, t: y } = bestRect;
  const onRight = slots[best].right;
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

/** 絵の右（right）・左に、上端（top）・下端をそろえて置いたメニューの範囲（画面に収まるようにずらす） */
function menuRect(sprite: ScreenRect, right: boolean, top: boolean, mw: number, mh: number, w: number, h: number): ScreenRect {
  const x = Math.min(Math.max(right ? sprite.r + GAP : sprite.l - GAP - mw, MARGIN), w - MARGIN - mw);
  const y = Math.min(Math.max(top ? sprite.t : sprite.b - mh, MARGIN), h - MARGIN - mh);
  return { l: x, t: y, r: x + mw, b: y + mh };
}
