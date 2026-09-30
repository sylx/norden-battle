/**
 * プレビュー用のシーン。
 * 足元に HEX 1 マス（hexSize = 1）と細かいグリッド、正面（+Z）の矢印、大きさ比べ用の人形を置く。
 */
import { UNITS } from '@norden/asset-runtime';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class ViewerScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly sun: THREE.DirectionalLight;
  /** 大きさ比べ用の人形・矢印 */
  readonly references = new THREE.Group();
  /** プレビュー中のモデルを入れる */
  readonly stage = new THREE.Group();
  /** 足元の HEX 1 マスとグリッド */
  readonly ground = createGround();
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

    this.scene.background = new THREE.Color(0xaec6cf);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.002, 50);
    const S = UNITS.soldierHeight;
    this.camera.position.set(S * 3.5, S * 3, S * 5.5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 0.03;
    this.controls.maxDistance = 12;
    this.controls.target.set(0, S / 2, 0);

    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x4a4030, 1.1));
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.002;
    this.scene.add(this.sun, this.sun.target);
    this.setShadowRange(1);

    this.scene.add(this.ground, this.references, this.stage);
    this.references.add(createReferences());

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** 影の範囲（半径） */
  setShadowRange(r: number): void {
    this.sun.position.set(-r * 0.6, r * 1.4, r * 0.9);
    this.sun.target.position.set(0, 0, 0);
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = r * 0.05;
    cam.far = r * 4;
    cam.updateProjectionMatrix();
  }

  /** 箱が収まるようにカメラを寄せる */
  frame(box: THREE.Box3): void {
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.length() / 2, 0.02);
    const dist = r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.1;
    const dir = new THREE.Vector3(0.55, 0.45, 0.85).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.controls.update();
    this.setShadowRange(Math.max(r * 2, 0.3));
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

/** HEX 1 マス（flat-top、hexSize = 1）と、0.05 刻みのグリッド */
function createGround(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'ground';

  const hex = new THREE.Mesh(
    new THREE.CircleGeometry(1, 6).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x8a9a5b, roughness: 1 }),
  );
  hex.receiveShadow = true;
  hex.position.y = -0.0005;

  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 6 }, (_, i) => new THREE.Vector3(Math.cos((i * Math.PI) / 3), 0.0005, Math.sin((i * Math.PI) / 3))),
    ),
    new THREE.LineBasicMaterial({ color: 0x2a2418 }),
  );

  const grid = new THREE.GridHelper(2, 40, 0x4a5a30, 0x6f7d48);
  grid.position.y = 0.0002;
  const gm = grid.material as THREE.Material;
  gm.transparent = true;
  gm.opacity = 0.35;

  g.add(hex, outline, grid);
  return g;
}

/** 兵士（デフォルメ）・等身大の人・正面の矢印 */
function createReferences(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'references';
  const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, transparent: true, opacity: 0.55 });

  const S = UNITS.soldierHeight;
  const figure = (height: number, color: number, x: number) => {
    const r = height * 0.16;
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, height - r * 2, 4, 12), mat(color));
    m.position.set(x, height / 2, -S * 1.2);
    m.castShadow = true;
    return m;
  };
  g.add(figure(S, 0x3a6ea5, -S * 1.8), figure(UNITS.humanHeight, 0xa5553a, -S * 2.5));

  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.001, 0), S * 1.5, 0xd04030, S * 0.3, S * 0.18);
  arrow.name = 'forward';
  g.add(arrow);
  return g;
}
