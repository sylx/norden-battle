/**
 * プロシージャル兵士の試作場。
 * カタログの Mixamo 骨格のアセットから骨格の雛形とモーションを集め、兵士を並べる。
 *
 * - single : 1 体
 * - squad  : 1 部隊（12 体）
 * - army   : 両軍の部隊を HEX 盤面に並べる（部隊描画の負荷テスト）。
 *            インスタンス描画（ベイクした骨の姿勢 + InstancedMesh）と、1 体ずつの SkinnedMesh を切り替えて比べられる
 *
 * 比較用にカタログのキャラクターを横に置ける。
 */
import { squadFormation, UNITS, type SourceEntry } from '@norden/asset-runtime';
import {
  bakeAnimations,
  buildSoldier,
  buildSoldierGeometry,
  canBuildSoldier,
  createSkeletonTemplate,
  Crowd,
  DEFAULT_SOLDIER,
  instantiateSoldier,
  loadSourceAsset,
  NON_LOOP_RE,
  type BakedAnimations,
  type LoadedAsset,
  type SoldierParams,
} from '@norden/asset-runtime/three';
import * as THREE from 'three';
import { SOURCES_URL } from '../api';
import type { ViewerScene } from '../render/scene';

interface Unit {
  object: THREE.Object3D;
  mesh: THREE.SkinnedMesh;
  mixer: THREE.AnimationMixer;
  /** アニメーションの開始位置（0..1） */
  phase: number;
  /** 大軍モードでのクリップ（空なら lab.clipName） */
  clip?: string;
  speed?: number;
}

export type LabMode = 'single' | 'squad' | 'army';
export type RenderMode = 'instanced' | 'skinned';

/** 大軍モードの設定 */
export interface ArmySettings {
  /** 片軍の部隊数 */
  squadsPerSide: number;
  /** 1 部隊の人数 */
  perSquad: number;
  render: RenderMode;
  /** 空ならモーションを部隊ごとにばらばらにする */
  clip: string;
  /** 兵種ごとの見た目の違い（ジオメトリ）の数 */
  variants: number;
}

/** 敵軍の兵種（剣と盾の歩兵） */
const ENEMY: Partial<SoldierParams> = { helmet: 'nasal', armor: 'tunic', weapon: 'sword', shield: 'heater', teamColor: 0xa83232 };

const SQUAD_SIZE = 12;
const SQRT3 = Math.sqrt(3);

export class SoldierLab {
  readonly group = new THREE.Group();
  params: SoldierParams = { ...DEFAULT_SOLDIER };
  mode: LabMode = 'single';
  readonly army: ArmySettings = { squadsPerSide: 10, perSquad: 12, render: 'instanced', clip: '', variants: 4 };
  /** Mixamo 骨格のアセット */
  sources: SourceEntry[] = [];
  skeletonId = '';
  /** 表示名 → クリップ */
  readonly clips = new Map<string, THREE.AnimationClip>();
  clipName = '';
  speed = 1;
  compareId = '';
  compareCandidates: SourceEntry[] = [];
  /** 表示中の兵士の三角形の合計 */
  triangles = 0;
  /** 表示中の兵士の数 */
  soldierCount = 0;
  /** パネルを作り直す必要があるとき増える */
  revision = 0;
  private template: THREE.Object3D | null = null;
  private baked: BakedAnimations | null = null;
  private units: Unit[] = [];
  private crowd: Crowd | null = null;
  private field: THREE.Object3D | null = null;
  private compare: { asset: LoadedAsset; mixer: THREE.AnimationMixer } | null = null;
  private time = 0;
  private readonly view: ViewerScene;

  constructor(view: ViewerScene) {
    this.view = view;
    this.group.name = 'soldier-lab';
  }

