import { FEATURE_DEFS } from '@norden/map-runtime/core/features';
import { MapParseError, parseMapData, type HexCell, type MapData } from '@norden/map-runtime/core/mapData';
import { TERRAIN_DEFS } from '@norden/map-runtime/core/terrainTypes';
import { TEAM_DEFS, UNIT_DEFS, type UnitData } from '@norden/map-runtime/core/units';
import { listMapFiles, loadMapFile, type MapFileInfo } from '@norden/map-runtime/mapFiles';
import type { ForestMode } from '@norden/map-runtime/render/foliage';
import { DEFAULT_PIXEL_RATIO } from '@norden/map-runtime/render/scene';
import type { BattleApp } from './app';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function setupUI(app: BattleApp): { loadInitial(): Promise<void> } {
  const status = $('status');
  const setStatus = (html: string) => (status.innerHTML = html);
  const idleStatus = 'クリック: ユニットを選択 / Esc: 選択を外す';
  const showError = (e: unknown) => {
    const msg = e instanceof MapParseError ? `マップの読み込みに失敗: ${e.message}` : String(e);
    setStatus(`<span class="err">${escapeHtml(msg)}</span>`);
    console.error(e);
  };

  // --- マップ（map-editor が assets/maps/ に保存したもの） ---
  const mapSel = $<HTMLSelectElement>('map-select');
  let files: MapFileInfo[] = [];
  /** assets/maps/ から開いたファイル名。ローカルから開いたときは null */
  let currentFile: string | null = null;

  const refreshList = async () => {
    try {
      files = await listMapFiles();
    } catch (e) {
      files = [];
      showError(e);
    }
    mapSel.replaceChildren(new Option('（選択）', ''));
    for (const f of files) {
      const label = f.error ? `${f.file}（読めません）` : `${f.name} — ${f.file} (${f.grid!.orientation} ${f.grid!.cols}×${f.grid!.rows})`;
      const opt = new Option(label, f.file);
      opt.disabled = !!f.error;
      mapSel.add(opt);
    }
    mapSel.value = currentFile && files.some((f) => f.file === currentFile) ? currentFile : '';
  };

  const load = (data: MapData, file: string | null, label = file) => {
    app.loadMap(data);
    currentFile = file;
    mapSel.value = file && files.some((f) => f.file === file) ? file : '';
    $('map-title').textContent = `${label ?? '-'} — ${data.name} — ${data.grid.orientation} ${data.grid.cols}×${data.grid.rows}`;
    setStatus(`左ドラッグ: 移動 / ホイール: ズーム / ${idleStatus}`);
  };

  const loadStored = async (file: string) => {
    try {
      load(await loadMapFile(file), file);
    } catch (e) {
      showError(e);
    }
  };

  const loadJsonText = (text: string, fileName: string) => {
    try {
      load(parseMapData(JSON.parse(text)), null, `${fileName}（ローカル）`);
    } catch (e) {
      showError(e);
    }
  };

  mapSel.addEventListener('change', () => {
    if (mapSel.value) void loadStored(mapSel.value);
  });
  $('btn-map-list').addEventListener('click', () => void refreshList());

  const fileInput = $<HTMLInputElement>('file-input');
  $('btn-open').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (f) loadJsonText(await f.text(), f.name);
    fileInput.value = '';
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

  // --- 描画負荷 ---
  const ratioSel = $<HTMLSelectElement>('pixel-ratio');
  const ratios = [...new Set([DEFAULT_PIXEL_RATIO, 2, 1.5, 1, 0.75, 0.5])].sort((a, b) => b - a);
  for (const r of ratios) ratioSel.add(new Option(`× ${r}${r === DEFAULT_PIXEL_RATIO ? '（既定）' : ''}`, String(r)));
  ratioSel.value = String(app.ctx.pixelRatio);
  ratioSel.addEventListener('change', () => (app.ctx.pixelRatio = Number(ratioSel.value)));
  const forestSel = $<HTMLSelectElement>('forest-mode');
  forestSel.value = app.view.forestMode;
  forestSel.addEventListener('change', () => (app.view.forestMode = forestSel.value as ForestMode));
  $('gpu-name').textContent = `GPU: ${app.ctx.gpuName}`;
  const prepass = $<HTMLInputElement>('chk-prepass');
  prepass.checked = app.view.foliagePrepass;
  prepass.addEventListener('change', () => (app.view.foliagePrepass = prepass.checked));
  const dynShadows = $<HTMLInputElement>('chk-dynamic-shadows');
  dynShadows.checked = !app.ctx.staticShadows;
  dynShadows.addEventListener('change', () => (app.ctx.staticShadows = !dynShadows.checked));
  const fps = $<HTMLOutputElement>('fps');
  setInterval(() => (fps.textContent = app.ctx.fps.toFixed(1)), 500);

  // --- HEX 情報 ---
  const renderInfo = (el: HTMLElement, cell: HexCell | null, unit: UnitData | null, extra: string[][] = []) => {
    if (!cell) {
      el.innerHTML = '<dt>-</dt><dd></dd>';
      return;
    }
    el.innerHTML = [
      ['座標', `(${cell.col}, ${cell.row})`],
      ['地形', TERRAIN_DEFS[cell.terrain].name],
      ['標高', `Lv ${cell.elevation}`],
      ['人工物', cell.feature ? FEATURE_DEFS[cell.feature].name : '-'],
      ['街道', cell.roads ? `${cell.roads.length} 方向` : '-'],
      ['ユニット', unit ? `${TEAM_DEFS[unit.team].name} ${UNIT_DEFS[unit.type].name}` : '-'],
      ...extra,
    ]
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
      .join('');
  };
  app.onHover = (c, u) => {
    // 移動先を選んでいる間は、そこまでに使う行動力も出す
    const step = app.moveStepAt(c);
    renderInfo($('hover-info'), c, u, step ? [['移動', `行動力 ${step.cost}`]] : []);
  };
  app.onSelect = (c, u) => renderInfo($('select-info'), c, u);
  const unitLabel = (u: UnitData) => `${TEAM_DEFS[u.team].name} ${UNIT_DEFS[u.type].name} (${u.col}, ${u.row})`;
  app.onAction = (u, a) =>
    setStatus(
      a.id === 'move'
        ? `${unitLabel(u)}: 移動先を選んでください（青い HEX）/ Esc・範囲外クリック: メニューに戻る`
        : // 移動以外の処理はまだ無いので、選んだものを知らせるだけ
          `${unitLabel(u)}: 「${escapeHtml(a.name)}」を選択（行動力 ${a.cost}）— 未実装`,
    );
  // 移動の予約はまだ無いので、選んだ移動先を知らせるだけ
  app.onMoveTarget = (u, step) =>
    setStatus(`${unitLabel(u)}: (${step.col}, ${step.row}) へ移動（行動力 ${step.cost}）— ほかの HEX で選び直し / 予約は未実装`);
  app.onMoveCancel = () => setStatus(idleStatus);
  renderInfo($('hover-info'), null, null);
  renderInfo($('select-info'), null, null);

  return {
    async loadInitial() {
      await refreshList();
      const file = new URLSearchParams(location.search).get('map') ?? files.find((f) => !f.error)?.file;
      if (file) await loadStored(file);
      else setStatus('<span class="err">assets/maps/ にマップがありません。map-editor で保存してください</span>');
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
