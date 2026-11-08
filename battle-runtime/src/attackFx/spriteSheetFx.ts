/** 4×4・16コマ（各256px、透明な余白付き）の画像を補間して描く、カメラ正対の板用の材質。 */
import * as THREE from 'three';
import { FX_VERTEX } from './fxShared';

export function createSpriteSheetMaterial(texture: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: texture }, uFrame: { value: 0 }, uOpacity: { value: 1 }, uFlip: { value: 0 } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // 岩や煙の色が残る通常の透過合成。重なる板はカメラから遠い順に描く。
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
