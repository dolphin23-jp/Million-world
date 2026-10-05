import { describe, expect, it } from 'vitest';
import { ARENA_HAZARDS, ARENA_PROPS, ARENA_RADIUS, ARENA_WORLD } from './arena-props';
import { World, type Obstacle } from '../world';

/** 闘技場の配置の整合: 障害物どうしが重ならない・床の危険地帯が障害物の下に入らない・境界の内側・軸の上を空ける */

const footprintPoints = (o: Obstacle): [number, number][] => {
  const pts: [number, number][] = [];
  if (o.kind === 'circle') {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) for (const k of [0.3, 0.7, 0.98]) pts.push([o.x + Math.cos(a) * o.r * k, o.z + Math.sin(a) * o.r * k]);
    pts.push([o.x, o.z]);
  } else {
    const cs = Math.cos(o.yaw);
    const sn = Math.sin(o.yaw);
    for (let u = -o.hx * 0.98; u <= o.hx * 0.98; u += o.hx / 5) {
      for (let v = -o.hz * 0.98; v <= o.hz * 0.98; v += o.hz / 5) {
        // 局所 (u, v) → 世界（BoxObstacle の向きの約束: 局所 = 世界 × R。世界 = 局所 × Rᵀ）
        pts.push([o.x + u * cs + v * sn, o.z - u * sn + v * cs]);
      }
    }
  }
  return pts;
};

describe('闘技場の配置', () => {
  it('障害物どうしが重ならない（柱・岩・壁・箱・壇・木箱・樽。踏み込んだ点が別の障害物の中に入らない）', () => {
    const all = ARENA_PROPS.map((p) => p.obstacle);
    for (let i = 0; i < all.length; i++) {
      const others = new World({ radius: ARENA_RADIUS, obstacles: all.filter((_, j) => j !== i) });
      for (const [x, z] of footprintPoints(all[i]!)) {
        expect(others.overlapsObstacle({ x, z, r: 0.01 }, -1), `障害物 ${i}（${all[i]!.kind} ${all[i]!.x.toFixed(1)}, ${all[i]!.z.toFixed(1)}）`).toBe(false);
      }
    }
  });

  it('すべて境界（半径 14）の内側に収まる', () => {
    for (const p of ARENA_PROPS) {
      const o = p.obstacle;
      const reach = o.kind === 'circle' ? o.r : Math.hypot(o.hx, o.hz);
      expect(Math.hypot(o.x, o.z) + reach).toBeLessThan(ARENA_RADIUS);
    }
    for (const h of ARENA_HAZARDS) expect(Math.hypot(h.x, h.z) + h.r).toBeLessThan(ARENA_RADIUS);
  });

  it('壊せる物は、木箱・樽だけ（壊せる印と見た目の種類が合う）。体力・ドロップの確率が妥当', () => {
    for (const p of ARENA_PROPS) {
      const b = p.obstacle.breakable;
      expect(b !== undefined).toBe(p.style === 'crate' || p.style === 'barrel');
      if (!b) continue;
      expect(b.hp).toBeGreaterThan(0);
      for (const d of b.drops ?? []) {
        expect(d.chance).toBeGreaterThan(0);
        expect(d.chance).toBeLessThanOrEqual(1);
      }
    }
    expect(ARENA_PROPS.filter((p) => p.obstacle.breakable).length).toBeGreaterThanOrEqual(4);
  });

  it('床の危険地帯は、障害物の下に入らない（炎が箱の中で燃えない）。ロックして向かい合う縦・横の軸の上は空ける', () => {
    const w = new World(ARENA_WORLD);
    for (const h of ARENA_HAZARDS) {
      expect(w.overlapsObstacle({ x: h.x, z: h.z, r: h.r }, -1)).toBe(false);
      // 縦・横の軸（x = 0 / z = 0）から、半径の分だけ離れている
      expect(Math.abs(h.x)).toBeGreaterThan(h.r);
      expect(Math.abs(h.z)).toBeGreaterThan(h.r);
    }
    for (const p of ARENA_PROPS.filter((q) => q.obstacle.breakable)) {
      const o = p.obstacle;
      const reach = o.kind === 'circle' ? o.r : Math.hypot(o.hx, o.hz);
      expect(Math.min(Math.abs(o.x), Math.abs(o.z))).toBeGreaterThan(reach);
    }
  });

  it('出現の輪（半径 6m）に障害物が張り出していても、世界は出現できる点を持つ（任意の 24 方位で、半径 6m の点が少なくとも半分は障害物の外）', () => {
    const w = new World(ARENA_WORLD);
    let free = 0;
    for (let a = 0; a < 24; a++) {
      const th = (a / 24) * Math.PI * 2;
      if (!w.overlapsObstacle({ x: Math.cos(th) * 6, z: Math.sin(th) * 6, r: 0.5 }, 0)) free++;
    }
    expect(free).toBeGreaterThanOrEqual(12);
  });
});
