import GUI from 'lil-gui';
import { BATTLE_AREA_SIZE } from '@norden/map-runtime/core/battleArea';
import { castleWard, FEATURE_DEFS } from '@norden/map-runtime/core/features';
import { MapParseError, parseMapData, stringifyMapData, type HexCell, type MapData } from '@norden/map-runtime/core/mapData';
import { generateRandomMap } from '@norden/map-runtime/core/randomMap';
import { DEFAULT_TERRAIN_PARAMS } from '@norden/map-runtime/core/terrainGen';
import { TERRAIN_DEFS, TERRAIN_IDS, type TerrainId } from '@norden/map-runtime/core/terrainTypes';
import {
  isValidMapFileName,
  listMapFiles,
  loadMapFile,
  mapFileNameFor,
  saveMapFile,
  type MapFileInfo,
} from '@norden/map-runtime/mapFiles';
import { foliageUniforms, windUniforms } from '@norden/map-runtime/render/foliage';
import { DEPLOY_COLORS, PITCH_RANGE, type EditTool, type EditorApp, type OverlayMode } from './app';
import { ComboBox } from './combobox';
import { MAX_ELEVATION, MIN_ELEVATION, type ElevationBrush, type ElevationMode } from './terrainTools';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** 軽量表示の設定を覚えておくキー */
const LITE_KEY = 'norden-map-editor.lite';

/** 標高ブラシのプリセット */
const ELEV_PRESETS: Record<string, Partial<ElevationBrush>> = {
  mountain: { mode: 'raise', amount: 3, radius: 2, smooth: true, shapeTerrain: true },
  valley: { mode: 'lower', amount: 2, radius: 1, smooth: true, shapeTerrain: false },
  plateau: { mode: 'raise', amount: 1, radius: 1, smooth: false, shapeTerrain: false },
  flatten: { mode: 'flatten', radius: 1, smooth: false },
};

/** ツールを選んだときにステータス欄に出す説明 */
const TOOL_HINTS: Partial<Record<EditTool, string>> = {
  elevation: '標高: HEX をクリック・ドラッグでなぞる / [ ] で半径',
  terrain: '地形: 矩形はドラッグで範囲を選ぶ、ブラシはなぞって塗る',
  river: '川: HEX をドラッグでなぞる（「消す」ではなぞった水域を草原に戻す）',
  road: '街道: HEX をドラッグでなぞる',
  castle: '城: クリック・ドラッグでなぞった HEX を選んだ郭の段の城にする（同じ段をクリックで撤去）',
  erase: '撤去: クリックで人工物（無ければ街道）を撤去 / なぞった HEX の人工物・街道をまとめて撤去',
};

