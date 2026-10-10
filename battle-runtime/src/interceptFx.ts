/**
 * 迎撃の構えのエフェクト。構えているユニットの足元に光の輪を敷く（地面に寝かせた板をシェーダで描く）。
 *
 * - 近接ユニット: 二重の輪の間を 6 枚の盾の板がゆっくり回る（守りを固めている）。
 * - 間接ユニット: 点線の輪の中を掃引の光が回る（射程を見張っている）。
 *
 * ユニットと同じく深度テストをせず、影より手前・絵より奥に描く。足元は毎フレーム絵の位置に合わせる（移動のアニメーションにも付いていく）。
 */
import * as THREE from 'three';
import type { UnitData } from '@norden/map-runtime/core/units';
import type { UnitPlacement } from '@norden/map-runtime/render/units';
import { COMBAT_DEFS } from './combat';
import type { UnitStatus } from './unitStatus';

/** 輪の半径（hexSize 比） */
const RADIUS = 0.9;
/** 地面から浮かせる量（hexSize 比） */
const LIFT = 0.01;
const COLOR = 0x7cc4ff;
/** ユニットの影（9）より手前、絵（10）より奥 */
const RENDER_ORDER = 9.5;

/** シェーダの模様（MODE）。Guard: 近接、Watch: 間接 */
const Mode = { Guard: 0, Watch: 1 } as const;
type Mode = (typeof Mode)[keyof typeof Mode];

export class InterceptEffects {
  readonly group = new THREE.Group();
  private readonly time: THREE.IUniform<number> = { value: 0 };
  private readonly geometry = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  private readonly materials = [createMaterial(Mode.Guard, this.time), createMaterial(Mode.Watch, this.time)];
  private readonly rings = new Map<UnitData, THREE.Mesh>();

  constructor() {
    this.group.name = 'intercept-fx';
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.clear();
    this.rings.clear();
    this.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }

  /** 毎フレーム、描画の前に呼ぶ。迎撃の構えのユニットの足元に輪を置き、構えていないユニットの輪を外す */
  update(placements: readonly UnitPlacement[], statuses: ReadonlyMap<UnitData, UnitStatus>, hexSize: number, visible: boolean): void {
    this.group.visible = visible;
    this.time.value = performance.now() / 1000;
    const shown = new Set<UnitData>();
    for (const p of placements) {
      if (!statuses.get(p.unit)?.intercepting) continue;
      shown.add(p.unit);
      let ring = this.rings.get(p.unit);
      if (!ring) {
        ring = new THREE.Mesh(this.geometry, this.materials[COMBAT_DEFS[p.unit.type].ranged ? Mode.Watch : Mode.Guard]);
        ring.renderOrder = RENDER_ORDER;
        ring.frustumCulled = false;
        this.group.add(ring);
        this.rings.set(p.unit, ring);
      }
      ring.position.set(p.foot.x, p.foot.y + LIFT * hexSize, p.foot.z);
      ring.scale.setScalar(RADIUS * hexSize);
    }
    for (const [unit, ring] of this.rings) {
      if (shown.has(unit)) continue;
      this.group.remove(ring);
      this.rings.delete(unit);
    }
  }
}

function createMaterial(mode: Mode, time: THREE.IUniform<number>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: time, uColor: { value: new THREE.Color(COLOR) } },
    defines: { MODE: mode },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
// 半径 c・太さ w の輪（縁は 1.5 ピクセルでぼかす）
float band(float r, float c, float w) {
  return 1.0 - smoothstep(w * 0.5, w * 0.5 + fwidth(r) * 1.5, abs(r - c));
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  // 0..1 の角度
  float a = atan(p.y, p.x) / 6.2831853 + 0.5;
  float pulse = 0.5 + 0.5 * sin(uTime * 3.0);
  float line;
  float fill;
#if MODE == 0
  // 二重の輪と、その間を回る 6 枚の盾の板。内側はうっすら明滅する
  line = max(band(r, 0.93, 0.05), band(r, 0.7, 0.025));
  float plate = step(fract(a * 6.0 + uTime * 0.12), 0.78);
  line = max(line, plate * band(r, 0.815, 0.12) * 0.8);
  fill = (1.0 - smoothstep(0.0, 0.93, r)) * 0.2 * (0.6 + 0.4 * pulse);
#else
  // 点線の輪（ゆっくり逆に回る）と、回る掃引の光（先が明るく、後ろへ尾を引く）
  float dash = step(fract(a * 28.0 - uTime * 0.25), 0.55);
  line = max(band(r, 0.93, 0.045) * dash, band(r, 0.6, 0.02) * 0.6);
  float sweep = pow(fract(a - uTime * 0.4), 6.0);
  fill = sweep * 0.55 * (1.0 - smoothstep(0.88, 0.93, r));
  line = max(line, sweep * band(r, 0.93, 0.045));
#endif
  float alpha = max(line * (0.75 + 0.25 * pulse), fill);
  // 線は明るく白寄りに、塗りは濃いめの色にして明るい地形の上でも見えるようにする
  vec3 col = mix(uColor * 0.45, mix(uColor, vec3(1.0), 0.35), clamp(line * 1.5, 0.0, 1.0));
  gl_FragColor = vec4(col, alpha);
}`,
  });
}
