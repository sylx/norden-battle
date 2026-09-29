import GUI from 'lil-gui';
import { MapParseError, parseMapData, stringifyMapData, type HexCell, type MapData } from '../core/mapData';
import { generateRandomMap } from '../core/randomMap';
import { DEFAULT_TERRAIN_PARAMS } from '../core/terrainGen';
import { FEATURE_DEFS } from '../core/features';
import { TERRAIN_DEFS, TERRAIN_IDS } from '../core/terrainTypes';
import { TEAM_DEFS, TEAM_IDS, UNIT_DEFS, UNIT_TYPES, type TeamId, type UnitType } from '../core/units';
import { foliageUniforms, windUniforms } from '../render/foliage';
import type { EditTool, EditorApp, OverlayMode } from './app';

const SAMPLES = [
  { file: 'fluen.json', label: 'フルーエン近郊 (flat 24×16)' },
  { file: 'pointy-test.json', label: 'pointy-top テスト (16×12)' },
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function setupUI(app: EditorApp): { loadInitial(): Promise<void> } {
  const status = $('status');
  const setStatus = (html: string) => (status.innerHTML = html);
  const showError = (e: unknown) => {
    const msg = e instanceof MapParseError ? `マップの読み込みに失敗: ${e.message}` : String(e);
    setStatus(`<span class="err">${escapeHtml(msg)}</span>`);
    console.error(e);
  };

  const load = (data: MapData) => {
    app.loadMap(data);
    $('map-title').textContent = `${data.name} — ${data.grid.orientation} ${data.grid.cols}×${data.grid.rows}`;
  };

  const loadJsonText = (text: string) => {
    try {
      load(parseMapData(JSON.parse(text)));
    } catch (e) {
      showError(e);
    }
  };

  const loadSample = async (file: string) => {
    try {
      const res = await fetch(`./maps/${file}`);
      if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
      load(parseMapData(await res.json()));
    } catch (e) {
      showError(e);
    }
  };

  // --- マップ ---
  const sampleSel = $<HTMLSelectElement>('sample-select');
  for (const s of SAMPLES) sampleSel.add(new Option(s.label, s.file));
  sampleSel.addEventListener('change', () => loadSample(sampleSel.value));

  const fileInput = $<HTMLInputElement>('file-input');
  $('btn-open').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (f) loadJsonText(await f.text());
    fileInput.value = '';
  });
  $('btn-save').addEventListener('click', () => {
    if (!app.map) return;
    const data = app.map.toJSON();
    const blob = new Blob([stringifyMapData(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${data.name.replace(/[\\/:*?"<>|\s]+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) document.body.classList.remove('dragging');
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.body.classList.remove('dragging');
    const f = e.dataTransfer?.files[0];
    if (f) loadJsonText(await f.text());
  });

  // --- ランダム生成 ---
  const seedInput = $<HTMLInputElement>('rnd-seed');
  const randomize = () => {
    const seed = Number(seedInput.value) || 1;
    load(
      generateRandomMap({
        seed,
        cols: clampInt($<HTMLInputElement>('rnd-cols').value, 2, 80),
        rows: clampInt($<HTMLInputElement>('rnd-rows').value, 2, 80),
        orientation: $<HTMLSelectElement>('rnd-orient').value as 'flat' | 'pointy',
      }),
    );
  };
  $('btn-random').addEventListener('click', randomize);
  $('btn-random-next').addEventListener('click', () => {
    seedInput.value = String((Number(seedInput.value) || 0) + 1);
    randomize();
  });

  // --- 表示 ---
  const overlaySel = $<HTMLSelectElement>('overlay-mode');
  const legend = $('legend');
  const updateLegend = () => {
    legend.innerHTML =
      app.display.overlayMode === 'terrain'
        ? TERRAIN_IDS.map(
            (id) =>
              `<div class="item"><span class="swatch" style="background:${TERRAIN_DEFS[id].overlay}"></span>${TERRAIN_DEFS[id].name}</div>`,
          ).join('')
        : '';
  };
  overlaySel.addEventListener('change', () => {
    app.display.overlayMode = overlaySel.value as OverlayMode;
    app.applyDisplay();
    updateLegend();
  });
  const bindCheck = (id: string, key: 'grid' | 'trees' | 'water' | 'structures' | 'roads' | 'units') => {
    const el = $<HTMLInputElement>(id);
    el.addEventListener('change', () => {
      app.display[key] = el.checked;
      app.applyDisplay();
    });
  };
  bindCheck('chk-grid', 'grid');
  bindCheck('chk-trees', 'trees');
  bindCheck('chk-water', 'water');
  bindCheck('chk-structures', 'structures');
  bindCheck('chk-roads', 'roads');
  bindCheck('chk-units', 'units');

  // --- 人工物の配置ツール ---
  const toolButtons = [...document.querySelectorAll<HTMLButtonElement>('button[data-tool]')];
  const setTool = (tool: EditTool) => {
    app.tool = tool;
    for (const b of toolButtons) b.classList.toggle('active', b.dataset.tool === tool);
  };
  for (const b of toolButtons) b.addEventListener('click', () => setTool(b.dataset.tool as EditTool));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) setTool('select');
  });
  app.onMessage = (msg) => {
    setStatus(`<span class="err">${escapeHtml(msg)}</span>`);
  };

  // --- ユニット ---
  const unitTypeSel = $<HTMLSelectElement>('unit-type');
  const unitTeamSel = $<HTMLSelectElement>('unit-team');
  for (const id of UNIT_TYPES) unitTypeSel.add(new Option(UNIT_DEFS[id].name, id));
  for (const id of TEAM_IDS) unitTeamSel.add(new Option(TEAM_DEFS[id].name, id));
  unitTypeSel.value = app.unitBrush.type;
  unitTeamSel.value = app.unitBrush.team;
  // 兵種・軍を選んだらそのまま置けるようにする
  unitTypeSel.addEventListener('change', () => {
    app.unitBrush.type = unitTypeSel.value as UnitType;
    setTool('unit');
  });
  unitTeamSel.addEventListener('change', () => {
    app.unitBrush.team = unitTeamSel.value as TeamId;
    setTool('unit');
  });
  $('btn-units-demo').addEventListener('click', () => app.deployDemoUnits());
  $('btn-units-clear').addEventListener('click', () => app.clearUnits());

  // --- HEX 情報 ---
  const renderInfo = (el: HTMLElement, cell: HexCell | null) => {
    if (!cell || !app.map) {
      el.innerHTML = '<dt>-</dt><dd></dd>';
      return;
    }
    const a = app.map.layout.offsetToAxial(cell.col, cell.row);
    const unit = app.map.unitAt(cell.col, cell.row);
    el.innerHTML = [
      ['座標', `(${cell.col}, ${cell.row})`],
      ['軸座標', `q=${a.q}, r=${a.r}`],
      ['地形', TERRAIN_DEFS[cell.terrain].name],
      ['標高', `Lv ${cell.elevation}`],
      ['人工物', cell.feature ? FEATURE_DEFS[cell.feature].name : '-'],
      ['街道', cell.roads ? `${cell.roads.length} 方向` : '-'],
      [
        'ユニット',
        unit
          ? `${TEAM_DEFS[unit.team].name} ${UNIT_DEFS[unit.type].name}（${unit.facing === 'left' ? '左' : '右'}向き）`
          : '-',
      ],
    ]
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
      .join('');
  };
  app.onHover = (c) => renderInfo($('hover-info'), c);
  app.onSelect = (c) => renderInfo($('select-info'), c);
  renderInfo($('hover-info'), null);
  renderInfo($('select-info'), null);

  app.onGenerated = (s) =>
    setStatus(
      [
        `生成 ${s.ms.toFixed(0)} ms`,
        `頂点 ${s.vertices.toLocaleString()}`,
        `木 ${s.trees.toLocaleString()}`,
        '左ドラッグ: 移動 / ホイール: ズーム / クリック: 選択',
      ].join('<span>|</span>'),
    );

  // --- 地形生成パラメータ (lil-gui) ---
  const gui = new GUI({ title: '地形生成パラメータ' });
  let timer = 0;
  const regen = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => app.regenerate(false), 60);
  };
  const p = app.params;
  const fShape = gui.addFolder('形状');
  fShape.add(p, 'levelHeight', 0, 1, 0.01).name('標高1段の高さ').onFinishChange(regen);
  fShape.add(p, 'blendStart', 0, 1.2, 0.01).name('平坦部 (内接半径比)').onFinishChange(regen);
  fShape.add(p, 'blendEnd', 1.2, 2.2, 0.01).name('混合の終端').onFinishChange(regen);
  fShape.add(p, 'warpAmp', 0, 0.8, 0.01).name('境界の歪み量').onFinishChange(regen);
  fShape.add(p, 'warpFreq', 0.1, 3, 0.05).name('境界の歪み周波数').onFinishChange(regen);
  fShape.add(p, 'waterLevel', -0.5, 0.3, 0.01).name('水面の高さ').onFinishChange(regen);
  const fLook = gui.addFolder('見た目');
  fLook.add(p, 'snowLine', 0.5, 4, 0.05).name('雪線').onFinishChange(regen);
  fLook.add(p, 'colorSharpness', 1, 8, 0.1).name('色境界の鋭さ').onFinishChange(regen);
  fLook.add(p, 'treeDensity', 0, 2, 0.05).name('木の密度').onFinishChange(regen);
  fLook.add(p, 'treeSpacing', 0.1, 0.5, 0.01).name('木の間隔').onFinishChange(regen);
  const u = app.overlay.uniforms;
  fLook.add(u.uGrain, 'value', 0, 0.6, 0.01).name('地表の粒状感');
  fLook.add(windUniforms.uWind, 'value', 0, 3, 0.05).name('風の強さ');
  fLook.add(foliageUniforms.broadleafMipAlpha, 'value', 0, 2, 0.01).name('遠景の葉の補正 (広葉樹)');
  fLook.add(foliageUniforms.needleMipAlpha, 'value', 0, 2, 0.01).name('遠景の葉の補正 (針葉樹)');
  const fGrid = gui.addFolder('グリッド');
  const gridState = { opacity: u.uGridOpacity.value, color: '#' + u.uGridColor.value.getHexString() };
  fGrid.add(gridState, 'opacity', 0, 1, 0.01).name('不透明度').onChange((v: number) => app.setGridOpacity(v));
  fGrid.add(u.uLineWidth, 'value', 0.005, 0.1, 0.001).name('線幅');
  fGrid.addColor(gridState, 'color').name('線の色').onChange((v: string) => u.uGridColor.value.set(v));
  fGrid.add(u.uCellOpacity, 'value', 0, 1, 0.01).name('HEX 塗りの濃さ');
  const fCamera = gui.addFolder('カメラ');
  const camState = { pitch: app.ctx.pitch };
  fCamera
    .add(camState, 'pitch', 30, 80, 1)
    .name('俯角 (度)')
    .onChange((v: number) => app.ctx.setPitch(v));
  const fQuality = gui.addFolder('品質');
  fQuality.add(p, 'resolution', 2, 24, 1).name('頂点密度 (/単位)').onFinishChange(regen);
  fQuality.add(p, 'margin', 0, 6, 1).name('外周マージン (HEX)').onFinishChange(regen);
  gui
    .add(
      {
        reset: () => {
          Object.assign(p, DEFAULT_TERRAIN_PARAMS);
          gui.controllersRecursive().forEach((c) => c.updateDisplay());
          app.regenerate(false);
        },
      },
      'reset',
    )
    .name('パラメータを初期値に戻す');

  return {
    async loadInitial() {
      const q = new URLSearchParams(location.search);
      const seed = q.get('seed');
      if (seed) {
        seedInput.value = seed;
        randomize();
        return;
      }
      const file = q.get('map') ?? SAMPLES[0].file;
      sampleSel.value = file;
      await loadSample(file);
    },
  };
}

function clampInt(v: string, min: number, max: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : min;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
