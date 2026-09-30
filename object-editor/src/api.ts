/**
 * 開発サーバーの API（server/vite-plugin-assets.ts）のクライアント。
 */
import { parseSourceEntry, stringifySourceEntry, type SourceEntry } from '@norden/asset-runtime';

/** assets/sources/ を指す URL（loadSourceAsset に渡す） */
export const SOURCES_URL = './files/sources';

async function request(method: string, url: string, body?: BodyInit, contentType?: string): Promise<unknown> {
  const res = await fetch(url, { method, body, headers: contentType ? { 'Content-Type': contentType } : undefined });
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(json?.error ?? `${method} ${url}: HTTP ${res.status}`);
  return json;
}

export async function fetchCatalog(): Promise<{ sources: SourceEntry[]; errors: string[] }> {
  const json = (await request('GET', './api/catalog')) as { sources: unknown[]; errors: string[] };
  return { sources: json.sources.map(parseSourceEntry), errors: json.errors };
}

export async function putSourceEntry(e: SourceEntry): Promise<SourceEntry> {
  return parseSourceEntry(await request('PUT', `./api/catalog/sources/${e.id}`, stringifySourceEntry(e), 'application/json'));
}

export async function deleteSourceEntry(id: string): Promise<void> {
  await request('DELETE', `./api/catalog/sources/${id}`);
}

export async function putSourceFile(id: string, rel: string, data: Blob | ArrayBuffer): Promise<void> {
  const path = rel.split('/').map(encodeURIComponent).join('/');
  await request('PUT', `./api/sources/${id}/files/${path}`, data, 'application/octet-stream');
}
