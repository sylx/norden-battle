/**
 * 兵士の試作の右パネル。
 */
import { ARMOR_TYPES, HELMET_TYPES, SHIELD_TYPES, TEAM_COLORS, WEAPON_TYPES, type SoldierParams } from '@norden/asset-runtime/three';
import type { ObjectEditorApp } from '../editor/app';
import { h, row, type Child, type PanelKit } from '../editor/panel';
import type { LabMode, RenderMode } from './soldierLab';

export function buildSoldierPanel(
  kit: PanelKit,
  app: ObjectEditorApp,
  setStatus: (html: string) => void,
  run: (fn: () => Promise<unknown>) => void,
): Child[] {
  const lab = app.lab!;
  const set = <K extends keyof SoldierParams>(k: K, v: SoldierParams[K]) => {
    lab.params[k] = v;
    lab.rebuild();
    app.notify();
  };
  const { selectInput, rangeInput, numberInput, colorInput, button, checkbox } = kit;

  const teamButtons = TEAM_COLORS.map((t) => {
    const b = button('', () => set('teamColor', t.color), 'swatch-button');
    b.title = t.label;
    b.style.background = `#${t.color.toString(16).padStart(6, '0')}`;
    return b;
  });

  const clipOptions = [['', '（停止）'] as const, ...[...lab.clips.keys()].map((k) => [k, k] as const)];
  const armyDistance = () => Math.min(11, 4 + Math.sqrt(lab.army.squadsPerSide) * 1.6);
  const rebuildArmy = () => {
    lab.rebuild();
    app.notify();
  };
  const armySection = (): Child[] => [
    h('h2', { textContent: '大軍' }),
    row(
      '描画方式',
      selectInput(
        [
          ['instanced', 'インスタンス（ベイク）'],
          ['skinned', '1 体ずつ SkinnedMesh'],
        ] as const,
        () => lab.army.render,
        (v: RenderMode) => {
          lab.army.render = v;
          rebuildArmy();
        },
      ),
    ),
    row('片軍の部隊', numberInput(() => lab.army.squadsPerSide, (v) => ((lab.army.squadsPerSide = clampInt(v, 1, 60)), rebuildArmy()), 1, 0)),
    row('1 部隊の人数', numberInput(() => lab.army.perSquad, (v) => ((lab.army.perSquad = clampInt(v, 1, 20)), rebuildArmy()), 1, 0)),
    row('見た目の種類', numberInput(() => lab.army.variants, (v) => ((lab.army.variants = clampInt(v, 1, 8)), rebuildArmy()), 1, 0)),
    row(
      'モーション',
      selectInput(
        [['', '部隊ごとにばらばら'] as const, ...[...lab.clips.keys()].map((k) => [k, k] as const)],
        () => lab.army.clip,
        (v) => {
          lab.army.clip = v;
          rebuildArmy();
        },
      ),
    ),
    h('p', {
      className: 'hint',
      textContent: '味方（手前）は上の装備、敵（奥）は剣と盾の歩兵。インスタンス描画では兵種×見た目の種類ごとに 1 ドローコール（影でもう 1 回）',
    }),
  ];
  const compareOptions = [['', 'なし'] as const, ...lab.compareCandidates.map((e) => [e.id, e.name] as const)];

  return [
    h('h2', { textContent: '兵士の試作' }),
    h('p', {
      className: 'hint',
      textContent: 'Mixamo 骨格の各骨にコードで作ったパーツを固定した兵士。モーションは取り込んだ Mixamo のものをそのまま再生する',
    }),
    row(
      '骨格',
      selectInput(
        lab.sources.map((e) => [e.id, e.name] as const),
        () => lab.skeletonId,
        (v) => run(() => lab.setSkeleton(v).then(() => app.notify())),
      ),
    ),

    h('h2', { textContent: '装備' }),
    row('兜', selectInput(HELMET_TYPES, () => lab.params.helmet, (v) => set('helmet', v))),
    row('鎧', selectInput(ARMOR_TYPES, () => lab.params.armor, (v) => set('armor', v))),
    row('武器', selectInput(WEAPON_TYPES, () => lab.params.weapon, (v) => set('weapon', v))),
    row('盾', selectInput(SHIELD_TYPES, () => lab.params.shield, (v) => set('shield', v))),
    row('チーム色', h('div', { className: 'swatches' }, colorInput(() => lab.params.teamColor, (v) => set('teamColor', v)), ...teamButtons)),

    h('h2', { textContent: '体格' }),
    row('頭の大きさ', rangeInput(() => lab.params.headScale, (v) => set('headScale', v), 0.9, 1.8, 0.05)),
    row('太さ', rangeInput(() => lab.params.girth, (v) => set('girth', v), 0.8, 1.5, 0.05)),
    row('個体差', numberInput(() => lab.params.seed, (v) => set('seed', Math.max(1, Math.round(v))), 1, 0)),
    h('div', { className: 'buttons' }, button('別の個体', () => set('seed', lab.params.seed + 1))),

    h('h2', { textContent: 'アニメーション' }),
    row('モーション', selectInput(clipOptions, () => lab.clipName, (v) => (lab.setClip(v), app.notify()))),
    row('速さ', rangeInput(() => lab.speed, (v) => ((lab.speed = v), app.notify()), 0, 2, 0.05)),

    h('h2', { textContent: '表示' }),
    row(
      '人数',
      selectInput(
        [
          ['single', '1 体'],
          ['squad', '部隊（12 体）'],
          ['army', '大軍（負荷テスト）'],
        ] as const,
        () => lab.mode,
        (v: LabMode) => {
          lab.setMode(v);
          lab.revision++;
          if (v === 'army') lab.battleView(armyDistance());
          app.notify();
        },
      ),
    ),
    row(
      '比較',
      selectInput(compareOptions, () => lab.compareId, (v) =>
        run(async () => {
          setStatus('読み込み中…');
          await lab.setCompare(v);
          app.notify();
          setStatus('');
        }),
      ),
    ),
    ...(lab.mode === 'army' ? armySection() : []),
    h(
      'div',
      { className: 'buttons' },
      button('寄り', () => lab.frameClose()),
      button('戦闘カメラ（近）', () => lab.battleView(2.5)),
      button('戦闘カメラ（標準）', () => lab.battleView(5)),
    ),
    lab.mode === 'army' && h('div', { className: 'buttons' }, button('全体を見る', () => lab.battleView(armyDistance()))),
    h(
      'div',
      {},
      checkbox('基準の人形', () => app.display.references, (v) => {
        app.display.references = v;
        app.applyDisplay();
      }),
    ),
    perfLine(app),

    h('div', { className: 'buttons' }, button('閉じる', () => app.closeLab())),
  ];
}

const clampInt = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v)));

/** 兵の数・三角形・ドローコール・FPS（0.5 秒ごとに更新） */
function perfLine(app: ObjectEditorApp): HTMLElement {
  const el = h('p', { className: 'hint perf' });
  const update = () => {
    const lab = app.lab;
    if (!el.isConnected || !lab) {
      clearInterval(id);
      return;
    }
    const info = app.view.renderer.info.render;
    el.textContent = `${lab.soldierCount.toLocaleString()} 体・${lab.triangles.toLocaleString()} 三角形／画面全体 ${info.calls} ドローコール・${app.fps.toFixed(0)} FPS`;
  };
  const id = setInterval(update, 500);
  queueMicrotask(update);
  return el;
}
