/**
 * アセットカタログ（assets/catalog/）の型・パース・検証。three.js 非依存。
 *
 * 取り込んだ素材 1 つが SourceEntry 1 つ（assets/catalog/sources/<id>.json）に対応する。
 *
 * {
 *   "version": 1,
 *   "kind": "source",
 *   "id": "kaykit-knight",
 *   "name": "騎士",
 *   "category": "character",
 *   "tags": ["kaykit"],
 *   "license": "CC0",
 *   "origin": { "url": "https://kaylousberg.itch.io/", "author": "Kay Lousberg", "pack": "KayKit Adventurers" },
 *   "files": { "original": ["original/Knight.glb"], "model": "model.glb" },
 *   "skeleton": "mixamo",
 *   "transform": { "rotation": [0, 0, 0], "pivot": [0, 0, 0], "scale": 0.01 },
 *   "stats": { ... },
 *   "importedAt": "2026-09-29T00:00:00.000Z"
 * }
 *
 * - files のパスは assets/sources/<id>/ からの相対パス。model は three.js で読める GLB。
 * - transform は GLB に焼き込まない正規化の変換。p' = scale × (R·p + pivot)。
 *   rotation は XYZ オイラー角（度）、pivot は回転後の座標系でのずらし量（足元の中心を原点にする）。
 */

export const CATALOG_VERSION = 1;

export const CATEGORY_IDS = ['building', 'fortification', 'prop', 'nature', 'character', 'equipment', 'animation'] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

export interface CategoryDef {
  id: CategoryId;
  name: string;
  /** 三角形数の目安（超えたら警告）。null は制限なし */
  triBudget: number | null;
  /** テクスチャの 1 辺の目安 */
  textureBudget: number;
}

export const CATEGORY_DEFS: Record<CategoryId, CategoryDef> = {
  building: { id: 'building', name: '建物', triBudget: 6000, textureBudget: 1024 },
  fortification: { id: 'fortification', name: '城・砦の部品', triBudget: 4000, textureBudget: 1024 },
  prop: { id: 'prop', name: '小物', triBudget: 1000, textureBudget: 512 },
  nature: { id: 'nature', name: '自然物', triBudget: 1500, textureBudget: 512 },
  // 部隊として数百体を同時に描くので厳しめ
  character: { id: 'character', name: 'キャラクター', triBudget: 3000, textureBudget: 512 },
  equipment: { id: 'equipment', name: '装備', triBudget: 500, textureBudget: 256 },
  animation: { id: 'animation', name: 'アニメーション', triBudget: null, textureBudget: 0 },
};

