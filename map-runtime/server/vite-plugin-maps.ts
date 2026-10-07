/**
 * マップ JSON の置き場所（assets/maps/）をページの `maps/` として見せる Vite プラグイン。
 * map-editor・battle-editor の両方で使う。URL は src/mapFiles.ts を参照。
 *
 * - 開発サーバー: assets/maps/ を直接読み書きする（readOnly なら保存は拒否）
 * - ビルド: その時点の assets/maps/ と一覧を dist/maps/ に書き出す
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';
import { MapParseError, parseMapData, stringifyMapData } from '../src/core/mapData.ts';
import { isValidMapFileName, MAP_INDEX_FILE, MAPS_URL, type MapFileInfo } from '../src/mapFiles.ts';

export interface MapsPluginOptions {
  /** norden-battle/assets/maps の絶対パス */
  mapsDir: string;
  /** true なら保存（PUT）を受け付けない */
  readOnly?: boolean;
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function mapsPlugin(opts: MapsPluginOptions): Plugin {
  const dir = path.resolve(opts.mapsDir);

  const mapFileNames = async (): Promise<string[]> => {
    try {
      return (await readdir(dir)).filter(isValidMapFileName).sort();
    } catch {
      return [];
    }
  };

  const readIndex = async (): Promise<MapFileInfo[]> => {
    const out: MapFileInfo[] = [];
    for (const file of await mapFileNames()) {
      try {
        const data = parseMapData(JSON.parse(await readFile(path.join(dir, file), 'utf8')));
        out.push({ file, name: data.name, grid: data.grid });
      } catch (e) {
        out.push({ file, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // base: './' でも開発サーバーはルート（/）から配信する
    const m = new RegExp(`^/${MAPS_URL}([^/]+)$`).exec(decodeURIComponent(url.pathname));
    if (!m) return false;
    const file = m[1];
    const method = req.method ?? 'GET';

    if (file === MAP_INDEX_FILE && method === 'GET') {
      sendJson(res, 200, await readIndex());
      return true;
    }
    if (!isValidMapFileName(file)) throw new HttpError(400, `不正なファイル名: ${file}`);
    const full = path.join(dir, file);

    if (method === 'GET' || method === 'HEAD') {
      let text: string;
      try {
        text = await readFile(full, 'utf8');
      } catch {
        throw new HttpError(404, `見つかりません: ${file}`);
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(method === 'HEAD' ? undefined : text);
      return true;
    }
    if (method === 'PUT') {
      if (opts.readOnly) throw new HttpError(405, 'このツールからはマップを保存できません');
      let data;
      try {
        data = parseMapData(JSON.parse((await readBody(req)).toString('utf8')));
      } catch (e) {
        throw new HttpError(400, e instanceof MapParseError || e instanceof SyntaxError ? e.message : String(e));
      }
      await mkdir(dir, { recursive: true });
      await writeFile(full, stringifyMapData(data));
      sendJson(res, 200, { ok: true });
      return true;
    }
    return false;
  };

  return {
    name: 'norden-maps',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        handle(req, res)
          .then((done) => {
            if (!done) next();
          })
          .catch((e: unknown) => {
            const status = e instanceof HttpError ? e.status : 500;
            res.statusCode = status;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end(e instanceof Error ? e.message : String(e));
          });
      });
    },
    async generateBundle() {
      for (const file of await mapFileNames()) {
        this.emitFile({ type: 'asset', fileName: MAPS_URL + file, source: await readFile(path.join(dir, file), 'utf8') });
      }
      this.emitFile({ type: 'asset', fileName: MAPS_URL + MAP_INDEX_FILE, source: JSON.stringify(await readIndex()) });
    },
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
