import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addOutlineAttributes, cutFromConcavity } from './outline-attrs';

/** x 方向に 2n 分割・z 方向に 2n 分割の高さ場。height(x) で y を決める。seam=true なら x=0 の列を左右で複製する */
function heightField(height: (x: number) => number, seam = false): THREE.BufferGeometry {
  const n = 4, step = 0.1;
  const verts: number[] = [];
  const index: number[] = [];
  const vid = new Map<string, number>();
  const add = (ix: number, iz: number, side: number): number => {
    const key = `${ix},${iz},${ix === 0 && seam ? side : 0}`;
    const hit = vid.get(key);
    if (hit !== undefined) return hit;
    const x = ix * step, z = iz * step;
    verts.push(x, height(x), z);
    const id = verts.length / 3 - 1;
    vid.set(key, id);
    return id;
  };
  for (let ix = -n; ix < n; ix++) {
    for (let iz = -n; iz < n; iz++) {
      const side = ix < 0 ? -1 : 1; // この四角形が x=0 の左右どちら側か
      const a = add(ix, iz, side), b = add(ix + 1, iz, side), c = add(ix + 1, iz + 1, side), d = add(ix, iz + 1, side);
      index.push(a, d, b, b, d, c); // 上向き（+y）の面
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

function cutAt(geo: THREE.BufferGeometry, x: number, z: number): number {
  const pos = geo.getAttribute('position');
  const cut = geo.getAttribute('aOutlineCut');
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getX(i) - x) < 1e-4 && Math.abs(pos.getZ(i) - z) < 1e-4) return cut.getX(i);
  }
  throw new Error('頂点が見つからない');
}

describe('addOutlineAttributes', () => {
  it('凹んだ溝（V 字の谷）の底は輪郭線を削り、凸の尾根と平面は削らない', () => {
    const valley = heightField((x) => 1.0 * Math.abs(x));
    addOutlineAttributes(valley);
    expect(cutAt(valley, 0, 0)).toBeGreaterThan(0.5);

    const ridge = heightField((x) => -1.0 * Math.abs(x));
    addOutlineAttributes(ridge);
    expect(cutAt(ridge, 0, 0)).toBe(0);

    const flat = heightField(() => 0);
    addOutlineAttributes(flat);
    expect(cutAt(flat, 0, 0)).toBe(0);
  });

  it('UV の継ぎ目で複製された頂点は、同じ押し出し法線・同じ削り量になる（輪郭線に隙間が開かない）', () => {
    const geo = heightField((x) => 1.0 * Math.abs(x), true);
    addOutlineAttributes(geo);
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('aONormal');
    const cut = geo.getAttribute('aOutlineCut');
    const seen = new Map<string, number>();
    let dup = 0;
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
      const j = seen.get(key);
      if (j === undefined) {
        seen.set(key, i);
        continue;
      }
      dup++;
      expect(nor.getX(i)).toBeCloseTo(nor.getX(j), 5);
      expect(nor.getY(i)).toBeCloseTo(nor.getY(j), 5);
      expect(nor.getZ(i)).toBeCloseTo(nor.getZ(j), 5);
      expect(cut.getX(i)).toBeCloseTo(cut.getX(j), 5);
    }
    expect(dup).toBeGreaterThan(0); // 複製が実際に存在すること
  });

  it('押し出し法線は単位ベクトル', () => {
    const geo = heightField((x) => 1.0 * Math.abs(x));
    addOutlineAttributes(geo);
    const nor = geo.getAttribute('aONormal');
    for (let i = 0; i < nor.count; i++) {
      expect(Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i))).toBeCloseTo(1, 4);
    }
  });
});

describe('cutFromConcavity', () => {
  it('start 以下で 0、full 以上で 1、間は単調', () => {
    expect(cutFromConcavity(0, 0.1, 0.3)).toBe(0);
    expect(cutFromConcavity(0.1, 0.1, 0.3)).toBe(0);
    expect(cutFromConcavity(0.3, 0.1, 0.3)).toBe(1);
    expect(cutFromConcavity(1, 0.1, 0.3)).toBe(1);
    expect(cutFromConcavity(0.15, 0.1, 0.3)).toBeLessThan(cutFromConcavity(0.2, 0.1, 0.3));
  });
});
