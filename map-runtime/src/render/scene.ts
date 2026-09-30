import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { ParchmentEffect } from './parchment';

/**
 * カメラの俯角（水平からの角度, 度）の初期値。
 * ユニットは 2D 画像で描くので、カメラは回転させずこの角度・北向きに固定する。
 * 画像はこの角度から見下ろした姿で描く。
 */
export const DEFAULT_CAMERA_PITCH = 50;

/** 光源（木の板絵を焼くときも同じ光を使う） */
export const LIGHTS = {
  hemiSky: 0xe8e4d8,
  hemiGround: 0x4a4030,
  hemiIntensity: 1.2,
  sunColor: 0xfff1d6,
  sunIntensity: 2.3,
  /** 太陽の方向（地面から太陽へ。北西の上空） */
  sunDirection: new THREE.Vector3(-0.6, 1.2, -0.9).normalize(),
} as const;

/** 描画解像度（devicePixelRatio）の初期値。高 DPI の画面でも 2 倍までにする */
export const DEFAULT_PIXEL_RATIO = Math.min(window.devicePixelRatio, 2);

export class SceneContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  /** ポストプロセスをかけずに最後に重ねるシーン（ユニット） */
  readonly overlay = new THREE.Scene();
  readonly parchment = new ParchmentEffect();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: MapControls;
  readonly sun: THREE.DirectionalLight;
  /** 直近 1 秒の平均フレームレート */
  fps = 0;
  /**
   * シャドウマップを描く直前（true）と直後（false）に呼ばれる。
   * 影を落とすためだけのもの（板絵にした木の元の 3D モデル）をこの間だけ表示するのに使う
   */
  onShadowPass: (active: boolean) => void = () => {};
  private readonly container: HTMLElement;
  private fpsFrames = 0;
  /** シャドウマップだけを更新するときの描画先（本体の描画結果は捨てる） */
  private readonly shadowDummy = new THREE.WebGLRenderTarget(1, 1);
  private fpsStart = performance.now();

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(DEFAULT_PIXEL_RATIO);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // 影を落とすもの（地形・木・建物）は動かないので、シャドウマップは変更があったときだけ描き直す。
    // 木の風揺れは影には反映されなくなるが、揺れ幅が小さいので見た目はほぼ変わらない
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    // 空・遠景は霞んだ紙の色に溶かす
    const sky = new THREE.Color(0xc9bea3);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 60, 140);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    // 回転はさせない（パンとズームだけ）
    this.controls.enableRotate = false;
    this.controls.minAzimuthAngle = 0;
    this.controls.maxAzimuthAngle = 0;
    this.setPitch(DEFAULT_CAMERA_PITCH);
    this.controls.minDistance = 3;
    this.controls.maxDistance = 90;
    this.controls.screenSpacePanning = false;

    this.scene.add(new THREE.HemisphereLight(LIGHTS.hemiSky, LIGHTS.hemiGround, LIGHTS.hemiIntensity));
    this.sun = new THREE.DirectionalLight(LIGHTS.sunColor, LIGHTS.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** カメラの俯角（度）を変える。注視点と距離は保つ */
  setPitch(deg: number): void {
    const polar = THREE.MathUtils.degToRad(90 - deg);
    this.controls.minPolarAngle = polar;
    this.controls.maxPolarAngle = polar;
    this.controls.update();
  }

  /** ブラウザが使っている GPU の名前（ノート PC で内蔵 GPU が使われていないかの確認用） */
  get gpuName(): string {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  }

  /** 影を落とすもの・太陽が変わったら呼ぶ（次の描画でシャドウマップを描き直す） */
  invalidateShadows(): void {
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** false にするとシャドウマップを毎フレーム描き直す（木の影も風で揺れる） */
  get staticShadows(): boolean {
    return !this.renderer.shadowMap.autoUpdate;
  }

  set staticShadows(v: boolean) {
    this.renderer.shadowMap.autoUpdate = !v;
    this.invalidateShadows();
  }

  /** 描画解像度（CSS ピクセルあたりの描画ピクセル数）。下げると重い画面での負荷が大きく減る */
  get pixelRatio(): number {
    return this.renderer.getPixelRatio();
  }

  set pixelRatio(v: number) {
    this.renderer.setPixelRatio(v);
    this.resize();
  }

  get pitch(): number {
    return 90 - THREE.MathUtils.radToDeg(this.controls.maxPolarAngle);
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.parchment.setSize(buf.x, buf.y);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** マップ範囲に合わせてカメラ・影の範囲を調整する */
  fitTo(box: { minX: number; maxX: number; minZ: number; maxZ: number }, resetCamera: boolean): void {
    const cx = (box.minX + box.maxX) / 2;
    const cz = (box.minZ + box.maxZ) / 2;
    const w = box.maxX - box.minX;
    const d = box.maxZ - box.minZ;
    const r = Math.hypot(w, d) / 2;

    const sd = LIGHTS.sunDirection;
    const sl = r * Math.hypot(0.6, 1.2, 0.9);
    this.sun.position.set(cx + sd.x * sl, sd.y * sl, cz + sd.z * sl);
    this.sun.target.position.set(cx, 0, cz);
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.1;
    cam.far = r * 4;
    cam.updateProjectionMatrix();
    this.invalidateShadows();

    const fog = this.scene.fog as THREE.Fog;
    fog.near = r * 2.2;
    fog.far = r * 5;

    if (resetCamera) {
      this.controls.target.set(cx, 0, cz);
      const dist = Math.max(w, d) * 0.96;
      const pitch = THREE.MathUtils.degToRad(this.pitch);
      this.camera.position.set(cx, dist * Math.sin(pitch), cz + dist * Math.cos(pitch));
      this.controls.update();
    }
  }

  render(): void {
    this.fpsFrames++;
    const now = performance.now();
    if (now - this.fpsStart >= 1000) {
      this.fps = (this.fpsFrames * 1000) / (now - this.fpsStart);
      this.fpsFrames = 0;
      this.fpsStart = now;
    }
    this.controls.update();
    const r = this.renderer;
    const sm = r.shadowMap;
    if (sm.autoUpdate || sm.needsUpdate) this.renderShadows();
    // 本体の描画ではシャドウマップに触らない
    const autoUpdate = sm.autoUpdate;
    sm.autoUpdate = false;
    if (this.parchment.enabled) this.parchment.render(r, this.scene, this.camera);
    else r.render(this.scene, this.camera);
    r.autoClear = false;
    r.render(this.overlay, this.camera);
    r.autoClear = true;
    sm.autoUpdate = autoUpdate;
  }

  /** シャドウマップだけを描き直す（1×1 の捨てるターゲットに描くついでに更新させる） */
  private renderShadows(): void {
    const r = this.renderer;
    const sm = r.shadowMap;
    const autoUpdate = sm.autoUpdate;
    this.onShadowPass(true);
    sm.autoUpdate = false;
    sm.needsUpdate = true;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.shadowDummy);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prev);
    sm.autoUpdate = autoUpdate;
    this.onShadowPass(false);
  }
}
