/**
 * TerrainData（純粋データ）→ three.js のメッシュ群。
 */
import * as THREE from 'three';
import type { TerrainData } from '../core/terrainGen';
import type { HexOverlay } from './hexOverlay';

export interface TerrainMeshes {
  group: THREE.Group;
  terrain: THREE.Mesh;
  water: THREE.Mesh;
  dispose(): void;
}

export function buildTerrainMeshes(data: TerrainData, overlay: HexOverlay): TerrainMeshes {
  const group = new THREE.Group();

  const terrain = new THREE.Mesh(buildTerrainGeometry(data), createTerrainMaterial(overlay));
  terrain.castShadow = true;
  terrain.receiveShadow = true;
  terrain.name = 'terrain';
  group.add(terrain);

  const water = buildWater(data, overlay);
  group.add(water);

  overlay.uniforms.uWaterLevel.value = data.waterLevel;

  return {
    group,
    terrain,
    water,
    dispose() {
      disposeObject(group);
    },
  };
}

function buildTerrainGeometry(d: TerrainData): THREE.BufferGeometry {
  const { nx, nz, minX, minZ, step, heights, normals, colors } = d;
  const N = nx * nz;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const c = new THREE.Color();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      pos[k * 3] = minX + i * step;
      pos[k * 3 + 1] = heights[k];
      pos[k * 3 + 2] = minZ + j * step;
      c.setRGB(colors[k * 3], colors[k * 3 + 1], colors[k * 3 + 2], THREE.SRGBColorSpace);
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
    }
  }
  const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let p = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + nx;
      const cc = a + 1;
      const dd = b + 1;
      index[p++] = a;
      index[p++] = b;
      index[p++] = cc;
      index[p++] = cc;
      index[p++] = b;
      index[p++] = dd;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals.slice(), 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function createTerrainMaterial(overlay: HexOverlay): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  overlay.apply(m, { clipUnderwater: true, grain: true });
  return m;
}

function buildWater(d: TerrainData, overlay: HexOverlay): THREE.Mesh {
  const w = (d.nx - 1) * d.step;
  const h = (d.nz - 1) * d.step;
  const g = new THREE.PlaneGeometry(w, h, 1, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(d.minX + w / 2, d.waterLevel, d.minZ + h / 2);
  const m = new THREE.MeshStandardMaterial({
    color: 0x2c6f96,
    roughness: 0.18,
    metalness: 0.05,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  overlay.apply(m, { water: true });
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.name = 'water';
  return mesh;
}

/** Object3D 以下のジオメトリとマテリアルを解放する */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
      o.customDepthMaterial?.dispose();
    }
  });
}
