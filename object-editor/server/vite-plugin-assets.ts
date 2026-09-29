/**
 * 開発サーバーの API。ブラウザからは assets/ に書き込めないので、保存は Node 側で行う。
 *
 *   GET    /api/catalog                         カタログ全体 { sources: SourceEntry[], errors: string[] }
 *   PUT    /api/catalog/sources/<id>            SourceEntry を保存（本文は JSON）
 *   DELETE /api/catalog/sources/<id>            SourceEntry と assets/sources/<id>/ を削除
 *   PUT    /api/sources/<id>/files/<path>       assets/sources/<id>/<path> にファイルを書き込む（本文はバイナリ）
 *   GET    /files/<path>                        assets/<path> を返す
 *
 * カタログを変更するたびに assets/CREDITS.md を作り直す。
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';
import {
  CatalogParseError,
  creditsMarkdown,
  isSafeRelativePath,
  isValidAssetId,
  parseSourceEntry,
  stringifySourceEntry,
  validateSourceEntry,
  type SourceEntry,
} from '../../asset-runtime/src/catalog.ts';

export interface AssetsApiOptions {
  /** norden-battle/assets の絶対パス */
  assetsDir: string;
}

const MIME: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8',
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function assetsApi(opts: AssetsApiOptions): Plugin {
  const root = path.resolve(opts.assetsDir);
  const catalogDir = path.join(root, 'catalog', 'sources');
  const sourcesDir = path.join(root, 'sources');

  const readCatalog = async (): Promise<{ sources: SourceEntry[]; errors: string[] }> => {
    const sources: SourceEntry[] = [];
    const errors: string[] = [];
    let names: string[] = [];
    try {
      names = await readdir(catalogDir);
    } catch {
      return { sources, errors };
    }
    for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
      try {
        const entry = parseSourceEntry(JSON.parse(await readFile(path.join(catalogDir, name), 'utf8')));
        if (`${entry.id}.json` !== name) throw new CatalogParseError(`ファイル名と id が一致しません（id: ${entry.id}）`);
        sources.push(entry);
      } catch (e) {
        errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { sources, errors };
  };

  const writeCredits = async () => {
    const { sources } = await readCatalog();
    await writeFile(path.join(root, 'CREDITS.md'), creditsMarkdown(sources));
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = decodeURIComponent(url.pathname);
    const method = req.method ?? 'GET';

    if (p === '/api/catalog' && method === 'GET') {
      sendJson(res, 200, await readCatalog());
      return true;
    }

    let m = /^\/api\/catalog\/sources\/([^/]+)$/.exec(p);
    if (m) {
      const id = m[1];
      if (!isValidAssetId(id)) throw new HttpError(400, `不正な id: ${id}`);
      const file = path.join(catalogDir, `${id}.json`);
      if (method === 'PUT') {
        const entry = parseSourceEntry(JSON.parse((await readBody(req)).toString('utf8')));
        if (entry.id !== id) throw new HttpError(400, 'URL と本文の id が一致しません');
        const errs = validateSourceEntry(entry);
        if (errs.length > 0) throw new HttpError(400, errs.join(' / '));
        await mkdir(catalogDir, { recursive: true });
        await writeFile(file, stringifySourceEntry(entry));
        await writeCredits();
        sendJson(res, 200, entry);
        return true;
      }
      if (method === 'DELETE') {
        await rm(file, { force: true });
        await rm(path.join(sourcesDir, id), { recursive: true, force: true });
        await writeCredits();
        sendJson(res, 200, { ok: true });
        return true;
      }
    }

    m = /^\/api\/sources\/([^/]+)\/files\/(.+)$/.exec(p);
    if (m && method === 'PUT') {
      const [, id, rel] = m;
      if (!isValidAssetId(id) || !isSafeRelativePath(rel)) throw new HttpError(400, `不正なパス: ${id}/${rel}`);
      const file = path.join(sourcesDir, id, rel);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, await readBody(req));
      sendJson(res, 200, { ok: true });
      return true;
    }

    m = /^\/files\/(.+)$/.exec(p);
    if (m && (method === 'GET' || method === 'HEAD')) {
      if (!isSafeRelativePath(m[1])) throw new HttpError(400, `不正なパス: ${m[1]}`);
      let data: Buffer;
      try {
        data = await readFile(path.join(root, m[1]));
      } catch {
        throw new HttpError(404, `見つかりません: ${m[1]}`);
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', MIME[path.extname(m[1]).toLowerCase()] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(method === 'HEAD' ? undefined : data);
      return true;
    }

    return false;
  };

  return {
    name: 'norden-assets-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        handle(req, res)
          .then((done) => {
            if (!done) next();
          })
          .catch((e: unknown) => {
            const status = e instanceof HttpError ? e.status : e instanceof CatalogParseError || e instanceof SyntaxError ? 400 : 500;
            sendJson(res, status, { error: e instanceof Error ? e.message : String(e) });
          });
      });
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
