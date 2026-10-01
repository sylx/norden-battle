import { FEATURE_DEFS } from '@norden/map-runtime/core/features';
import { MapParseError, parseMapData, type HexCell, type MapData } from '@norden/map-runtime/core/mapData';
import { TERRAIN_DEFS } from '@norden/map-runtime/core/terrainTypes';
import { TEAM_DEFS, UNIT_DEFS, type UnitData } from '@norden/map-runtime/core/units';
import { listMapFiles, loadMapFile, type MapFileInfo } from '@norden/map-runtime/mapFiles';
import type { ForestMode } from '@norden/map-runtime/render/foliage';
import { DEFAULT_PIXEL_RATIO } from '@norden/map-runtime/render/scene';
import { BattleApp } from './app';
import { BattleLog } from './battleLog';
import { COMBAT_DEFS, isAttack } from './combat';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function setupUI(app: BattleApp): { loadInitial(): Promise<void> } {
  const status = $('status');
  const setStatus = (html: string) => (status.innerHTML = html);
  const idleStatus = 'クリック: ユニットを選択 / Esc: 予約を 1 つ戻す・選択を外す';
  const showError = (e: unknown) => {
    const msg = e instanceof MapParseError ? `マップの読み込みに失敗: ${e.message}` : String(e);
    setStatus(`<span class="err">${escapeHtml(msg)}</span>`);
    console.error(e);
  };

  const log = new BattleLog(document.body);

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
    log.clear();
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
      ...commander(unit),
      ...extra,
    ]
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
      .join('');
  };
  /** 兵数・士気と指揮官の能力 */
  const commander = (unit: UnitData | null): string[][] => {
    const s = unit && app.statuses.get(unit);
    if (!s) return [];
    return [
      ['兵数', `${s.soldiers} / ${s.maxSoldiers}`],
      ['士気', String(s.morale)],
      ['指揮官', `統率 ${s.leadership} / 武力 ${s.strength}`],
      ...(s.intercepting ? [['状態', COMBAT_DEFS[unit.type].ranged ? '迎撃の構え（射程に入った敵を 1 回撃つ）' : '迎撃の構え（被ダメージ減・反撃増）']] : []),
    ];
  };
  app.onHover = (c, u) => {
    // 移動先を選んでいる間はそこまでに使う行動力、攻撃の相手を選んでいる間は結果の予測も出す
    const extra: string[][] = [];
    const step = app.moveStepAt(c);
    if (step) extra.push(['移動', `行動力 ${step.cost}（予約の合計）${step.zoc ? '<br>敵の ZOC: 入るとそれ以上動けない' : ''}`]);
    const f = app.attackPreviewAt(c);
    if (f && 'rejected' in f) extra.push(['攻撃', `<span class="err">${escapeHtml(f.rejected)}</span>`]);
    else if (f) {
      const { direct, encircled, supporters, morale } = f.expected;
      extra.push([
        '攻撃',
        (supporters > 0 ? `一斉攻撃: 味方 ${supporters} 隊が加わる<br>` : '') +
          `敵 ${range(f.damage)}${encircled ? '（包囲 ×1.2）' : ''}<br>` +
          (direct ? `反撃 ${range(f.counter)}` : '反撃なし') +
          `<br>士気 ${signed(morale.attacker)} / 敵の士気 ${signed(morale.defender)}（目安）`,
      ]);
    }
    renderInfo($('hover-info'), c, u, extra);
  };
  app.onSelect = (c, u) => renderInfo($('select-info'), c, u);
  const unitLabel = (u: UnitData) => `${TEAM_DEFS[u.team].name} ${UNIT_DEFS[u.type].name} (${u.col}, ${u.row})`;
  const back = 'Esc・範囲外クリック: メニューに戻る';
  app.onAction = (u, a) =>
    setStatus(
      a.id === 'move'
        ? `${unitLabel(u)}: 移動先を選んでください（青い HEX。橙の斜線は敵の ZOC で、入るとそれ以上動けない）/ ${back}`
        : a.id === 'volley'
          ? `${unitLabel(u)}: ${escapeHtml(a.name)}の相手を選んでください（金の斜線: ほかの味方とも接している敵）/ ${back}`
          : isAttack(a.id)
          ? `${unitLabel(u)}: ${escapeHtml(a.name)}の相手を選んでください（赤い HEX）/ ${back}`
          : // 移動・攻撃以外の処理はまだ無いので、選んだものを知らせるだけ
            `${unitLabel(u)}: 「${escapeHtml(a.name)}」を選択${a.cost !== undefined ? `（行動力 ${a.cost}）` : ''}— 未実装`,
    );
  app.onPlanChange = (plan) => {
    // 攻撃の前の移動 → 攻撃 → 攻撃の後の移動（騎兵）の順に並べる
    const split = plan.attack?.afterLeg ?? plan.legs.length;
    const moves = (legs: typeof plan.legs) => {
      const last = legs.at(-1);
      return last && `(${last.col}, ${last.row}) まで移動（${legs.length} 回）`;
    };
    const parts = [
      moves(plan.legs.slice(0, split)),
      plan.attack &&
        `${unitLabel(plan.attack.target)} に${escapeHtml(plan.attack.action.name)}` +
          (plan.attack.landing ? `（(${plan.attack.landing.col}, ${plan.attack.landing.row}) へ突破）` : plan.attack.action.id === 'charge' ? '（突破できない）' : ''),
      moves(plan.legs.slice(split)),
    ].filter(Boolean);
    setStatus(
      parts.length > 0
        ? `${unitLabel(plan.unit)}: ${parts.join(' → ')} を予約（行動力 ${BattleApp.planCost(plan)}）/ 決定: 実行 / 取消: すべて取り消す / Esc: 1 つ戻す`
        : `${unitLabel(plan.unit)}: 予約を取り消しました / ${idleStatus}`,
    );
  };
  app.onTargetCancel = () => setStatus(idleStatus);
  app.onTargetReject = (reason) =>
    setStatus(`<span class="err">${escapeHtml(reason)}</span> — ほかの味方とも接している敵（金の斜線）を選んでください / ${back}`);
  // --- ターン ---
  app.onTurn = (turn) => ($('turn-number').textContent = String(turn));
  $('btn-end-turn').addEventListener('click', () => {
    if (app.endTurn()) setStatus(`ターン ${app.turn} — 全ユニットの行動力が回復しました / ${idleStatus}`);
  });
  const teamUnit = (u: UnitData) => `${TEAM_DEFS[u.team].name} ${UNIT_DEFS[u.type].name}`;
  app.onExecute = ({ unit, from, moveCost, attack, intercepts, lost, intercept }) => {
    const parts: string[] = [];
    if (moveCost > 0) parts.push(`(${from.col}, ${from.row}) から移動（行動力 ${moveCost}）`);
    // 移動の途中で受けた迎撃（攻撃の前の移動・後の移動）
    const logIntercepts = (afterAttack: boolean) => {
      for (const i of intercepts) {
        if (i.afterAttack !== afterAttack) continue;
        const { result } = i;
        log.addAttack({
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
        });
        parts.push(`${teamUnit(i.unit)}の迎撃: -${result.damage}${i.targetLeft <= 0 ? '（壊滅）' : ''}`);
      }
    };
    logIntercepts(false);
    if (attack) {
      const { result } = attack;
      log.addAttack({
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
      parts.push(
        `${TEAM_DEFS[attack.target.team].name} ${UNIT_DEFS[attack.target.type].name}に${escapeHtml(attack.action.name)}: ` +
          `敵 -${result.damage}${attack.targetDestroyed ? '（壊滅）' : ''}${result.encircled ? '（包囲）' : ''}` +
          (result.direct ? ` / 反撃 -${result.counter}${attack.unitDestroyed ? '（壊滅）' : ''}` : '') +
          (attack.landing && !attack.unitDestroyed ? ` → (${attack.landing.col}, ${attack.landing.row}) へ突破` : ''),
      );
    }
    logIntercepts(true);
    if (intercept && !lost) parts.push('迎撃の構えで待機（行動終了）');
    setStatus(`${unitLabel(unit)}: ${parts.join(' → ')}`);
  };
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

/** 兵数の減少の幅（-96〜-144） */
function range([min, max]: readonly [number, number]): string {
  return min === max ? `-${min}` : `-${min}〜-${max}`;
}

/** 符号付きの数（+7・-3・±0） */
function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? String(n) : '±0';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