export const LICENSE_IDS = ['CC0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'purchased', 'ai-generated', 'mixamo', 'own', 'other'] as const;
export type LicenseId = (typeof LICENSE_IDS)[number];

export interface LicenseDef {
  id: LicenseId;
  name: string;
  /** クレジット表記が必要 */
  attribution: boolean;
  /** 素材そのものを公開リポジトリなどで再配布できる */
  redistributable: boolean;
}

export const LICENSE_DEFS: Record<LicenseId, LicenseDef> = {
  CC0: { id: 'CC0', name: 'CC0（パブリックドメイン）', attribution: false, redistributable: true },
  'CC-BY-4.0': { id: 'CC-BY-4.0', name: 'CC BY 4.0', attribution: true, redistributable: true },
  'CC-BY-SA-4.0': { id: 'CC-BY-SA-4.0', name: 'CC BY-SA 4.0', attribution: true, redistributable: true },
  purchased: { id: 'purchased', name: '購入（アセットストア等）', attribution: false, redistributable: false },
  'ai-generated': { id: 'ai-generated', name: 'AI 生成（サービスの規約に従う）', attribution: false, redistributable: false },
  mixamo: { id: 'mixamo', name: 'Mixamo（ゲームに組み込んで使う分には自由）', attribution: false, redistributable: false },
  own: { id: 'own', name: '自作', attribution: false, redistributable: true },
  other: { id: 'other', name: 'その他（メモに記載）', attribution: true, redistributable: false },
};

/**
 * スケルトンの種類。
 * - none   : スケルトンなし（静的なモデル）
 * - mixamo : Mixamo 標準の骨格。骨の名前は "mixamorigHips" "mixamorigLeftArm" … の形に正規化済み
 * - other  : それ以外の骨格（リターゲットにはボーンの対応表が要る）
 */
export const SKELETON_KINDS = ['none', 'mixamo', 'other'] as const;
export type SkeletonKind = (typeof SKELETON_KINDS)[number];

export type Vec3Tuple = [number, number, number];

export interface NormalizeTransform {
  /** XYZ オイラー角（度） */
  rotation: Vec3Tuple;
  /** 回転後の座標系でのずらし量（スケール前） */
  pivot: Vec3Tuple;
  scale: number;
}

export interface SourceOrigin {
  url?: string;
  author?: string;
  pack?: string;
  note?: string;
}

export interface AnimationInfo {
  name: string;
  /** 秒 */
  duration: number;
}

export interface AssetStats {
  triangles: number;
  vertices: number;
  meshes: number;
  materials: number;
  textures: number;
  /** テクスチャの長辺の最大（px） */
  maxTextureSize: number;
  bones: number;
  animations: AnimationInfo[];
  /** 正規化前のバウンディングボックスの大きさ */
  rawSize: Vec3Tuple;
}

export interface SourceEntry {
  version: 1;
  kind: 'source';
  id: string;
  name: string;
  category: CategoryId;
  tags: string[];
  license: LicenseId;
  origin: SourceOrigin;
  files: { original: string[]; model: string };
  skeleton: SkeletonKind;
  transform: NormalizeTransform;
  stats: AssetStats;
  importedAt: string;
}

export const IDENTITY_TRANSFORM: NormalizeTransform = { rotation: [0, 0, 0], pivot: [0, 0, 0], scale: 1 };

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidAssetId(id: string): boolean {
  return ID_RE.test(id);
}

/** ファイル名などから ID の候補を作る */
export function slugifyAssetId(name: string): string {
  const s = name
    .replace(/\.[^.]+$/, '')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return s || 'asset';
}

/** assets/sources/<id>/ の中の相対パスとして安全か */
export function isSafeRelativePath(p: string): boolean {
  return p.length > 0 && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

export class CatalogParseError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v: unknown): v is Vec3Tuple => Array.isArray(v) && v.length === 3 && v.every(isNum);
const optStr = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

export function parseSourceEntry(json: unknown): SourceEntry {
  const fail = (msg: string): never => {
    throw new CatalogParseError(msg);
  };
  if (!isObj(json)) fail('JSON がオブジェクトではありません');
  const o = json as Record<string, unknown>;
  if (o.version !== CATALOG_VERSION) fail(`未対応の version: ${String(o.version)}`);
  if (o.kind !== 'source') fail(`kind が "source" ではありません: ${String(o.kind)}`);
  if (typeof o.id !== 'string' || !isValidAssetId(o.id)) fail(`id が不正です: ${String(o.id)}`);
  const id = o.id as string;
  const at = (msg: string) => fail(`${id}: ${msg}`);

  if (!(CATEGORY_IDS as readonly unknown[]).includes(o.category)) at(`未知の category "${String(o.category)}"`);
  if (!(LICENSE_IDS as readonly unknown[]).includes(o.license)) at(`未知の license "${String(o.license)}"`);
  if (!(SKELETON_KINDS as readonly unknown[]).includes(o.skeleton)) at(`未知の skeleton "${String(o.skeleton)}"`);

  const files = o.files;
  if (!isObj(files)) return at('files がありません');
  const f = files as Record<string, unknown>;
  if (typeof f.model !== 'string' || !isSafeRelativePath(f.model)) at('files.model が不正です');
  if (!Array.isArray(f.original) || !f.original.every((p) => typeof p === 'string' && isSafeRelativePath(p)))
    at('files.original が不正です');

  const t = o.transform;
  if (!isObj(t)) return at('transform がありません');
  const tr = t as Record<string, unknown>;
  if (!isVec3(tr.rotation) || !isVec3(tr.pivot) || !isNum(tr.scale) || tr.scale <= 0) at('transform が不正です');

  const origin = isObj(o.origin) ? (o.origin as Record<string, unknown>) : {};
  const tags = Array.isArray(o.tags) ? o.tags.filter((x): x is string => typeof x === 'string' && x !== '') : [];

  return {
    version: 1,
    kind: 'source',
    id,
    name: typeof o.name === 'string' && o.name !== '' ? o.name : id,
    category: o.category as CategoryId,
    tags,
    license: o.license as LicenseId,
    origin: { url: optStr(origin.url), author: optStr(origin.author), pack: optStr(origin.pack), note: optStr(origin.note) },
    files: { original: [...(f.original as string[])], model: f.model as string },
    skeleton: o.skeleton as SkeletonKind,
    transform: {
      rotation: [...(tr.rotation as Vec3Tuple)],
      pivot: [...(tr.pivot as Vec3Tuple)],
      scale: tr.scale as number,
    },
    stats: parseStats(o.stats),
    importedAt: typeof o.importedAt === 'string' ? o.importedAt : '',
  };
}

function parseStats(v: unknown): AssetStats {
  const s = isObj(v) ? (v as Record<string, unknown>) : {};
  const n = (x: unknown) => (isNum(x) ? x : 0);
  const anims = Array.isArray(s.animations) ? s.animations : [];
  return {
    triangles: n(s.triangles),
    vertices: n(s.vertices),
    meshes: n(s.meshes),
    materials: n(s.materials),
    textures: n(s.textures),
    maxTextureSize: n(s.maxTextureSize),
    bones: n(s.bones),
    animations: anims.filter(isObj).map((a) => ({ name: String(a.name ?? ''), duration: n(a.duration) })),
    rawSize: isVec3(s.rawSize) ? [...s.rawSize] : [0, 0, 0],
  };
}

/** JSON 文字列にする（キーの順を固定し、人が差分を読めるようにする） */
export function stringifySourceEntry(e: SourceEntry): string {
  const out: SourceEntry = {
    version: e.version,
    kind: e.kind,
    id: e.id,
    name: e.name,
    category: e.category,
    tags: e.tags,
    license: e.license,
    origin: e.origin,
    files: e.files,
    skeleton: e.skeleton,
    transform: e.transform,
    stats: e.stats,
    importedAt: e.importedAt,
  };
  return JSON.stringify(out, null, 2) + '\n';
}

/** 保存を止める問題（出典とライセンスの記録は必須） */
export function validateSourceEntry(e: SourceEntry): string[] {
  const errs: string[] = [];
  if (!isValidAssetId(e.id)) errs.push('ID は英小文字・数字・- _ で 64 文字まで');
  if (!e.origin.url && !e.origin.author && !e.origin.pack) errs.push('出典（URL・作者・パック名のどれか）を入力してください');
  if (e.license === 'other' && !e.origin.note) errs.push('ライセンスが「その他」のときはメモに条件を書いてください');
  return errs;
}

/** 予算超過などの警告（保存はできる） */
export function sourceWarnings(e: SourceEntry): string[] {
  const def = CATEGORY_DEFS[e.category];
  const w: string[] = [];
  if (def.triBudget !== null && e.stats.triangles > def.triBudget)
    w.push(`三角形 ${e.stats.triangles.toLocaleString()} が目安 ${def.triBudget.toLocaleString()} を超えています`);
  if (def.textureBudget > 0 && e.stats.maxTextureSize > def.textureBudget)
    w.push(`テクスチャ ${e.stats.maxTextureSize}px が目安 ${def.textureBudget}px を超えています`);
  if (e.stats.materials > 4) w.push(`マテリアルが ${e.stats.materials} 個あります（描画が重くなる）`);
  if (e.category === 'character' && e.skeleton === 'none') w.push('キャラクターにスケルトンがありません（Mixamo でリグを付けてください）');
  if (e.category === 'character' && e.skeleton === 'other') w.push('Mixamo 以外の骨格です（アニメーションの共有にはリターゲットが要る）');
  if (e.category === 'animation' && e.stats.animations.length === 0) w.push('アニメーションが含まれていません');
  return w;
}

/** CREDITS.md の本文 */
export function creditsMarkdown(entries: SourceEntry[]): string {
  const lines = ['# Credits', '', 'このファイルは object-editor が assets/catalog から自動生成する。直接編集しない。', ''];
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  for (const lic of LICENSE_IDS) {
    const list = sorted.filter((e) => e.license === lic);
    if (list.length === 0) continue;
    lines.push(`## ${LICENSE_DEFS[lic].name}`, '');
    for (const e of list) {
      const parts = [e.origin.pack, e.origin.author && `by ${e.origin.author}`].filter(Boolean).join(' ');
      const src = e.origin.url ? ` <${e.origin.url}>` : '';
      const note = e.origin.note ? ` — ${e.origin.note}` : '';
      lines.push(`- **${e.name}** (\`${e.id}\`)${parts ? `: ${parts}` : ''}${src}${note}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
