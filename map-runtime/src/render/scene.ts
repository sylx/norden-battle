import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { ParchmentEffect } from './parchment';

/**
 * カメラの俯角（水平からの角度, 度）の初期値。
 * ユニットは 2D 画像で描くので、カメラは回転させずこの角度・北向きに固定する。
 * 画像はこの角度から見下ろした姿で描く。
 */
export const DEFAULT_CAMERA_PITCH = 50;

export class SceneContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  /** ポストプロセスをかけずに最後に重ねるシーン（ユニット） */
  readonly overlay = new THREE.Scene();
  readonly parchment = new ParchmentEffect();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: MapControls;
  readonly sun: THREE.DirectionalLight;
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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

    this.scene.add(new THREE.HemisphereLight(0xe8e4d8, 0x4a4030, 1.2));
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.3);
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

    this.sun.position.set(cx - r * 0.6, r * 1.2, cz - r * 0.9);
    this.sun.target.position.set(cx, 0, cz);
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.1;
    cam.far = r * 4;
    cam.updateProjectionMatrix();

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
    this.controls.update();
    const r = this.renderer;
    if (this.parchment.enabled) this.parchment.render(r, this.scene, this.camera);
    else r.render(this.scene, this.camera);
    r.autoClear = false;
    r.render(this.overlay, this.camera);
    r.autoClear = true;
  }
}