export function setupUI(app: EditorApp): { loadInitial(): Promise<void> } {
  const status = $('status');
  const setStatus = (html: string) => (status.innerHTML = html);
  const showError = (e: unknown) => {
    const msg = e instanceof MapParseError ? `マップの読み込みに失敗: ${e.message}` : String(e);
    setStatus(`<span class="err">${escapeHtml(msg)}</span>`);
    console.error(e);
  };
  const intValue = (id: string, min: number, max: number) => clampInt($<HTMLInputElement>(id).value, min, max);

  // --- マップ（assets/maps/ に保存） ---
  const combo = new ComboBox($<HTMLDivElement>('map-combo'), 'マップを検索…');
  const loadBtn = $<HTMLButtonElement>('btn-map-load');
  const nameInput = $<HTMLInputElement>('map-name');
  const fileNameInput = $<HTMLInputElement>('map-file');
  let files: MapFileInfo[] = [];
  /** assets/maps/ から開いた（または保存した）ファイル名。ランダム生成・ローカルから開いたときは null */
  let currentFile: string | null = null;
  /** 保存していない編集があるか */
  let dirty = false;

  const updateTitle = () => {
    const data = app.map?.data;
    $('map-title').textContent = data
      ? `${dirty ? '● ' : ''}${currentFile ?? '（未保存）'} — ${data.name} — ${data.grid.orientation} ${data.grid.cols}×${data.grid.rows}` +
        (app.previewing ? `（${app.areaCity} の範囲を表示中）` : '')
      : '-';
  };

  /** 保存していない編集を捨ててよいか */
  const confirmDiscard = () => !dirty || confirm('保存していない編集があります。破棄しますか？');

  const renderCombo = () => {
    combo.setItems(
      files.map((f) => ({
        value: f.file,
        label: (!f.error && f.name) || f.file,
        detail: f.error ? '読めません' : `${f.file} · ${f.grid!.orientation} ${f.grid!.cols}×${f.grid!.rows}`,
        disabled: !!f.error,
        current: f.file === currentFile,
      })),
    );
    loadBtn.disabled = combo.value === null;
  };

  const refreshList = async () => {
    try {
      files = await listMapFiles();
    } catch (e) {
      files = [];
      showError(e);
    }
    renderCombo();
  };

  /** file = assets/maps/ のファイル名（それ以外から開いたときは null。保存欄にはその候補を入れる） */
  const load = (data: MapData, file: string | null, suggestedFile?: string) => {
    previewChk.checked = false;
    app.loadMap(data);
    currentFile = file;
    dirty = false;
    if (file) combo.setValue(file);
    renderCombo();
    nameInput.value = data.name;
    fileNameInput.value = file ?? (suggestedFile && isValidMapFileName(suggestedFile) ? suggestedFile : mapFileNameFor(data.name));
    renderLink();
    updateUndo();
    updateTitle();
  };

  const loadJsonText = (text: string, fileName?: string) => {
    if (!confirmDiscard()) return;
    try {
      load(parseMapData(JSON.parse(text)), null, fileName);
    } catch (e) {
      showError(e);
    }
  };

  const loadStored = async (file: string) => {
    try {
      load(await loadMapFile(file), file);
      setStatus(`<span class="ok">${escapeHtml(`${file} を読み込みました`)}</span>`);
    } catch (e) {
      showError(e);
    }
  };

  const loadSelected = () => {
    if (combo.value === null || !confirmDiscard()) return;
    void loadStored(combo.value);
  };
  combo.onChange = () => (loadBtn.disabled = combo.value === null);
  combo.onSubmit = loadSelected;
  loadBtn.addEventListener('click', loadSelected);
  $('btn-map-list').addEventListener('click', () => void refreshList());

  nameInput.addEventListener('change', () => {
    if (!app.map) return;
    app.checkpoint();
    app.map.data.name = nameInput.value.trim() || 'untitled';
    app.onEdit();
  });

  const save = async () => {
    if (!app.map) return;
    const file = fileNameInput.value.trim() || mapFileNameFor(app.map.data.name);
    if (!isValidMapFileName(file)) {
      showError(`ファイル名に使えません: ${file}（.json で終わり、/ \\ : * ? " < > | を含まない名前にしてください）`);
      return;
    }
    if (file !== currentFile && files.some((f) => f.file === file) && !confirm(`${file} は既にあります。上書きしますか？`)) return;
    app.map.data.name = nameInput.value.trim() || 'untitled';
    try {
      await saveMapFile(file, app.map.toJSON());
    } catch (e) {
      showError(e);
      return;
    }
    currentFile = file;
    dirty = false;
    fileNameInput.value = file;
    combo.setValue(file);
    await refreshList();
    updateTitle();
    setStatus(`<span class="ok">${escapeHtml(`assets/maps/${file} に保存しました`)}</span>`);
  };
  $('btn-save').addEventListener('click', () => void save());

  const fileInput = $<HTMLInputElement>('file-input');
  $('btn-open').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (f) loadJsonText(await f.text(), f.name);
    fileInput.value = '';
  });
  $('btn-download').addEventListener('click', () => {
    if (!app.map) return;
    const data = app.map.toJSON();
    const blob = new Blob([stringifyMapData(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileNameInput.value.trim() || mapFileNameFor(data.name);
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
    if (f) loadJsonText(await f.text(), f.name);
  });
  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });

  // --- 元に戻す・やり直す ---
  const undoBtn = $<HTMLButtonElement>('btn-undo');
  const redoBtn = $<HTMLButtonElement>('btn-redo');
  const updateUndo = () => {
    undoBtn.disabled = !app.canUndo;
    redoBtn.disabled = !app.canRedo;
  };
  undoBtn.addEventListener('click', () => app.undo());
  redoBtn.addEventListener('click', () => app.redo());
  app.onEdit = () => {
    dirty = true;
    if (app.map) nameInput.value = app.map.data.name;
    renderLink();
    updateUndo();
    updateTitle();
    // カーソルを動かさなくても、編集した HEX の地形・標高を出し直す
    app.onHover(app.hoveredCell);
  };

  // --- ツール ---
  const toolButtons = [...document.querySelectorAll<HTMLButtonElement>('button[data-tool]')];
  const toolOpts = [...document.querySelectorAll<HTMLElement>('.tool-opts')];
  const setTool = (tool: EditTool) => {
    if ((tool === 'area' || tool.startsWith('deploy-')) && app.previewing) {
      app.onMessage('範囲のプレビュー中は編集できません');
      return;
    }
    if (tool === 'area' && !app.areaCity) app.onMessage('「街道マップ」欄で都市 A・B を入れてください');
    else if (tool === 'area') setStatus(`${app.areaCity} の範囲（${BATTLE_AREA_SIZE.cols}×${BATTLE_AREA_SIZE.rows}）: クリック・ドラッグした HEX を中心に置きます`);
    else if (tool.startsWith('deploy-')) {
      if (!app.areaCity || !app.map?.data.battleAreas?.[app.areaCity]) app.onMessage('「街道マップ」欄で都市を選び、先に範囲を配置してください');
      else setStatus(`${app.areaCity} の範囲の${tool === 'deploy-attacker' ? '攻撃側' : '防衛側'}の初期配置地点: クリック・ドラッグで塗る（配置地点から始めると消す）`);
    } else if (TOOL_HINTS[tool]) setStatus(TOOL_HINTS[tool]!);
    app.setTool(tool);
    for (const b of toolButtons) b.classList.toggle('active', b.dataset.tool === tool);
    for (const el of toolOpts) el.classList.toggle('shown', el.dataset.for === tool);
  };
  for (const b of toolButtons) b.addEventListener('click', () => setTool(b.dataset.tool as EditTool));
  app.onMessage = (msg) => {
    setStatus(`<span class="err">${escapeHtml(msg)}</span>`);
  };

  // --- 標高ブラシ ---
  const eb = app.elevationBrush;
  const elevMode = $<HTMLSelectElement>('elev-mode');
  const elevAmount = $<HTMLInputElement>('elev-amount');
  const elevLevel = $<HTMLInputElement>('elev-level');
  const elevRadius = $<HTMLInputElement>('elev-radius');
  const elevSmooth = $<HTMLInputElement>('elev-smooth');
  const elevShape = $<HTMLInputElement>('elev-shape');
  const elevKeepWater = $<HTMLInputElement>('elev-keep-water');
  const renderElev = () => {
    elevMode.value = eb.mode;
    elevAmount.value = String(eb.amount);
    elevLevel.value = String(eb.level);
    elevRadius.value = String(eb.radius);
    $('elev-radius-out').textContent = String(eb.radius);
    elevSmooth.checked = eb.smooth;
    elevShape.checked = eb.shapeTerrain;
    elevKeepWater.checked = eb.keepWater;
    for (const el of document.querySelectorAll<HTMLElement>('[data-elev-show]')) el.hidden = !el.dataset.elevShow!.split(' ').includes(eb.mode);
    app.updateCellColors();
  };
  const readElev = () => {
    eb.mode = elevMode.value as ElevationMode;
    eb.amount = intValue('elev-amount', 1, 6);
    eb.level = intValue('elev-level', MIN_ELEVATION, MAX_ELEVATION);
    eb.radius = intValue('elev-radius', 0, 4);
    eb.smooth = elevSmooth.checked;
    eb.shapeTerrain = elevShape.checked;
    eb.keepWater = elevKeepWater.checked;
    renderElev();
  };
  for (const el of [elevMode, elevAmount, elevLevel, elevSmooth, elevShape, elevKeepWater]) el.addEventListener('change', readElev);
  elevRadius.addEventListener('input', readElev);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-elev-preset]')) {
    b.addEventListener('click', () => {
      Object.assign(eb, ELEV_PRESETS[b.dataset.elevPreset!]);
      renderElev();
      setTool('elevation');
      setStatus(`標高「${b.textContent}」: HEX をクリック・ドラッグでなぞる`);
    });
  }
  renderElev();

  // --- 地形の塗り ---
  const tb = app.terrainBrush;
  const palette = $('terrain-palette');
  const terrainRadius = $<HTMLInputElement>('terrain-radius');
  const renderTerrain = () => {
    for (const b of palette.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('active', b.dataset.terrain === tb.terrain);
    for (const r of document.querySelectorAll<HTMLInputElement>('input[name="terrain-shape"]')) r.checked = r.value === tb.shape;
    terrainRadius.value = String(tb.radius);
    $('terrain-radius-out').textContent = String(tb.radius);
    $<HTMLInputElement>('terrain-protect').checked = tb.protect;
    for (const el of document.querySelectorAll<HTMLElement>('[data-terrain-show]')) el.hidden = el.dataset.terrainShow !== tb.shape;
    app.updateCellColors();
  };
  palette.replaceChildren(
    ...TERRAIN_IDS.map((id) => {
      const b = document.createElement('button');
      b.dataset.terrain = id;
      b.innerHTML = `<span class="swatch" style="background:${TERRAIN_DEFS[id].overlay}"></span>${TERRAIN_DEFS[id].name}`;
      b.addEventListener('click', () => {
        tb.terrain = id;
        renderTerrain();
        setTool('terrain');
      });
      return b;
    }),
  );
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="terrain-shape"]')) {
    r.addEventListener('change', () => {
      tb.shape = r.value as 'rect' | 'brush';
      renderTerrain();
    });
  }
  terrainRadius.addEventListener('input', () => {
    tb.radius = intValue('terrain-radius', 0, 4);
    renderTerrain();
  });
  $<HTMLInputElement>('terrain-protect').addEventListener('change', (e) => (tb.protect = (e.target as HTMLInputElement).checked));
  renderTerrain();

  // --- 川 ---
  const renderRiver = () => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-river-show]')) el.hidden = el.dataset.riverShow !== app.riverBrush.mode;
  };
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="river-mode"]')) {
    r.addEventListener('change', () => {
      app.riverBrush.mode = r.value as 'draw' | 'erase';
      renderRiver();
    });
  }
  renderRiver();
  $<HTMLInputElement>('river-deep').addEventListener('change', (e) => (app.riverBrush.deep = (e.target as HTMLInputElement).checked));
  $<HTMLInputElement>('river-banks').addEventListener('change', (e) => (app.riverBrush.carveBanks = (e.target as HTMLInputElement).checked));

  // --- 城（郭の段） ---
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="castle-ward"]')) {
    r.addEventListener('change', () => {
      app.castleWard = Number(r.value);
      setTool('castle');
    });
  }
  $('btn-castle-auto').addEventListener('click', () => app.autoCastleWards(Number($<HTMLSelectElement>('castle-auto-max').value)));

  // --- 全地形クリア ---
  const clearTerrainSel = $<HTMLSelectElement>('clear-terrain');
  for (const id of TERRAIN_IDS) clearTerrainSel.add(new Option(TERRAIN_DEFS[id].name, id));
  clearTerrainSel.value = 'plains';
  const clearMode = () => document.querySelector<HTMLInputElement>('input[name="clear-elev"]:checked')!.value as 'flat' | 'random';
  const clearForest = $<HTMLInputElement>('clear-forest');
  const renderClear = () => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-clear-show]')) el.hidden = el.dataset.clearShow !== clearMode();
    for (const el of document.querySelectorAll<HTMLElement>('[data-forest-show]')) el.hidden = !clearForest.checked;
  };
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="clear-elev"]')) r.addEventListener('change', renderClear);
  clearForest.addEventListener('change', renderClear);
  renderClear();
  const clearSeed = $<HTMLInputElement>('clear-seed');
  const doClear = () => {
    if (!app.map || app.previewing) return;
    const random = clearMode() === 'random';
    const seed = Number(clearSeed.value) || 1;
    app.clearTerrain({
      terrain: clearTerrainSel.value as TerrainId,
      elevation: random
        ? {
            mode: 'random',
            seed,
            min: intValue('clear-min', MIN_ELEVATION, MAX_ELEVATION),
            max: intValue('clear-max', MIN_ELEVATION, MAX_ELEVATION),
            scale: Math.min(Math.max(Number($<HTMLInputElement>('clear-scale').value) || 0.12, 0.01), 1),
          }
        : { mode: 'flat', level: intValue('clear-level', MIN_ELEVATION, MAX_ELEVATION) },
      shapeTerrain: $<HTMLInputElement>('clear-shape').checked,
      clearFeatures: $<HTMLInputElement>('clear-features').checked,
      forest: clearForest.checked
        ? {
            seed,
            coverage: intValue('clear-forest-coverage', 0, 100) / 100,
            scale: Math.min(Math.max(Number($<HTMLInputElement>('clear-forest-scale').value) || 0.2, 0.01), 1),
          }
        : undefined,
    });
  };
  $('btn-clear').addEventListener('click', () => {
    if (confirm('全ての HEX の地形を置き換えます（「元に戻す」で戻せます）。よろしいですか？')) doClear();
  });
  $('btn-clear-next').addEventListener('click', () => {
    clearSeed.value = String((Number(clearSeed.value) || 0) + 1);
    doClear();
  });

  // --- 街道マップ（両端の都市と、防衛する都市ごとの戦闘の範囲・初期配置地点） ---
  const linkA = $<HTMLInputElement>('link-a');
  const linkB = $<HTMLInputElement>('link-b');
  const areaList = $('area-list');
  const previewChk = $<HTMLInputElement>('chk-area-preview');
  const deployClearBtn = $<HTMLButtonElement>('btn-deploy-clear');

  function renderLink(): void {
    const data = app.map?.data;
    linkA.value = data?.link?.cities[0] ?? '';
    linkB.value = data?.link?.cities[1] ?? '';
    const cities = [
      ...new Set([...(data?.link?.cities ?? []), ...Object.keys(data?.battleAreas ?? {}), ...Object.keys(data?.deployments ?? {})]),
    ];
    if (!app.areaCity || !cities.includes(app.areaCity)) {
      app.areaCity = cities[0] ?? null;
      app.showArea();
    }
    if (cities.length === 0) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = '都市 A・B を入れると範囲を置けます';
      areaList.replaceChildren(p);
    } else {
      areaList.replaceChildren(
        ...cities.map((city) => {
          const area = data?.battleAreas?.[city];
          const dep = app.deploymentOf(city);
          const row = document.createElement('div');
          row.className = 'area';
          const label = document.createElement('label');
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = 'area-city';
          radio.checked = city === app.areaCity;
          radio.addEventListener('change', () => {
            app.areaCity = city;
            if (app.previewing) app.previewArea(data?.battleAreas?.[city] ? city : null);
            previewChk.checked = app.previewing;
            app.showArea();
            renderLink();
            updateTitle();
          });
          const pos = document.createElement('span');
          pos.className = 'pos';
          pos.textContent = area ? `(${area.col}, ${area.row})` : '未設定';
          const counts = document.createElement('span');
          counts.className = 'counts';
          const inside = (o: { col: number; row: number }) =>
            !!area && o.col >= area.col && o.row >= area.row && o.col < area.col + BATTLE_AREA_SIZE.cols && o.row < area.row + BATTLE_AREA_SIZE.rows;
          const outside = [...dep.attacker, ...dep.defender].filter((o) => !inside(o)).length;
          counts.innerHTML =
            `<span style="color:${hex(DEPLOY_COLORS.attacker)}">攻 ${dep.attacker.length}</span> ` +
            `<span style="color:${hex(DEPLOY_COLORS.defender)}">防 ${dep.defender.length}</span>` +
            (outside > 0 ? ` <span class="warn" title="範囲の外の配置地点は戦闘では使われません">範囲外 ${outside}</span>` : '');
          const text = document.createElement('span');
          text.className = 'text';
          text.append(`${city} の範囲 `, pos, document.createElement('br'), counts);
          label.append(radio, text);
          const del = document.createElement('button');
          del.textContent = '削除';
          del.title = '範囲を削除（初期配置地点は残ります）';
          del.disabled = !area || app.previewing;
          del.addEventListener('click', () => app.setBattleArea(city, null));
          row.append(label, del);
          return row;
        }),
      );
    }
    const areaReady = !!(app.areaCity && data?.battleAreas?.[app.areaCity]);
    previewChk.disabled = !areaReady && !app.previewing;
    deployClearBtn.disabled = app.previewing || !(app.areaCity && data?.deployments?.[app.areaCity]);
  }

  const applyLink = () => {
    const data = app.map?.data;
    if (!data) return;
    const a = linkA.value.trim();
    const b = linkB.value.trim();
    if (!a && !b) {
      if (data.link) {
        app.checkpoint();
        delete data.link;
      }
    } else if (a && b && a !== b) {
      app.checkpoint();
      data.link = { cities: [a, b] };
      // 街道マップのファイル名（ゲームはこの名前で読む）
      if (!currentFile) fileNameInput.value = `road-${[a, b].sort().join('-')}.json`;
    } else {
      if (a && b) showError('都市 A と B には異なる都市 ID を入れてください');
      return;
    }
    app.onEdit();
    app.showArea();
  };
  linkA.addEventListener('change', applyLink);
  linkB.addEventListener('change', applyLink);
  deployClearBtn.addEventListener('click', () => {
    if (app.areaCity && confirm(`${app.areaCity} の範囲の初期配置地点を全て消しますか？`)) app.clearDeployment();
  });
  previewChk.addEventListener('change', () => {
    if (previewChk.checked) setTool('select');
    app.previewArea(previewChk.checked ? app.areaCity : null);
    previewChk.checked = app.previewing;
    renderLink();
    updateUndo();
    updateTitle();
  });

  // --- ランダム生成 ---
  const seedInput = $<HTMLInputElement>('rnd-seed');
  const randomize = () => {
    if (!confirmDiscard()) return;
    const seed = Number(seedInput.value) || 1;
    load(
      generateRandomMap({
        seed,
        cols: intValue('rnd-cols', 2, 80),
        rows: intValue('rnd-rows', 2, 80),
        orientation: $<HTMLSelectElement>('rnd-orient').value as 'flat' | 'pointy',
      }),
      null,
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
      app.overlayMode === 'terrain'
        ? TERRAIN_IDS.map(
            (id) =>
              `<div class="item"><span class="swatch" style="background:${TERRAIN_DEFS[id].overlay}"></span>${TERRAIN_DEFS[id].name}</div>`,
          ).join('')
        : '';
  };
  overlaySel.addEventListener('change', () => {
    app.overlayMode = overlaySel.value as OverlayMode;
    app.applyDisplay();
    updateLegend();
  });
  const displayKeys = { 'chk-grid': 'grid', 'chk-trees': 'trees', 'chk-water': 'water', 'chk-structures': 'structures', 'chk-roads': 'roads' } as const;
  for (const [id, key] of Object.entries(displayKeys)) {
    const el = $<HTMLInputElement>(id);
    el.addEventListener('change', () => {
      app.display[key] = el.checked;
      app.applyDisplay();
    });
  }
  const syncDisplayChecks = () => {
    for (const [id, key] of Object.entries(displayKeys)) $<HTMLInputElement>(id).checked = app.display[key];
  };

  // --- HEX 情報 ---
  const renderInfo = (el: HTMLElement, cell: HexCell | null) => {
    const map = app.shownMap;
    if (!cell || !map) {
      el.innerHTML = '<dt>-</dt><dd></dd>';
      return;
    }
    const a = map.layout.offsetToAxial(cell.col, cell.row);
    const dep = app.previewing ? map.data.deploy : app.areaCity ? map.data.deployments?.[app.areaCity] : undefined;
    const at = (list: readonly { col: number; row: number }[] | undefined) => !!list?.some((o) => o.col === cell.col && o.row === cell.row);
    const deploy = at(dep?.attacker) ? '攻撃側' : at(dep?.defender) ? '防衛側' : '-';
    el.innerHTML = [
      ['座標', `(${cell.col}, ${cell.row})`],
      ['軸座標', `q=${a.q}, r=${a.r}`],
      ['地形', TERRAIN_DEFS[cell.terrain].name],
      ['標高', `Lv ${cell.elevation}`],
      ['人工物', featureLabel(cell)],
      ['街道', cell.roads ? `${cell.roads.length} 方向` : '-'],
      ['初期配置', deploy],
    ]
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
      .join('');
  };
  // カーソルの HEX の地形・標高（カーソルの右下に出す）
  const cursorInfo = $('cursor-info');
  const viewport = $('viewport');
  let cursorPos = { x: 0, y: 0 };
  const placeCursorInfo = () => {
    const pad = 16;
    const w = cursorInfo.offsetWidth;
    const h = cursorInfo.offsetHeight;
    // 画面の端では反対側に出す
    const x = cursorPos.x + pad + w > window.innerWidth ? cursorPos.x - pad - w : cursorPos.x + pad;
    const y = cursorPos.y + pad + h > window.innerHeight ? cursorPos.y - pad - h : cursorPos.y + pad;
    cursorInfo.style.left = `${x}px`;
    cursorInfo.style.top = `${y}px`;
  };
  viewport.addEventListener('pointermove', (e) => {
    cursorPos = { x: e.clientX, y: e.clientY };
    if (!cursorInfo.hidden) placeCursorInfo();
  });
  viewport.addEventListener('pointerleave', () => (cursorInfo.hidden = true));
  const renderCursorInfo = (cell: HexCell | null) => {
    cursorInfo.hidden = !cell;
    if (!cell) return;
    const t = TERRAIN_DEFS[cell.terrain];
    const feature = cell.feature ? featureLabel(cell) : '';
    cursorInfo.innerHTML =
      `<span class="swatch" style="background:${t.overlay}"></span>${t.name}` +
      `<span class="elev">標高 Lv ${cell.elevation}</span>` +
      (feature ? `<span class="dim">${feature}</span>` : '') +
      `<span class="dim">(${cell.col}, ${cell.row})</span>`;
    placeCursorInfo();
  };
  app.onHover = (c) => {
    renderInfo($('hover-info'), c);
    renderCursorInfo(c);
  };
  app.onSelect = (c) => renderInfo($('select-info'), c);
  renderInfo($('hover-info'), null);
  renderInfo($('select-info'), null);

  app.onGenerated = (s) =>
    setStatus(
      [
        `生成 ${s.ms.toFixed(0)} ms`,
        `頂点 ${s.vertices.toLocaleString()}`,
        `木 ${s.trees.toLocaleString()}`,
        '左ドラッグ: 移動（編集ツールでは編集） / 右ドラッグ: 移動 / 中ドラッグ: 俯角 / ホイール: ズーム',
      ].join('<span>|</span>'),
    );

  // --- 地形生成パラメータ (lil-gui。初めは閉じておく) ---
  const gui = new GUI({ title: '地形生成パラメータ' });
  gui.close();
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
  fLook.add(p, 'coniferRatio', 0, 1, 0.05).name('針葉樹の割合').onFinishChange(regen);
  const u = app.overlay.uniforms;
  fLook.add(u.uGrain, 'value', 0, 1, 0.01).name('地表の粒状感');
  fLook.add(windUniforms.uWind, 'value', 0, 3, 0.05).name('風の強さ');
  fLook.add(foliageUniforms.broadleafMipAlpha, 'value', 0, 2, 0.01).name('遠景の葉の補正 (広葉樹)');
  fLook.add(foliageUniforms.needleMipAlpha, 'value', 0, 2, 0.01).name('遠景の葉の補正 (針葉樹)');
  const fGrid = gui.addFolder('グリッド');
  const gridState = { opacity: u.uGridOpacity.value, color: '#' + u.uGridColor.value.getHexString() };
  fGrid.add(gridState, 'opacity', 0, 1, 0.01).name('不透明度').onChange((v: number) => app.setGridOpacity(v));
  fGrid.add(u.uLineWidth, 'value', 0.005, 0.1, 0.001).name('線幅');
  fGrid.addColor(gridState, 'color').name('線の色').onChange((v: string) => u.uGridColor.value.set(v));
  fGrid.add(u.uCellOpacity, 'value', 0, 1, 0.01).name('HEX 塗りの濃さ');
  const fPaper = gui.addFolder('羊皮紙風');
  const pe = app.ctx.parchment;
  const pu = pe.uniforms;
  fPaper.add(pe, 'enabled').name('有効');
  fPaper.add(pu.uSaturation, 'value', 0, 1, 0.01).name('彩度');
  fPaper.add(pu.uSepia, 'value', 0, 1, 0.01).name('セピア');
  fPaper.add(pu.uPaper, 'value', 0, 1.5, 0.01).name('紙の地合い');
  fPaper.add(pu.uFade, 'value', 0, 0.5, 0.01).name('色あせ');
  fPaper.add(pu.uOutline, 'value', 0, 1, 0.01).name('輪郭線');
  fPaper.add(pu.uVignette, 'value', 0, 1.5, 0.01).name('周縁の焼け');
  const fCamera = gui.addFolder('カメラ');
  // 中ボタンのドラッグでも変わるので、表示は毎フレーム追う
  const camState = {
    get pitch() {
      return app.ctx.pitch;
    },
    set pitch(v: number) {
      app.ctx.setPitch(v);
    },
  };
  fCamera.add(camState, 'pitch', PITCH_RANGE.min, PITCH_RANGE.max, 1).name('俯角 (度)').listen();
  const fQuality = gui.addFolder('品質');
  fQuality.add(p, 'resolution', 2, 24, 1).name('頂点密度 (/単位)').onFinishChange(regen);
  fQuality.add(p, 'margin', 0, 6, 1).name('外周マージン (HEX)').onFinishChange(regen);
  const fPerf = gui.addFolder('描画負荷');
  fPerf.add(app.ctx, 'fps').name('FPS').decimals(1).disable().listen();
  fPerf.add({ gpu: app.ctx.gpuName }, 'gpu').name('GPU').disable();
  fPerf.add(app.ctx, 'pixelRatio', 0.5, 2, 0.25).name('描画解像度');
  fPerf.add(app.view, 'forestMode', { '板絵（軽い）': 'impostor', '3D モデル': 'mesh' }).name('森の描画');
  fPerf.add(app.view, 'foliagePrepass').name('森の深度プリパス (3D)');
  fPerf
    .add({ dynamic: !app.ctx.staticShadows }, 'dynamic')
    .name('影を毎フレーム更新')
    .onChange((v: boolean) => (app.ctx.staticShadows = !v));
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

  // --- 軽量表示（設定はブラウザに覚えておく） ---
  const liteChk = $<HTMLInputElement>('chk-lite');
  const setLite = (on: boolean) => {
    app.setLite(on);
    liteChk.checked = app.lite;
    syncDisplayChecks();
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    try {
      localStorage.setItem(LITE_KEY, on ? '1' : '0');
    } catch {
      // 保存できなくても表示は切り替わる
    }
  };
  liteChk.addEventListener('change', () => setLite(liteChk.checked));
  try {
    if (localStorage.getItem(LITE_KEY) === '1') setLite(true);
  } catch {
    // 読めなければ通常表示
  }

  // --- キー操作 ---
  window.addEventListener('keydown', (e) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
      return;
    }
    if (typing) return;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) app.redo();
      else app.undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      app.redo();
    } else if (e.key === 'Escape') {
      setTool('select');
    } else if (e.key === '[' || e.key === ']') {
      const step = e.key === ']' ? 1 : -1;
      if (app.tool === 'elevation') {
        eb.radius = Math.min(Math.max(eb.radius + step, 0), 4);
        renderElev();
      } else if (app.tool === 'terrain') {
        tb.radius = Math.min(Math.max(tb.radius + step, 0), 4);
        renderTerrain();
      }
    }
  });

  return {
    async loadInitial() {
      await refreshList();
      const q = new URLSearchParams(location.search);
      const seed = q.get('seed');
      const file = q.get('map') ?? files.find((f) => !f.error)?.file;
      if (seed || !file) {
        if (seed) seedInput.value = seed;
        randomize();
        return;
      }
      await loadStored(file);
    },
  };
}

/** 人工物の名前（城は郭の段も） */
function featureLabel(cell: HexCell): string {
  if (!cell.feature) return '-';
  const name = FEATURE_DEFS[cell.feature].name;
  return cell.feature === 'castle' ? `${name}（郭 ${castleWard(cell)}）` : name;
}

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

function clampInt(v: string, min: number, max: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : min;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
