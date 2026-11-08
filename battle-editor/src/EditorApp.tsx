/**
 * battle-editor の画面。戦闘画面（@norden/battle-runtime の BattleScreen）の上に、エディタの道具を重ねる。
 *
 * 画面の上のツールバー（エディタの道具。ゲームの画面には出さない）のボタンで道具のウィンドウを開く。
 * - ウィンドウは一度に 1 つだけ開き、押したボタンの下に出す。
 * - 同じボタンか、ウィンドウの × で閉じる。マップを触っても閉じない（描画負荷を見ながら動かせるように）。
 * - マップ: map-editor が assets/maps/ に保存したものを読み込む（ここからは書き換えない）。JSON を開く・ドロップすることもできる。
 *   街道マップ（battleAreas のあるマップ）は戦闘の範囲（防衛する都市）を選んで切り出し、その初期配置地点で配備から始める
 *   （既定は初期配置地点のある最初の範囲）。「最初から」で配備からやり直す。
 * - 部隊: 陣営ごとに、ゲーム（nordencult）の勢力と騎士で編成を組む（gameKnights.ts）。騎士・兵種・兵数・士気・軍団長を選び直せる。
 *   直した編成は「この編成で最初から」で反映する（ブラウザに覚えておき、開き直しても同じ編成で始める）。
 * - ダメージ計算: 攻撃側・防御側の兵種・兵数・士気・能力と状況から、攻撃 1 回のダメージを出す（DamageTool.tsx。戦闘と同じ計算）。
 * - 描画負荷: FPS・解像度・森の描き方・深度プリパス・影の更新。
 * - セリフ: 喋る場面で必ず喋らせる（確率を無視）・選択中か調べているユニットに場面ごとのセリフを言わせる。
 *   ゲームのセリフのデータで、部隊を率いる騎士が喋る（gameVoices.ts）。喋る騎士はユニットごとに選び直せる。言ったセリフの記録。
 * - 拠点施設: 陣営ごとに要塞砲・ガンシップ（撃つ間隔）・バリスタ・魔導台を持たせる（すぐ反映。ブラウザに覚えておく）。
 * - 状態: 選択中か調べているユニットに、状態（混乱・凍結・感電）を付け外しし、攻撃をクールタイム中にする（見え方の確認用）。
 * - 退却・捕縛: 軍ごとにダミーの退却先の拠点を渡すかどうか（渡さない軍は退却できない）・退却に失敗する確率と殲滅されて捕縛される確率・
 *   退却と殲滅の結果の記録。
 * 勢力は編成で選んだゲームの勢力。決着のカットインは攻撃側をプレイヤーとして勝利・敗北を出す。決着のウィンドウの「最初から」で、同じマップを読み込み直す。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cropBattleArea } from '@norden/map-runtime/core/battleArea';
import { MapParseError, parseMapData, type MapData } from '@norden/map-runtime/core/mapData';
import { listMapFiles, loadMapFile, type MapFileInfo } from '@norden/map-runtime/mapFiles';
import type { ForestMode } from '@norden/map-runtime/render/foliage';
import { DEFAULT_PIXEL_RATIO } from '@norden/map-runtime/render/scene';
import type { DeploySide } from '@norden/map-runtime/core/mapData';
import { UNIT_DEFS, UNIT_TYPES, type TeamId, type UnitData, type UnitType } from '@norden/map-runtime/core/units';
import {
  BARK_CHANCE,
  BARK_SITUATION_NAMES,
  BARK_SITUATIONS,
  ATTACK_DEFS,
  BattleScreen,
  COMBAT_DEFS,
  CONDITION_DEFS,
  CONDITION_IDS,
  DEFAULT_INTERVALS,
  EXCHANGE_CHANCE,
  FACILITY_NAMES,
  FORTRESS_CANNON_RANGE,
  MAX_DEPLOY,
  MAX_MORALE,
  RETREAT_FAIL_CHANCE,
  SIDE_NAMES,
  SPELL_IDS,
  teamName,
  WIPEOUT_CAPTURE_CHANCE,
  type BattleApp,
  type BattleFacilities,
  type BattleFactions,
  type Portrait,
  type RetreatDestination,
  type SideFacilities,
  type RetreatDestinations,
  type RetreatReport,
  type WipeoutReport,
} from '@norden/battle-runtime';
import {
  canLead,
  DEFAULT_ROSTERS,
  defaultRoster,
  defaultSoldiers,
  entryFor,
  factionKnights,
  GAME_FACTIONS,
  GAME_KNIGHTS,
  KNIGHT_GROUPS,
  knightById,
  knightLabel,
  NO_FACTION,
  parseRosters,
  placedUnits,
  portraitOf,
  ROSTER_SIZE,
  rosterFactions,
  rosterStatuses,
  rosterTroops,
  type Rosters,
  type SideRoster,
} from './gameKnights';
import { gameBarks, knightCast } from './gameVoices';
import DamageTool from './DamageTool';

/** 画面の端・ツールバーとの間（CSS ピクセル） */
const MARGIN = 12;
const GAP = 6;

