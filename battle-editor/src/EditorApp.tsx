/**
 * battle-editor の画面。戦闘画面（@norden/battle-runtime の BattleScreen）の上に、エディタの道具を重ねる。
 *
 * 画面の上のツールバー（エディタの道具。ゲームの画面には出さない）のボタンで道具のウィンドウを開く。
 * - ウィンドウは一度に 1 つだけ開き、押したボタンの下に出す。
 * - 同じボタンか、ウィンドウの × で閉じる。マップを触っても閉じない（描画負荷を見ながら動かせるように）。
 * - マップ: map-editor が assets/maps/ に保存したものを読み込む（ここからは書き換えない）。JSON を開く・ドロップすることもできる。
 * - 描画負荷: FPS・解像度・森の描き方・深度プリパス・影の更新。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { MapParseError, parseMapData, type MapData } from '@norden/map-runtime/core/mapData';
import { listMapFiles, loadMapFile, type MapFileInfo } from '@norden/map-runtime/mapFiles';
import type { ForestMode } from '@norden/map-runtime/render/foliage';
import { DEFAULT_PIXEL_RATIO } from '@norden/map-runtime/render/scene';
import { BattleScreen, type BattleApp } from '@norden/battle-runtime';

/** 画面の端・ツールバーとの間（CSS ピクセル） */
const MARGIN = 12;
const GAP = 6;

type Tool = 'map' | 'perf';

const TOOLS: Record<Tool, string> = { map: 'マップ', perf: '描画負荷' };

export default function EditorApp() {
  const [app, setApp] = useState<BattleApp | null>(null);
  const [map, setMap] = useState<MapData | null>(null);
  const [title, setTitle] = useState('-');
  const [notice, setNotice] = useState<ReactNode>(null);
  const [files, setFiles] = useState<MapFileInfo[]>([]);
  /** assets/maps/ から開いたファイル名。ローカルから開いたときは null */
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [dragging, setDragging] = useState(false);

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
    setMap(data);
    setCurrentFile(file);
    setNotice(null);
    setTitle(`${label ?? '-'} — ${data.name} — ${data.grid.orientation} ${data.grid.cols}×${data.grid.rows}`);
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
    <BattleScreen map={map} notice={notice} onApp={setApp} className="editor-screen">
      <Toolbar
        tool={tool}
        onTool={setTool}
        title={title}
        windows={{
          map: (
            <MapTool
              files={files}
              currentFile={currentFile}
              onSelect={(file) => void loadStored(file)}
              onRefresh={() => void refreshList()}
              onOpen={(f) => void f.text().then((text) => loadJsonText(text, f.name))}
            />
          ),
          perf: app && <PerfTool app={app} />,
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
  onSelect,
  onRefresh,
  onOpen,
}: {
  files: MapFileInfo[];
  currentFile: string | null;
  onSelect: (file: string) => void;
  onRefresh: () => void;
  onOpen: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const value = currentFile && files.some((f) => f.file === currentFile) ? currentFile : '';
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
      <div className="buttons">
        <button onClick={onRefresh}>一覧を更新</button>
        <button onClick={() => inputRef.current?.click()}>JSON を開く</button>
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
