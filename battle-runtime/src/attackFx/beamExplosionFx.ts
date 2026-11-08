/** 光線が通った HEX から立ち上がる火球と煙。4×4 の連続画像を一度だけ再生する。 */
import * as THREE from 'three';
import { FX_RENDER_ORDER, FX_VERTEX } from './fxShared';

const EXPLOSION_SEC = 1.3;
const FRAME_COUNT = 16;
/** 画像内の接地点（上からの割合）。全コマ共通で足元を固定する。 */
const GROUND_ANCHOR = 0.885;

let explosionTexture: THREE.Texture | undefined;
function getExplosionTexture(): THREE.Texture {
  if (!explosionTexture) {
    explosionTexture = new THREE.TextureLoader().load(
      new URL('../../../assets/fx/beam-explosion.webp', import.meta.url).href,
    );
    explosionTexture.colorSpace = THREE.SRGBColorSpace;
    // 縮小時に隣のコマが混ざらないよう、アトラスの mipmap は作らない。
    explosionTexture.generateMipmaps = false;
    explosionTexture.minFilter = THREE.LinearFilter;
  }
  return explosionTexture;
}

interface Explosion {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  start: number;
}

export class BeamExplosionEffects {
  readonly group = new THREE.Group();
  private readonly plane = new THREE.PlaneGeometry(1, 1).translate(0, GROUND_ANCHOR - 0.5, 0);
  // 初回の光線より前に読み込み、複数の HEX・戦闘画面でも共有する。
  private readonly texture = getExplosionTexture();
  private items: Explosion[] = [];

  constructor() {
    this.group.name = 'beam-explosions';
  }

  /** start は光線が通過した時刻から求める。低 FPS でも爆発の時間差を保つ。 */
  spawn(at: THREE.Vector3, hexSize: number, start: number): void {
    const material = createExplosionMaterial(this.texture);
    material.uniforms.uFlip.value = Math.random() < 0.5 ? 0 : 1;
    const mesh = new THREE.Mesh(this.plane, material);
    mesh.position.copy(at).add(new THREE.Vector3(0, hexSize * 0.03, 0));
    const size = hexSize * (0.9 + Math.random() * 0.2);
    mesh.scale.set(2.3 * size, 3.1 * size, 1);
    mesh.renderOrder = FX_RENDER_ORDER + 1;
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.group.add(mesh);
    this.items.push({ mesh, start });
  }

  update(camera: THREE.Camera): void {
    const now = performance.now();
    this.items = this.items.filter((item) => {
      const age = (now - item.start) / 1000;
      if (age >= EXPLOSION_SEC) {
        this.dispose(item);
        return false;
      }
      item.mesh.visible = age >= 0;
      if (age < 0) return true;
      item.mesh.quaternion.copy(camera.quaternion);
      const progress = age / EXPLOSION_SEC;
      const u = item.mesh.material.uniforms;
      u.uFrame.value = progress * (FRAME_COUNT - 1);
      // 最終コマに残る煙も、最後に滑らかに消す。
      u.uOpacity.value = 1 - THREE.MathUtils.smoothstep(progress, 0.78, 1);
      return true;
    });
  }

  clear(): void {
    for (const item of this.items) this.dispose(item);
    this.items = [];
  }

  private dispose(item: Explosion): void {
    this.group.remove(item.mesh);
    item.mesh.material.dispose();
  }
}

function createExplosionMaterial(texture: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: texture }, uFrame: { value: 0 }, uOpacity: { value: 1 }, uFlip: { value: 0 } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // 加算では黒煙が消えるため通常の透過合成。重なる煙はカメラから遠い順に描く。
    blending: THREE.NormalBlending,
    premultipliedAlpha: true,
    toneMapped: false,
    vertexShader: FX_VERTEX,
    fragmentShader: /* glsl */ `
uniform sampler2D uMap;
uniform float uFrame;
uniform float uOpacity;
uniform float uFlip;
varying vec2 vUv;

vec4 frameAt(float index) {
  vec2 cell = vec2(mod(index, 4.0), 3.0 - floor(index / 4.0));
  vec2 uv = vec2(mix(vUv.x, 1.0 - vUv.x, uFlip), vUv.y);
  // 各セルの透明な余白内までに制限し、隣のコマを拾わない。
  uv = clamp(uv, vec2(0.5 / 256.0), vec2(1.0 - 0.5 / 256.0));
  vec4 texel = texture2D(uMap, (cell + uv) / 4.0);
  return vec4(texel.rgb * texel.a, texel.a);
}

void main() {
  float index = floor(uFrame);
  // alpha を掛けてから補間し、コマの切り替わりで黒い縁が出るのを防ぐ。
  vec4 color = mix(frameAt(index), frameAt(min(index + 1.0, 15.0)), fract(uFrame));
  gl_FragColor = vec4(color.rgb / max(color.a, 0.0001), color.a * uOpacity);
  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
}`,
  });
}