type Tool = 'map' | 'troops' | 'damage' | 'facility' | 'perf' | 'bark' | 'status' | 'retreat';

const TOOLS: Record<Tool, string> = {
  map: 'マップ',
  troops: '部隊',
  damage: 'ダメージ計算',
  facility: '拠点施設',
  perf: '描画負荷',
  bark: 'セリフ',
  status: '状態',
  retreat: '退却・捕縛',
};

/** 陣営ごとの拠点の施設を覚えておく localStorage のキー */
const FACILITIES_KEY = 'battle-editor.facilities';

function loadFacilities(): SideFacilities {
  try {
    const v = JSON.parse(localStorage.getItem(FACILITIES_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as SideFacilities) : {};
  } catch {
    return {};
  }
}
/** 幅の広いウィンドウの道具 */
const WIDE_TOOLS: ReadonlySet<Tool> = new Set(['troops', 'damage']);

/** 反映した編成を覚えておく localStorage のキー */
const ROSTERS_KEY = 'battle-editor.rosters';

function loadRosters(): Rosters {
  try {
    const text = localStorage.getItem(ROSTERS_KEY);
    return (text && parseRosters(JSON.parse(text))) || DEFAULT_ROSTERS;
  } catch {
    return DEFAULT_ROSTERS;
  }
}

function saveRosters(rosters: Rosters): void {
  try {
    localStorage.setItem(ROSTERS_KEY, JSON.stringify(rosters));
  } catch {
    // 覚えられなくても、この画面の間は使える
  }
}

/** 表示確認用のダミーの退却先の拠点（ゲームでは戦場の拠点に街道でつながる自勢力の拠点を渡す） */
const DUMMY_RETREATS: Record<'red' | 'blue', readonly RetreatDestination[]> = {
  red: [
    { id: 'dummy-north-fort', name: '北の砦（ダミー）' },
    { id: 'dummy-east-town', name: '東の町（ダミー）' },
  ],
  blue: [{ id: 'dummy-west-castle', name: '西の城（ダミー）' }],
};
const DUMMY_TEAMS = Object.keys(DUMMY_RETREATS) as (keyof typeof DUMMY_RETREATS)[];

export default function EditorApp() {
  const [app, setApp] = useState<BattleApp | null>(null);
  /** 読み込んだマップ（切り出す前） */
  const [source, setSource] = useState<{ data: MapData; label: string } | null>(null);
  /** 切り出す戦闘の範囲（防衛する都市の ID。null は切り出さない） */
  const [area, setArea] = useState<string | null>(null);
  /** 「最初から」で増やす（同じマップでも作り直して読み込み直す） */
  const [restart, setRestart] = useState(0);
  const [notice, setNotice] = useState<ReactNode>(null);
  const [files, setFiles] = useState<MapFileInfo[]>([]);
  /** assets/maps/ から開いたファイル名。ローカルから開いたときは null */
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [dragging, setDragging] = useState(false);
  /** ダミーの退却先の拠点を渡す軍 */
  const [retreatTeams, setRetreatTeams] = useState<ReadonlySet<TeamId>>(() => new Set(DUMMY_TEAMS));
  const retreats = useMemo(
    (): RetreatDestinations => Object.fromEntries(DUMMY_TEAMS.filter((t) => retreatTeams.has(t)).map((t) => [t, DUMMY_RETREATS[t]])),
    [retreatTeams],
  );
  /** 戦闘に使っている編成（「この編成で最初から」で反映したもの）と、部隊の道具で直している編成 */
  const [rosters, setRosters] = useState<Rosters>(loadRosters);
  const [draft, setDraft] = useState<Rosters>(rosters);
  const troops = useMemo(() => rosterTroops(rosters), [rosters]);
  const statuses = useMemo(() => rosterStatuses(rosters), [rosters]);
  const factions = useMemo(() => rosterFactions(rosters), [rosters]);
  /** 陣営ごとの拠点の施設（すぐ反映する） */
  const [facilities, setFacilities] = useState<SideFacilities>(loadFacilities);
  const changeFacilities = (next: SideFacilities) => {
    setFacilities(next);
    try {
      localStorage.setItem(FACILITIES_KEY, JSON.stringify(next));
    } catch {
      // 覚えられなくても、この画面の間は使える
    }
  };
  const applyRosters = () => {
    setRosters(draft);
    saveRosters(draft);
    setRestart((n) => n + 1);
  };

  const showError = (e: unknown) => {
    const msg = e instanceof MapParseError ? `マップの読み込みに失敗: ${e.message}` : String(e);
    setNotice(<span className="err">{msg}</span>);
    console.error(e);
  };

  const refreshList = async (): Promise<MapFileInfo[]> => {
    try {
      const list = await listMapFiles();
      setFiles(list);
      return list;
    } catch (e) {
      setFiles([]);
      showError(e);
      return [];
    }
  };

  const load = (data: MapData, file: string | null, label = file) => {
    const areas = Object.keys(data.battleAreas ?? {});
    setSource({ data, label: label ?? '-' });
    setArea(areas.find((city) => data.deployments?.[city]) ?? null);
    setCurrentFile(file);
    setNotice(null);
  };

  // 戦闘の範囲を切り出したマップ（切り出せなければその理由）
  const { map, cropError } = useMemo((): { map: MapData | null; cropError?: string } => {
    if (!source) return { map: null };
    try {
      return { map: area ? cropBattleArea(source.data, area) : { ...source.data } };
    } catch (e) {
      return { map: null, cropError: e instanceof Error ? e.message : String(e) };
    }
  }, [source, area, restart]);

  const title = source
    ? `${source.label} — ${source.data.name}${area ? ` — ${area} の範囲` : ''} — ${source.data.grid.orientation} ${map?.grid.cols ?? source.data.grid.cols}×${map?.grid.rows ?? source.data.grid.rows}`
    : '-';

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

  // 最初に開くマップ（?map=ファイル名、無ければ一覧の先頭）
  useEffect(() => {
    void (async () => {
      const list = await refreshList();
      const file = new URLSearchParams(location.search).get('map') ?? list.find((f) => !f.error)?.file;
      if (file) await loadStored(file);
      else setNotice(<span className="err">assets/maps/ にマップがありません。map-editor で保存してください</span>);
    })();
  }, []);

  // JSON ファイルのドロップ
  useEffect(() => {
    const over = (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const drop = async (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer?.files[0];
      if (f) loadJsonText(await f.text(), f.name);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return (
    <BattleScreen
      map={map}
      notice={notice ?? (cropError && <span className="err">戦闘の範囲を切り出せません: {cropError}</span>)}
      barks={gameBarks}
      troops={troops}
      statuses={statuses}
      factions={factions}
      retreats={retreats}
      facilities={facilities}
      onEnd={() => setRestart((n) => n + 1)}
      endLabel="最初から"
      // 両軍を操作するが、決着のカットイン（勝利・敗北）は攻撃側をプレイヤーとして出す
      playerSide="attacker"
      onApp={setApp}
      className="editor-screen"
    >
      <Toolbar
        tool={tool}
        onTool={setTool}
        title={title}
        windows={{
          map: (
            <MapTool
              files={files}
              currentFile={currentFile}
              source={source?.data ?? null}
              area={area}
              onArea={setArea}
              onRestart={() => setRestart((n) => n + 1)}
              onSelect={(file) => void loadStored(file)}
              onRefresh={() => void refreshList()}
              onOpen={(f) => void f.text().then((text) => loadJsonText(text, f.name))}
            />
          ),
          troops: <TroopsTool draft={draft} onDraft={setDraft} dirty={draft !== rosters} onApply={applyRosters} placed={map?.units ?? []} />,
          damage: <DamageTool />,
          facility: <FacilityTool facilities={facilities} factions={factions} onChange={changeFacilities} />,
          perf: app && <PerfTool app={app} />,
          bark: app && <BarkTool app={app} />,
          status: app && <StatusTool app={app} factions={factions} />,
          retreat: app && <RetreatTool app={app} factions={factions} teams={retreatTeams} onTeams={setRetreatTeams} />,
        }}
      />
      {dragging && <div className="drop-hint">ここにドロップして開く</div>}
    </BattleScreen>
  );
}

/**
 * ツールバーと道具のウィンドウ。tool のウィンドウだけを、そのボタンの下に開く。
 * 閉じたウィンドウも中身は残す（hidden にするだけ）
 */
function Toolbar({
  tool,
  onTool,
  title,
  windows,
}: {
  tool: Tool | null;
  onTool: (t: Tool | null) => void;
  title: string;
  windows: Record<Tool, ReactNode>;
}) {
  const barRef = useRef<HTMLElement>(null);
  const buttons = useRef<Partial<Record<Tool, HTMLButtonElement | null>>>({});
  const winRefs = useRef<Partial<Record<Tool, HTMLElement | null>>>({});
  const [pos, setPos] = useState({ left: MARGIN, top: 56 });
  const ids = Object.keys(TOOLS) as Tool[];

  useLayoutEffect(() => {
    const button = tool && buttons.current[tool];
    const win = tool && winRefs.current[tool];
    const bar = barRef.current;
    if (!button || !win || !bar) return;
    const left = button.getBoundingClientRect().left;
    setPos({
      left: Math.max(MARGIN, Math.min(left, window.innerWidth - MARGIN - win.offsetWidth)),
      top: bar.getBoundingClientRect().bottom + GAP,
    });
  }, [tool]);

  return (
    <>
      <nav ref={barRef} className="editor-toolbar">
        <h1>Norden Battle Editor</h1>
        {ids.map((id) => (
          <button
            key={id}
            ref={(el) => void (buttons.current[id] = el)}
            className={`tool${tool === id ? ' active' : ''}`}
            aria-expanded={tool === id}
            onClick={() => onTool(tool === id ? null : id)}
          >
            {TOOLS[id]}
          </button>
        ))}
        <span className="sub">{title}</span>
      </nav>
      {ids.map((id) => (
        <section
          key={id}
          ref={(el) => void (winRefs.current[id] = el)}
          className={`tool-window${WIDE_TOOLS.has(id) ? ' wide' : ''}`}
          hidden={tool !== id}
          style={pos}
        >
          <header>
            <h2>{TOOLS[id]}</h2>
            <button className="close" title="閉じる" onClick={() => onTool(null)}>
              ×
            </button>
          </header>
          {windows[id]}
        </section>
      ))}
    </>
  );
}

function MapTool({
  files,
  currentFile,
  source,
  area,
  onArea,
  onRestart,
  onSelect,
  onRefresh,
  onOpen,
}: {
  files: MapFileInfo[];
  currentFile: string | null;
  /** 読み込んだマップ（切り出す前） */
  source: MapData | null;
  area: string | null;
  onArea: (city: string | null) => void;
  onRestart: () => void;
  onSelect: (file: string) => void;
  onRefresh: () => void;
  onOpen: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const value = currentFile && files.some((f) => f.file === currentFile) ? currentFile : '';
  const areas = Object.keys(source?.battleAreas ?? {});
  return (
    <>
      <label className="row">
        <span>保存済み</span>
        <select value={value} onChange={(e) => e.target.value && onSelect(e.target.value)}>
          <option value="">（選択）</option>
          {files.map((f) => (
            <option key={f.file} value={f.file} disabled={!!f.error}>
              {f.error ? `${f.file}（読めません）` : `${f.name} — ${f.file} (${f.grid!.orientation} ${f.grid!.cols}×${f.grid!.rows})`}
            </option>
          ))}
        </select>
      </label>
      {areas.length > 0 && (
        <label className="row">
          <span>戦闘の範囲</span>
          <select value={area ?? ''} onChange={(e) => onArea(e.target.value || null)}>
            <option value="">全体（切り出さない）</option>
            {areas.map((city) => (
              <option key={city} value={city}>
                {city} の範囲{source?.deployments?.[city] ? '（初期配置地点あり）' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="buttons">
        <button onClick={onRefresh}>一覧を更新</button>
        <button onClick={() => inputRef.current?.click()}>JSON を開く</button>
        <button onClick={onRestart} disabled={!source} title="同じマップを読み込み直して、配備からやり直す">
          最初から
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onOpen(f);
          e.target.value = '';
        }}
      />
      <p className="hint">map-editor で保存したマップ（assets/maps/）を読み込みます。JSON ファイルをドロップしても開けます</p>
      <p className="hint">街道マップは戦闘の範囲を切り出し、その初期配置地点に部隊を置く配備から始めます</p>
    </>
  );
}

function PerfTool({ app }: { app: BattleApp }) {
  const ratios = [...new Set([DEFAULT_PIXEL_RATIO, 2, 1.5, 1, 0.75, 0.5])].sort((a, b) => b - a);
  const [ratio, setRatio] = useState(app.ctx.pixelRatio);
  const [forest, setForest] = useState<ForestMode>(app.view.forestMode);
  const [prepass, setPrepass] = useState(app.view.foliagePrepass);
  const [dynamicShadows, setDynamicShadows] = useState(!app.ctx.staticShadows);
  const [fps, setFps] = useState('-');

  useEffect(() => {
    const id = setInterval(() => setFps(app.ctx.fps.toFixed(1)), 500);
    return () => clearInterval(id);
  }, [app]);

  return (
    <>
      <label className="row">
        <span>FPS</span>
        <output>{fps}</output>
      </label>
      <label className="row">
        <span>解像度</span>
        <select
          value={String(ratio)}
          onChange={(e) => {
            const r = Number(e.target.value);
            app.ctx.pixelRatio = r;
            setRatio(r);
          }}
        >
          {ratios.map((r) => (
            <option key={r} value={String(r)}>
              × {r}
              {r === DEFAULT_PIXEL_RATIO ? '（既定）' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="row">
        <span>森</span>
        <select
          value={forest}
          onChange={(e) => {
            const mode = e.target.value as ForestMode;
            app.view.forestMode = mode;
            setForest(mode);
          }}
        >
          <option value="impostor">板絵（軽い）</option>
          <option value="mesh">3D モデル</option>
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={prepass}
          onChange={(e) => {
            app.view.foliagePrepass = e.target.checked;
            setPrepass(e.target.checked);
          }}
        />{' '}
        森の深度プリパス（3D のとき）
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={dynamicShadows}
          onChange={(e) => {
            app.ctx.staticShadows = !e.target.checked;
            setDynamicShadows(e.target.checked);
          }}
        />{' '}
        影を毎フレーム更新
      </label>
      <p className="hint">重いときは解像度を下げてください。深度プリパス・影はオフ/オンで負荷を比べる用です</p>
      <p className="hint">GPU: {app.ctx.gpuName}</p>
    </>
  );
}

/** セリフの記録に残す数 */
const BARK_LOG_SIZE = 6;

function BarkTool({ app }: { app: BattleApp }) {
  const cast = knightCast;
  const [always, setAlways] = useState(app.alwaysBark);
  const [result, setResult] = useState('');
  /** 選択中か調べているユニット */
  const [unit, setUnit] = useState<UnitData | null>(app.plan?.unit ?? app.inspected);
  /** 割り当てを変えたら増やす（cast は React の外にあるので、描き直すきっかけ） */
  const [, setCastVersion] = useState(0);
  const [log, setLog] = useState<{ id: number; who: string; situation: string; text: string }[]>([]);
  useEffect(() => {
    let id = 0;
    const offs = [
      app.on('select', setUnit),
      app.on('bark', (u, situation, text) => {
        const who = cast.get(u, app.statuses.get(u))?.name ?? '';
        setLog((list) => [{ id: id++, who, situation: BARK_SITUATION_NAMES[situation], text }, ...list].slice(0, BARK_LOG_SIZE));
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [app, cast]);
  const knight = unit && cast.get(unit, app.statuses.get(unit));
  const test = (situation: Parameters<BattleApp['testBark']>[0]) =>
    setResult(app.testBark(situation) ? '' : '言わせられません（ユニットを選ぶか相手方のユニットをクリックしてから。掛け合いは味方がもう 1 部隊要る）');
  const percent = (p: number) => (p < 1 ? `${Math.round(p * 100)}%` : '必ず');
  return (
    <>
      <label className="check">
        <input
          type="checkbox"
          checked={always}
          onChange={(e) => {
            app.alwaysBark = e.target.checked;
            setAlways(e.target.checked);
          }}
        />{' '}
        必ず喋る（確率を無視）
      </label>
      <p className="hint">ゲームのセリフのデータで、部隊を率いる騎士が喋る。喋る騎士はユニットごとに選び直せる</p>
      {unit && knight ? (
        <label className="row">
          <span>喋る騎士</span>
          <select
            value={knight.id}
            onChange={(e) => {
              const k = cast.knights.find((c) => c.id === e.target.value);
              if (k) cast.set(unit, k);
              setCastVersion((v) => v + 1);
            }}
          >
            {cast.knights.map((k) => (
              <option key={k.id} value={k.id}>
                {k.id} {k.name}
                {k.voiceTone ? '' : '（口調なし）'}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="hint">ユニットを選ぶと、喋る騎士を選べます</p>
      )}
      <p className="hint">選択中・調べているユニットに言わせる（相手はいちばん近い敵）</p>
      <div className="buttons">
        {BARK_SITUATIONS.map((s) => (
          <button key={s} onClick={() => test(s)} title={`戦闘では ${percent(BARK_CHANCE[s])}`}>
            {BARK_SITUATION_NAMES[s]}
          </button>
        ))}
        <button onClick={() => test('exchange')} title={`戦闘では ${percent(EXCHANGE_CHANCE)}。いちばん近い味方 2 部隊と`}>
          {BARK_SITUATION_NAMES.exchange}
        </button>
      </div>
      {result && <p className="hint">{result}</p>}
      {log.length > 0 && (
        <ul className="bark-log">
          {log.map((l) => (
            <li key={l.id}>
              <span className="bark-log__who">
                {l.who && `${l.who}・`}
                {l.situation}
              </span>
              {l.text}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** 退却・殲滅の記録に残す数 */
const RETREAT_LOG_SIZE = 8;

/** 退却・殲滅の記録 1 件 */
type LossLog = ({ kind: 'retreat' } & RetreatReport) | ({ kind: 'wipeout' } & WipeoutReport);

function RetreatTool({
  app,
  factions,
  teams,
  onTeams,
}: {
  app: BattleApp;
  factions: BattleFactions;
  teams: ReadonlySet<TeamId>;
  onTeams: (teams: ReadonlySet<TeamId>) => void;
}) {
  const [log, setLog] = useState<readonly LossLog[]>([]);
  useEffect(() => {
    const add = (entry: LossLog) => setLog((list) => [entry, ...list].slice(0, RETREAT_LOG_SIZE));
    const offs = [
      app.on('load', () => setLog([])),
      app.on('retreat', (report) => add({ kind: 'retreat', ...report })),
      app.on('wipeout', (report) => add({ kind: 'wipeout', ...report })),
    ];
    return () => offs.forEach((off) => off());
  }, [app]);
  const toggle = (team: TeamId, on: boolean) => {
    const next = new Set(teams);
    if (on) next.add(team);
    else next.delete(team);
    onTeams(next);
  };
  const percent = (p: number) => `${Math.round(p * 100)}%`;
  const table = (chances: readonly number[]) =>
    chances.map((p, n) => `${n}${n === chances.length - 1 ? ' 以上' : ''} ${percent(p)}`).join(' / ');
  return (
    <>
      <p className="hint">ダミーの退却先の拠点を渡す軍（渡さない軍は退却を選べない）。メニューを開き直すと反映される</p>
      {DUMMY_TEAMS.map((team) => (
        <label key={team} className="check">
          <input type="checkbox" checked={teams.has(team)} onChange={(e) => toggle(team, e.target.checked)} /> {teamName(factions, team)}:{' '}
          {DUMMY_RETREATS[team].map((d) => d.name).join('・')}
        </label>
      ))}
      <p className="hint">退却に失敗する確率（隣接する敵の数）: {table(RETREAT_FAIL_CHANCE)}。失敗すると捕虜になる</p>
      <p className="hint">殲滅されて指揮官が捕縛される確率（隣接する敵の数）: {table(WIPEOUT_CAPTURE_CHANCE)}。捕縛されなければ最初の退却先へ落ち延びる（無ければ在野）</p>
      {log.length > 0 && (
        <ul className="bark-log">
          {log.map((r, i) => (
            <li key={i}>
              <span className="bark-log__who">
                第 {r.turn} ターン {teamName(factions, r.unit.team)} {UNIT_DEFS[r.unit.type].name}
                {r.troopId ? `（${r.troopId}）` : ''}・{r.kind === 'retreat' ? '失敗' : '捕縛'} {percent(r.kind === 'retreat' ? r.failChance : r.captureChance)}（敵{' '}
                {r.enemies}）
              </span>
              {r.kind === 'retreat'
                ? r.captured
                  ? `${r.to.name}への退却に失敗し、捕虜になった`
                  : `${r.to.name}へ退却した`
                : r.captured
                  ? '殲滅され、指揮官が捕縛された'
                  : r.to
                    ? `殲滅されたが、指揮官は${r.to.name}へ落ち延びた`
                    : '殲滅されたが、指揮官は落ち延びた（退却先が無く在野に）'}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** 編成の道具の顔の大きさ（CSS ピクセル） */
const FACE_PX = 24;

/** 騎士の顔（スプライトシートから切り出して円に収める） */
function Face({ portrait }: { portrait: Portrait }) {
  const scale = FACE_PX / portrait.rect.width;
  return (
    <span
      className="roster-face"
      style={{
        backgroundImage: `url(${portrait.url})`,
        backgroundSize: `${portrait.width * scale}px ${portrait.height * scale}px`,
        backgroundPosition: `${-portrait.rect.x * scale}px ${-portrait.rect.y * scale}px`,
      }}
    />
  );
}

const SIDES: readonly DeploySide[] = ['attacker', 'defender'];

function TroopsTool({
  draft,
  onDraft,
  dirty,
  onApply,
  placed,
}: {
  draft: Rosters;
  onDraft: (r: Rosters) => void;
  dirty: boolean;
  onApply: () => void;
  /** マップに置いてあるユニット（編成の行が上から順に割り当たり、兵種はマップの方になる） */
  placed: readonly UnitData[];
}) {
  const [side, setSide] = useState<DeploySide>('attacker');
  const roster = draft[side];
  const placedTypes = placedUnits(placed, side).map((u) => u.type);
  const setRoster = (r: SideRoster) => onDraft({ ...draft, [side]: r });
  const setEntry = (i: number, patch: Partial<SideRoster['entries'][number]>) =>
    setRoster({ ...roster, entries: roster.entries.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const remove = (i: number) =>
    setRoster({
      ...roster,
      entries: roster.entries.filter((_, j) => j !== i),
      commander: roster.commander > i ? roster.commander - 1 : roster.commander === i ? 0 : roster.commander,
    });
  const add = () => {
    const used = new Set(roster.entries.map((e) => e.knightId));
    const k = factionKnights(roster.factionId).find((c) => !used.has(c.id)) ?? GAME_KNIGHTS.find((c) => !used.has(c.id)) ?? GAME_KNIGHTS[0];
    setRoster({ ...roster, entries: [...roster.entries, entryFor(k)] });
  };
  const num = (v: string, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
  return (
    <>
      <div className="buttons">
        {SIDES.map((s) => (
          <button key={s} className={s === side ? 'active' : ''} onClick={() => setSide(s)}>
            {SIDE_NAMES[s]}
          </button>
        ))}
      </div>
      <label className="row">
        <span>勢力</span>
        <select value={roster.factionId} onChange={(e) => setRoster(defaultRoster(e.target.value))}>
          {[...GAME_FACTIONS, NO_FACTION].map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">勢力を選ぶと、その勢力の騎士で組み直す（当主が先頭、あとは統率の高い順）</p>
      <table className="roster">
        <thead>
          <tr>
            <th title="軍団長">長</th>
            <th />
            <th>騎士</th>
            <th>兵種</th>
            <th>兵数</th>
            <th>士気</th>
            <th>魔法</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {roster.entries.map((e, i) => {
            const k = knightById(e.knightId)!;
            // マップに置いてあるユニットに割り当たる行は、マップのユニットの兵種で戦う
            const mapType = placedTypes[i];
            const type = mapType ?? e.type;
            return (
              <tr key={i}>
                <td>
                  <input type="radio" name={`commander-${side}`} checked={roster.commander === i} onChange={() => setRoster({ ...roster, commander: i })} />
                </td>
                <td>
                  <Face portrait={portraitOf(k)} />
                </td>
                <td>
                  <select
                    value={e.knightId}
                    title={knightLabel(k)}
                    onChange={(ev) => {
                      const next = knightById(ev.target.value);
                      if (next) setEntry(i, entryFor(next));
                    }}
                  >
                    {KNIGHT_GROUPS.map((g) => (
                      <optgroup key={g.name} label={g.name}>
                        {g.knights.map((c) => (
                          <option key={c.id} value={c.id}>
                            {knightLabel(c)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={e.type} onChange={(ev) => setEntry(i, { type: ev.target.value as UnitType, soldiers: defaultSoldiers(ev.target.value as UnitType) })}>
                    {UNIT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {UNIT_DEFS[t].name}
                        {canLead(k, t) ? '' : '（本来は率いない）'}
                      </option>
                    ))}
                  </select>
                  {mapType && mapType !== e.type && <div className="hint">マップでは{UNIT_DEFS[mapType].name}</div>}
                </td>
                <td>
                  <input type="number" className="num" min={1} max={9999} step={10} value={e.soldiers} onChange={(ev) => setEntry(i, { soldiers: num(ev.target.value, 9999) })} />
                </td>
                <td>
                  <input type="number" className="num narrow" min={0} max={MAX_MORALE} value={e.morale} onChange={(ev) => setEntry(i, { morale: num(ev.target.value, MAX_MORALE) })} />
                </td>
                <td>
                  {COMBAT_DEFS[type].magic ? (
                    SPELL_IDS.map((id) => (
                      <label key={id} className="spell">
                        <input
                          type="checkbox"
                          checked={e.spells.includes(id)}
                          onChange={(ev) => setEntry(i, { spells: ev.target.checked ? [...e.spells, id] : e.spells.filter((x) => x !== id) })}
                        />
                        {ATTACK_DEFS[id].name}
                      </label>
                    ))
                  ) : (
                    <span className="none">-</span>
                  )}
                </td>
                <td>
                  <button className="remove" title="外す" onClick={() => remove(i)} disabled={roster.entries.length <= 1}>
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="buttons">
        <button onClick={add} disabled={roster.entries.length >= ROSTER_SIZE * 2}>
          部隊を足す
        </button>
        <button onClick={() => onDraft(DEFAULT_ROSTERS)}>既定に戻す</button>
        <button className={dirty ? 'active' : ''} onClick={onApply}>
          この編成で最初から
        </button>
      </div>
      <p className="hint">
        配備できるのは 1 陣営 {MAX_DEPLOY} 部隊まで（残りは配備のときに入れ替えられる）。直した編成は「この編成で最初から」で反映する
        {dirty ? '（未反映の変更あり）' : ''}
      </p>
      <p className="hint">魔法は魔術師・上級魔術師だけが使う（サンダーフォールは必ず使える。ゲームでは魔導書の装備から渡す）</p>
      <p className="hint">スキルはゲームの騎士にまだ無いので、表示確認用に行の順で仮に配る。マップに置いてあるユニットには、防衛側を赤軍・攻撃側を青軍に上から順に割り当てる（兵種はマップのユニットの兵種になり、魔法の欄もそれに従う）</p>
    </>
  );
}

/** 状態を付けるときのターン数・クールタイムの回数 */
const TEST_TURNS = 2;

function StatusTool({ app, factions }: { app: BattleApp; factions: BattleFactions }) {
  /** 選択中か調べているユニット */
  const [unit, setUnit] = useState<UnitData | null>(app.plan?.unit ?? app.inspected);
  const [, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const offs = [
      app.on('select', setUnit),
      app.on('load', () => setUnit(null)),
      app.on('statusChange', bump),
      app.on('turn', bump),
      app.on('execute', bump),
    ];
    return () => offs.forEach((off) => off());
  }, [app]);
  const status = unit && app.statuses.get(unit);
  if (!unit || !status) return <p className="hint">ユニットを選ぶか、相手方のユニットをクリックしてください</p>;
  return (
    <>
      <p className="hint">
        {app.leaderOf(unit) ?? UNIT_DEFS[unit.type].name}（{teamName(factions, unit.team)}）。状態は付いた軍の番が終わるたびに 1 減り、クールタイムは自分の番が始まるたびに 1 減る
      </p>
      {CONDITION_IDS.map((id) => {
        const c = status.conditions.find((x) => x.id === id);
        return (
          <label key={id} className="row">
            <span>
              {CONDITION_DEFS[id].name}
              {c ? `（あと ${c.turns}）` : ''}
            </span>
            <button onClick={() => app.setCondition(unit, id, TEST_TURNS)}>{TEST_TURNS} ターン付ける</button>
            <button onClick={() => app.setCondition(unit, id, 0)} disabled={!c}>
              外す
            </button>
          </label>
        );
      })}
      <p className="hint">攻撃のクールタイム（行動メニューで灰色になり、あと何ターンかが出る）</p>
      {COMBAT_DEFS[unit.type].attacks.map((id) => (
        <label key={id} className="row">
          <span>
            {ATTACK_DEFS[id].name}
            {status.cooldowns[id] ? `（あと ${status.cooldowns[id]}）` : ''}
          </span>
          <button onClick={() => app.setCooldown(unit, id, TEST_TURNS)}>{TEST_TURNS} ターン待たせる</button>
          <button onClick={() => app.setCooldown(unit, id, 0)} disabled={!status.cooldowns[id]}>
            外す
          </button>
        </label>
      ))}
    </>
  );
}

/** 撃つ施設の間隔の選択肢（ターン） */
const INTERVALS = [1, 2, 3, 4];

function FacilityTool({ facilities, factions, onChange }: { facilities: SideFacilities; factions: BattleFactions; onChange: (f: SideFacilities) => void }) {
  const set = (side: DeploySide, patch: Partial<BattleFacilities>) => {
    const next = { ...facilities[side], ...patch };
    for (const k of Object.keys(next) as (keyof BattleFacilities)[]) if (next[k] === undefined || next[k] === false) delete next[k];
    onChange({ ...facilities, [side]: next });
  };
  return (
    <>
      {SIDES.map((side) => {
        const f = facilities[side] ?? {};
        return (
          <div key={side}>
            <p className="hint">
              {SIDE_NAMES[side]}（{side === 'attacker' ? factions.attacker.name : factions.defender.name}）
            </p>
            {(['fortressCannon', 'gunship'] as const).map((k) => (
              <label key={k} className="row">
                <span>{FACILITY_NAMES[k]}</span>
                <select
                  value={f[k] ? String(f[k].interval) : ''}
                  onChange={(e) => set(side, { [k]: e.target.value ? { interval: Number(e.target.value) } : undefined })}
                >
                  <option value="">なし</option>
                  {INTERVALS.map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? '毎ターン撃つ' : `${n} ターンごと`}
                      {n === DEFAULT_INTERVALS[k] ? '（既定）' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {(['ballista', 'magicTower'] as const).map((k) => (
              <label key={k} className="check">
                <input type="checkbox" checked={!!f[k]} onChange={(e) => set(side, { [k]: e.target.checked || undefined })} /> {FACILITY_NAMES[k]}
              </label>
            ))}
          </div>
        );
      })}
      <p className="hint">
        要塞砲は番の終わりに拠点から {FORTRESS_CANNON_RANGE} HEX 以内の敵（城の HEX を除く）を、ガンシップは全域の敵を、ランダムに 1 つ撃つ（拠点のあるマップの防衛側に持たせる）
      </p>
      <p className="hint">バリスタは城の HEX にいる弓兵の射程 +1、魔導台は城の HEX にいる魔術師の射程 +1 と、番の初めにクールタイムがさらに 1 減る。変更はすぐ反映する</p>
    </>
  );
}