  /** カタログから骨格とモーションを集める */
  async init(entries: SourceEntry[]): Promise<void> {
    this.sources = entries.filter((e) => e.skeleton === 'mixamo');
    if (this.sources.length === 0)
      throw new Error('Mixamo 骨格のアセットがありません。先に Mixamo のキャラかモーションを取り込んでください');
    for (const e of this.sources) {
      const a = await loadSourceAsset(e, SOURCES_URL);
      for (const clip of a.animations) {
        // キャラに付いてくる 1 フレームだけのクリップ（基準姿勢）は使わない
        if (clip.duration < 0.1) continue;
        const label = a.animations.length === 1 ? e.name : `${e.name} / ${clip.name}`;
        this.clips.set(label, clip);
      }
      a.object.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    const labels = [...this.clips.keys()];
    this.clipName = labels.find((l) => /idle/i.test(l)) ?? labels[0] ?? '';
    // キャラクターの基準姿勢の方が確実なので優先する
    const first = this.sources.find((e) => e.category === 'character') ?? this.sources[0];
    await this.setSkeleton(first.id);
  }

  async setSkeleton(id: string): Promise<void> {
    const entry = this.sources.find((e) => e.id === id);
    if (!entry) return;
    const a = await loadSourceAsset(entry, SOURCES_URL);
    const tpl = createSkeletonTemplate(a.object.model);
    if (!tpl || !canBuildSoldier(tpl)) throw new Error(`${entry.name}: 兵士に必要な骨がそろっていません`);
    this.template = tpl;
    this.baked?.texture.dispose();
    this.baked = null;
    this.skeletonId = id;
    this.rebuild();
    this.revision++;
  }

  setMode(mode: LabMode): void {
    this.mode = mode;
    this.rebuild();
  }

  /** パラメータから兵士を作り直す */
  rebuild(): void {
    if (!this.template) return;
    this.clearSoldiers();
    if (this.mode === 'army') {
      this.buildArmy(this.template);
    } else {
      const n = this.mode === 'squad' ? SQUAD_SIZE : 1;
      const slots = squadFormation(n, { seed: this.params.seed });
      for (let i = 0; i < n; i++) {
        const params = n === 1 ? this.params : { ...this.params, seed: this.params.seed * 1000 + i };
        const s = buildSoldier(this.template, params);
        if (n > 1) {
          s.object.position.set(slots[i].x, 0, slots[i].z);
          s.object.rotation.y = slots[i].yaw;
        }
        this.group.add(s.object);
        this.units.push({ object: s.object, mesh: s.mesh, mixer: new THREE.AnimationMixer(s.object.model), phase: n > 1 ? (i * 0.37) % 1 : 0 });
        this.triangles += s.triangles;
      }
      this.soldierCount = n;
    }
    this.view.ground.visible = this.mode !== 'army';
    this.placeCompare();
    this.play();
  }

  private clearSoldiers(): void {
    for (const u of this.units) {
      u.mixer.stopAllAction();
      u.object.removeFromParent();
      u.mesh.skeleton.dispose();
    }
    // ジオメトリはバリアント間で共有していることがあるので、まとめて捨てる
    new Set(this.units.map((u) => u.mesh.geometry)).forEach((g) => g.dispose());
    this.units = [];
    this.crowd?.dispose();
    this.crowd = null;
    this.field?.removeFromParent();
    this.field = null;
    this.triangles = 0;
    this.soldierCount = 0;
  }

  // --- 大軍 ---

  private bakedFor(template: THREE.Object3D): BakedAnimations {
    const inputs = [...this.clips].map(([name, clip]) => ({ name, clip }));
    // モーションがひとつもなければ基準姿勢のまま立たせる
    if (inputs.length === 0) inputs.push({ name: 'rest', clip: new THREE.AnimationClip('rest', 1, []) });
    return (this.baked ??= bakeAnimations(template, inputs));
  }

  private buildArmy(template: THREE.Object3D): void {
    const a = this.army;
    const sides = [
      { params: this.params, facing: 0 },
      { params: { ...this.params, ...ENEMY, teamColor: this.params.teamColor === ENEMY.teamColor ? 0x2f5fa8 : ENEMY.teamColor! }, facing: Math.PI },
    ];
    // 兵種 × バリアントのジオメトリ（seed だけ変える）
    const geos = sides.flatMap((side, si) =>
      Array.from({ length: a.variants }, (_, k) => buildSoldierGeometry(template, { ...side.params, seed: this.params.seed * 100 + si * 17 + k })),
    );
    const transform = geos[0].transform;
    const cells = armyCells(a.squadsPerSide);
    const clipNames = [...this.clips.keys()];
    const loopClips = clipNames.filter((n) => !NON_LOOP_RE.test(n));
    const rnd = mulberry(this.params.seed);

    if (a.render === 'instanced') {
      const baked = this.bakedFor(template);
      // 部隊ごとに見た目の種類を順に割り当てるので、1 種類あたり 1 部隊で最大 ceil(人数 / 種類数)
      const capacity = a.squadsPerSide * Math.ceil(a.perSquad / a.variants);
      this.crowd = new Crowd(
        baked,
        geos.map((g) => g.geometry),
        transform,
        capacity,
      );
      this.group.add(this.crowd.object);
    }

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    sides.forEach((side, si) => {
      const team = new THREE.Color(side.params.teamColor);
      cells[si].forEach((cell, sq) => {
        // 部隊ごとにモーションを決める（ばらばらのときは 7 割をループするものから、3 割を倒れるものも含む全体から）
        const pool = rnd() < 0.7 && loopClips.length > 0 ? loopClips : clipNames;
        const clip = a.clip || pool[Math.floor(rnd() * pool.length)] || '';
        const duration = this.clips.get(clip)?.duration ?? 1;
        const slots = squadFormation(a.perSquad, { seed: si * 1000 + sq + 1 });
        slots.forEach((slot, i) => {
          const cos = Math.cos(side.facing);
          const sin = Math.sin(side.facing);
          pos.set(cell.x + slot.x * cos + slot.z * sin, 0, cell.z - slot.x * sin + slot.z * cos);
          q.setFromAxisAngle(up, side.facing + slot.yaw);
          m.compose(pos, q, one);
          const variant = si * a.variants + ((sq * 7 + i) % a.variants);
          const nonLoop = NON_LOOP_RE.test(clip);
          // ループするものは位相をずらし、倒れるものは倒れ始める時刻をずらす
          const startTime = nonLoop ? this.time + rnd() * 2 : this.time - rnd() * duration;
          const speed = 0.9 + rnd() * 0.2;
          if (this.crowd) {
            this.crowd.add(variant, { matrix: m, team, clip, startTime, speed });
          } else {
            const g = geos[variant];
            const s = instantiateSoldier(template, g.geometry, transform);
            s.object.position.copy(pos);
            s.object.quaternion.copy(q);
            this.group.add(s.object);
            this.units.push({ object: s.object, mesh: s.mesh, mixer: new THREE.AnimationMixer(s.object.model), phase: rnd(), clip, speed });
          }
          this.triangles += geos[variant].triangles;
        });
      });
    });
    this.soldierCount = a.squadsPerSide * 2 * a.perSquad;
    this.field = createField(cells.flat());
    this.group.add(this.field);
  }

  // --- 再生 ---

  setClip(name: string): void {
    this.clipName = name;
    this.play();
  }

  private play(): void {
    const start = (mixer: THREE.AnimationMixer, clipName: string, phase: number, speed = 1) => {
      mixer.stopAllAction();
      const clip = this.clips.get(clipName);
      if (!clip) return;
      const action = mixer.clipAction(clip);
      if (NON_LOOP_RE.test(clipName)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      action.timeScale = speed;
      action.reset().play();
      action.time = phase * clip.duration;
    };
    for (const u of this.units) start(u.mixer, u.clip ?? this.clipName, u.clip && NON_LOOP_RE.test(u.clip) ? 0 : u.phase, u.speed);
    if (this.compare) start(this.compare.mixer, this.clipName, 0);
  }

  async setCompare(id: string): Promise<void> {
    if (this.compare) {
      this.compare.mixer.stopAllAction();
      this.compare.asset.object.removeFromParent();
      this.compare = null;
    }
    this.compareId = id;
    if (!id) return;
    // Mixamo 以外の骨格ならモーションは再生されない
    const entry = this.compareCandidates.find((e) => e.id === id);
    if (!entry) return;
    const asset = await loadSourceAsset(entry, SOURCES_URL);
    asset.object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    this.compare = { asset, mixer: new THREE.AnimationMixer(asset.object.model) };
    this.group.add(asset.object);
    this.placeCompare();
    this.play();
  }

  private placeCompare(): void {
    if (!this.compare) return;
    this.compare.asset.object.visible = this.mode !== 'army';
    const S = UNITS.soldierHeight;
    this.compare.asset.object.position.set(this.mode === 'squad' ? S * 4 : S * 1.6, 0, 0);
  }

  update(dt: number): void {
    const d = dt * this.speed;
    this.time += d;
    this.crowd?.setTime(this.time);
    for (const u of this.units) u.mixer.update(d);
    this.compare?.mixer.update(d);
  }

  // --- カメラ ---

  /** 1 体に寄る */
  frameClose(): void {
    const box = new THREE.Box3();
    if (this.units[0]) box.setFromObject(this.units[0].object);
    else box.setFromCenterAndSize(new THREE.Vector3(0, UNITS.soldierHeight / 2, 0), new THREE.Vector3().setScalar(UNITS.soldierHeight));
    this.view.frame(box);
  }

  /**
   * 戦闘中に見る距離から見下ろす。
   * 画面の縦が dist×0.69 ほどの範囲になる（fov 38°）。dist = 5 なら HEX がおよそ 2 つ並ぶくらい
   */
  battleView(dist: number): void {
    const target = new THREE.Vector3(0, UNITS.soldierHeight / 2, 0);
    const pitch = THREE.MathUtils.degToRad(52);
    this.view.controls.target.copy(target);
    const dir = new THREE.Vector3(0.2, Math.sin(pitch), Math.cos(pitch)).normalize();
    this.view.camera.position.copy(target).addScaledVector(dir, dist);
    this.view.controls.update();
    this.view.setShadowRange(this.mode === 'army' ? Math.max(3, Math.sqrt(this.army.squadsPerSide) * 2.2) : 1.2);
  }

  dispose(): void {
    this.clearSoldiers();
    this.baked?.texture.dispose();
    this.baked = null;
    if (this.compare) this.compare.mixer.stopAllAction();
    this.compare = null;
    this.view.ground.visible = true;
    this.group.removeFromParent();
    this.group.clear();
  }
}

interface Cell {
  x: number;
  z: number;
}

/** HEX（flat-top、hexSize = 1）の中心。味方は手前（-Z 側）、敵は奥（+Z 側）から、中央に近い順 */
function armyCells(perSide: number): [Cell[], Cell[]] {
  const cells: Cell[] = [];
  const R = Math.ceil(Math.sqrt(perSide)) + 3;
  for (let q = -R; q <= R; q++) {
    for (let r = -R; r <= R; r++) {
      if (Math.abs(q + r) > R) continue;
      cells.push({ x: 1.5 * q, z: SQRT3 * (r + q / 2) });
    }
  }
  const byDist = (a: Cell, b: Cell) => Math.abs(a.z) + Math.abs(a.x) * 0.5 - (Math.abs(b.z) + Math.abs(b.x) * 0.5);
  return [cells.filter((c) => c.z < -0.1).sort(byDist).slice(0, perSide), cells.filter((c) => c.z > 0.1).sort(byDist).slice(0, perSide)];
}

/** 部隊を置いた HEX を含む範囲の地面と HEX の線 */
function createField(cells: Cell[]): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'army-field';
  let extent = 2;
  const pts: number[] = [];
  const centers: Cell[] = [];
  for (const c of cells) extent = Math.max(extent, Math.abs(c.x) + 2, Math.abs(c.z) + 2);
  const R = Math.ceil(extent / 1.5) + 1;
  for (let q = -R; q <= R; q++) {
    for (let r = -R; r <= R; r++) {
      const x = 1.5 * q;
      const z = SQRT3 * (r + q / 2);
      if (Math.abs(x) <= extent && Math.abs(z) <= extent) centers.push({ x, z });
    }
  }
  for (const c of centers) {
    for (let i = 0; i < 6; i++) {
      const a0 = (i * Math.PI) / 3;
      const a1 = ((i + 1) * Math.PI) / 3;
      pts.push(c.x + Math.cos(a0), 0.002, c.z + Math.sin(a0), c.x + Math.cos(a1), 0.002, c.z + Math.sin(a1));
    }
  }
  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
    new THREE.LineBasicMaterial({ color: 0x2a2418, transparent: true, opacity: 0.35 }),
  );
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(extent * 2 + 2, extent * 2 + 2).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x8a9a5b, roughness: 1 }),
  );
  ground.receiveShadow = true;
  g.add(ground, lines);
  return g;
}

function mulberry(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
