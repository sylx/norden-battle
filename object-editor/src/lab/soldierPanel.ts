/**
 * 兵士の試作の右パネル。
 */
import { ARMOR_TYPES, HELMET_TYPES, SHIELD_TYPES, TEAM_COLORS, WEAPON_TYPES, type SoldierParams } from '@norden/asset-runtime/three';
import type { ObjectEditorApp } from '../editor/app';
import { h, row, type Child, type PanelKit } from '../editor/panel';
import type { LabMode } from './soldierLab';

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
  const { selectInput, rangeInput, numberInput, colorInput, button, checkbox, dynamic } = kit;

  const teamButtons = TEAM_COLORS.map((t) => {
    const b = button('', () => set('teamColor', t.color), 'swatch-button');
    b.title = t.label;
    b.style.background = `#${t.color.toString(16).padStart(6, '0')}`;
    return b;
  });

  const clipOptions = [['', '（停止）'] as const, ...[...lab.clips.keys()].map((k) => [k, k] as const)];
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
        ] as const,
        () => lab.mode,
        (v: LabMode) => {
          lab.mode = v;
          lab.rebuild();
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
    h(
      'div',
      { className: 'buttons' },
      button('寄り', () => lab.frameClose()),
      button('戦闘カメラ（近）', () => lab.battleView(2.5)),
      button('戦闘カメラ（標準）', () => lab.battleView(5)),
    ),
    h(
      'div',
      {},
      checkbox('基準の人形', () => app.display.references, (v) => {
        app.display.references = v;
        app.applyDisplay();
      }),
    ),
    dynamic(() => [
      h('p', {
        className: 'hint',
        textContent: `1 体 ${Math.round(lab.triangles / Math.max(lab.unitCount, 1)).toLocaleString()} 三角形・1 ドローコール（${lab.unitCount} 体で ${lab.triangles.toLocaleString()} 三角形）`,
      }),
    ]),

    h('div', { className: 'buttons' }, button('閉じる', () => app.closeLab())),
  ];
}
