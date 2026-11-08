/** 尖った岩が地面を突き破り、浮遊・落下して砕けるアーススパイク。 */
import * as THREE from 'three';
import { FX_RENDER_ORDER } from './fxShared';
import { createSpriteSheetMaterial } from './spriteSheetFx';
import { fxClock } from '../fxClock';

export const EARTH_SPIKE_SEC = 1.8;
/** 11 コマ目で岩が着地する。ダメージ・地形破壊・カメラの揺れをここに合わせる。 */
export const EARTH_SPIKE_HIT_SEC = EARTH_SPIKE_SEC * 10 / 15;
/** 縮小・余白追加後の画像内の接地点（上からの割合）。浮くのは岩だけで、土煙の足元は固定。 */
const GROUND_ANCHOR = 0.94;

let earthSpikeTexture: THREE.Texture | undefined;
function getEarthSpikeTexture(): THREE.Texture {
  if (!earthSpikeTexture) {
    earthSpikeTexture = new THREE.TextureLoader().load(
      new URL('../../../assets/fx/earth-spike.webp', import.meta.url).href,
    );
    earthSpikeTexture.colorSpace = THREE.SRGBColorSpace;
    earthSpikeTexture.generateMipmaps = false;
    earthSpikeTexture.minFilter = THREE.LinearFilter;
  }
  return earthSpikeTexture;
}

interface EarthSpike {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  start: number;
}

export class EarthSpikeEffects {
  readonly group = new THREE.Group();
  private readonly plane = new THREE.PlaneGeometry(1, 1).translate(0, GROUND_ANCHOR - 0.5, 0);
  private readonly texture = getEarthSpikeTexture();
  private items: EarthSpike[] = [];

  constructor() {
    this.group.name = 'earth-spikes';
  }

  spawn(at: THREE.Vector3, size: number): void {
    const material = createSpriteSheetMaterial(this.texture);
    material.uniforms.uFlip.value = Math.random() < 0.5 ? 0 : 1;
    const mesh = new THREE.Mesh(this.plane, material);
    mesh.position.copy(at).add(new THREE.Vector3(0, size * 0.03, 0));
    const s = size * (0.92 + Math.random() * 0.16);
    mesh.scale.set(2.5 * s, 3.3 * s, 1);
    mesh.renderOrder = FX_RENDER_ORDER + 1;
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.group.add(mesh);
    this.items.push({ mesh, start: fxClock.now() });
  }

  update(camera: THREE.Camera): void {
    if (this.items.length === 0) return;
    const now = fxClock.now();
    this.items = this.items.filter((item) => {
      const progress = (now - item.start) / (EARTH_SPIKE_SEC * 1000);
      if (progress >= 1) {
        this.dispose(item);
        return false;
      }
      item.mesh.visible = true;
      item.mesh.quaternion.copy(camera.quaternion);
      const u = item.mesh.material.uniforms;
      u.uFrame.value = progress * 15;
      // 落下・粉砕が済んでから、土煙と残った瓦礫を消す。
      u.uOpacity.value = 1 - THREE.MathUtils.smoothstep(progress, 0.8, 1);
      return true;
    });
  }

  clear(): void {
    for (const item of this.items) this.dispose(item);
    this.items = [];
  }

  private dispose(item: EarthSpike): void {
    this.group.remove(item.mesh);
    item.mesh.material.dispose();
  }
}
