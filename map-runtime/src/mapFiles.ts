/**
 * マップ JSON の置き場所（リポジトリ直下の assets/maps/）への読み書き。
 * map-editor・battle-editor で同じマップを共有する。
 *
 * ページからの相対 URL `maps/` で読む。開発サーバーでは server/vite-plugin-maps.ts が
 * assets/maps/ を返し（保存もできる）、ビルドでは dist/maps/ に書き出したものを読む（保存はできない）。
 *
 *   GET maps/index.json     一覧（MapFileInfo[]）
 *   GET maps/<file>         マップ JSON
 *   PUT maps/<file>         保存（開発サーバーのみ）
 */
import { parseMapData, stringifyMapData, type MapData } from './core/mapData';
import type { GridSpec } from './core/hex';

export const MAPS_URL = 'maps/';
export const MAP_INDEX_FILE = 'index.json';

export interface MapFileInfo {
  /** ファイル名（fluen.json など） */
  file: string;
  /** マップ名。読めなかったファイルでは無い */
  name?: string;
  grid?: GridSpec;
  /** 読めなかった理由 */
  error?: string;
}

/** 保存先のファイル名として使えるか（パス区切りや OS で使えない文字を含まない .json） */
export function isValidMapFileName(file: string): boolean {
  return (
    file !== MAP_INDEX_FILE &&
    file.length <= 120 &&
    /^[^\\/:*?"<>|\u0000-\u001f.][^\\/:*?"<>|\u0000-\u001f]*\.json$/u.test(file)
  );
}

/** マップ名から保存用のファイル名を作る */
export function mapFileNameFor(name: string): string {
  const base = name.trim().replace(/[\\/:*?"<>|\s\u0000-\u001f]+/gu, '_').replace(/^[._]+/, '');
  return `${base || 'untitled'}.json`;
}

export async function listMapFiles(): Promise<MapFileInfo[]> {
  const res = await fetch(MAPS_URL + MAP_INDEX_FILE, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`マップ一覧を取得できません: HTTP ${res.status}`);
  return (await res.json()) as MapFileInfo[];
}

export async function loadMapFile(file: string): Promise<MapData> {
  const res = await fetch(MAPS_URL + encodeURIComponent(file), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return parseMapData(await res.json());
}

/** assets/maps/<file> に保存する（開発サーバーでのみ可能） */
export async function saveMapFile(file: string, data: MapData): Promise<void> {
  if (!isValidMapFileName(file)) throw new Error(`ファイル名に使えません: ${file}`);
  const res = await fetch(MAPS_URL + encodeURIComponent(file), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: stringifyMapData(data),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`${file} を保存できません: ${msg || `HTTP ${res.status}`}（保存は開発サーバーでのみ可能です）`);
  }
}
