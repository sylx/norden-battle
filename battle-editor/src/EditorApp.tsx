/**
 * battle-editor の画面。戦闘画面（@norden/battle-runtime の BattleScreen）の上に、エディタの道具を重ねる。
 *
 * 画面の上のツールバー（エディタの道具。ゲームの画面には出さない）のボタンで道具のウィンドウを開く。
 * - ウィンドウは一度に 1 つだけ開き、押したボタンの下に出す。
 * - 同じボタンか、ウィンドウの × で閉じる。マップを触っても閉じない（描画負荷を見ながら動かせるように）。
 * - マップ: map-editor が assets/maps/ に保存したものを読み込む（ここからは書き換えない）。JSON を開く・ドロップすることもできる。
 *   街道マップ（battleAreas のあるマップ）は戦闘の範囲（防衛する都市）を選んで切り出し、その初期配置地点で配備から始める
 *   （既定は初期配置地点のある最初の範囲）。「最初から」で配備からやり直す。
 * - 描画負荷: FPS・解像度・森の描き方・深度プリパス・影の更新。
 * - セリフ: 喋る場面で必ず喋らせる（確率を無視）・選択中か調べているユニットに場面ごとのセリフを言わせる。
 *   ゲーム（nordencult）のセリフのデータがあればそれを使い（gameVoices.ts）、ユニットに喋らせる騎士を選べる。言ったセリフの記録。
 * - 退却・捕縛: 軍ごとにダミーの退却先の拠点を渡すかどうか（渡さない軍は退却できない）・退却に失敗する確率と殲滅されて捕縛される確率・
 *   退却と殲滅の結果の記録。
 * 決着のカットインは青軍（攻撃側）をプレイヤーとして勝利・敗北を出す。決着のウィンドウの「最初から」で、同じマップを読み込み直す。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cropBattleArea } from '@norden/map-runtime/core/battleArea';
import { MapParseError, parseMapData, type MapData } from '@norden/map-runtime/core/mapData';
import { listMapFiles, loadMapFile, type MapFileInfo } from '@norden/map-runtime/mapFiles';
import type { ForestMode } from '@norden/map-runtime/render/foliage';
import { DEFAULT_PIXEL_RATIO } from '@norden/map-runtime/render/scene';
import { TEAM_DEFS, UNIT_DEFS, type TeamId, type UnitData } from '@norden/map-runtime/core/units';
import {
  BARK_CHANCE,
  BARK_SITUATION_NAMES,
  BARK_SITUATIONS,
  BattleScreen,
  EXCHANGE_CHANCE,
  RETREAT_FAIL_CHANCE,
  WIPEOUT_CAPTURE_CHANCE,
  type BattleApp,
  type RetreatDestination,
  type RetreatDestinations,
  type RetreatReport,
  type WipeoutReport,
} from '@norden/battle-runtime';
import { gameVoices, type KnightCast } from './gameVoices';

/** 画面の端・ツールバーとの間（CSS ピクセル） */
const MARGIN = 12;
const GAP = 6;

type Tool = 'map' | 'perf' | 'bark' | 'retreat';

const TOOLS: Record<Tool, string> = { map: 'マップ', perf: '描画負荷', bark: 'セリフ', retreat: '退却・捕縛' };

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
      barks={gameVoices?.barks}
      retreats={retreats}
      onEnd={() => setRestart((n) => n + 1)}
      endLabel="最初から"
      // 両軍を操作するが、決着のカットイン（勝利・敗北）は青軍（攻撃側）をプレイヤーとして出す
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
          perf: app && <PerfTool app={app} />,
          bark: app && <BarkTool app={app} cast={gameVoices?.cast ?? null} />,
          retreat: app && <RetreatTool app={app} teams={retreatTeams} onTeams={setRetreatTeams} />,
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
        <section key={id} ref={(el) => void (winRefs.current[id] = el)} className="tool-window" hidden={tool !== id} style={pos}>
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

function BarkTool({ app, cast }: { app: BattleApp; cast: KnightCast | null }) {
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
        const who = cast?.get(u)?.name ?? '';
        setLog((list) => [{ id: id++, who, situation: BARK_SITUATION_NAMES[situation], text }, ...list].slice(0, BARK_LOG_SIZE));
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [app, cast]);
  const knight = unit && cast?.get(unit);
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
      {cast ? (
        <>
          <p className="hint">ゲームのセリフのデータで喋る。喋る騎士はユニットごとに選べる（決めていなければ口調のある騎士を順に割り当てる）</p>
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
        </>
      ) : (
        <p className="hint">ゲーム（nordencult）のセリフのデータが無いので、表示確認用のセリフで喋る</p>
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

function RetreatTool({ app, teams, onTeams }: { app: BattleApp; teams: ReadonlySet<TeamId>; onTeams: (teams: ReadonlySet<TeamId>) => void }) {
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
          <input type="checkbox" checked={teams.has(team)} onChange={(e) => toggle(team, e.target.checked)} /> {TEAM_DEFS[team].name}:{' '}
          {DUMMY_RETREATS[team].map((d) => d.name).join('・')}
        </label>
      ))}
      <p className="hint">退却に失敗する確率（隣接する敵の数）: {table(RETREAT_FAIL_CHANCE)}。失敗すると捕虜になる</p>
      <p className="hint">殲滅されて指揮官が捕縛される確率（隣接する敵の数）: {table(WIPEOUT_CAPTURE_CHANCE)}。捕縛されなければ落ち延びる</p>
      {log.length > 0 && (
        <ul className="bark-log">
          {log.map((r, i) => (
            <li key={i}>
              <span className="bark-log__who">
                第 {r.turn} ターン {TEAM_DEFS[r.unit.team].name} {UNIT_DEFS[r.unit.type].name}
                {r.troopId ? `（${r.troopId}）` : ''}・{r.kind === 'retreat' ? '失敗' : '捕縛'} {percent(r.kind === 'retreat' ? r.failChance : r.captureChance)}（敵{' '}
                {r.enemies}）
              </span>
              {r.kind === 'retreat'
                ? r.captured
                  ? `${r.to.name}への退却に失敗し、捕虜になった`
                  : `${r.to.name}へ退却した`
                : r.captured
                  ? '殲滅され、指揮官が捕縛された'
                  : '殲滅されたが、指揮官は落ち延びた'}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
