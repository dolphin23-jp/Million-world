import { describe, expect, it } from 'vitest';
import { STEP_UP, World, createRayHit, type Obstacle } from './world';

const R = 14;
const circle = (x: number, z: number, r: number, top: number): Obstacle => ({ kind: 'circle', x, z, r, top });
const box = (x: number, z: number, hx: number, hz: number, yaw: number, top: number): Obstacle => ({ kind: 'box', x, z, hx, hz, yaw, top });
const world = (...obstacles: Obstacle[]): World => new World({ radius: R, obstacles });

describe('World: 境界', () => {
  it('contains は境界の円の中か。clampBounds は体の半径を引いた円の内側へ収める', () => {
    const w = world();
    expect(w.contains(0, 0)).toBe(true);
    expect(w.contains(13.9, 0)).toBe(true);
    expect(w.contains(14.1, 0)).toBe(false);
    const c = { x: 20, z: 0, r: 0.5 };
    expect(w.clampBounds(c)).toBe(true);
    expect(c.x).toBeCloseTo(13.5);
    expect(w.clampBounds(c)).toBe(false);
  });
});

describe('World.moveCircle: 体の押し出し', () => {
  it('円柱: 重なった体は、中心を結ぶ向きへ半径の和だけ離れるまで押し出される。離れていれば動かない', () => {
    const w = world(circle(5, 0, 1, 3));
    const c = { x: 4.2, z: 0, r: 0.5 };
    expect(w.moveCircle(c)).toBe(true);
    expect(c.x).toBeCloseTo(3.5); // 5 − (1 + 0.5)
    expect(c.z).toBeCloseTo(0);
    const far = { x: 0, z: 0, r: 0.5 };
    expect(w.moveCircle(far)).toBe(false);
    expect(far).toEqual({ x: 0, z: 0, r: 0.5 });
  });

  it('円柱のまわりをなぞるように進むと、ぶつかった分だけ外へ押されて滑る（めり込まず、柱の向こう側へ抜ける）', () => {
    const w = world(circle(0, 5, 1, 3));
    const c = { x: -3, z: 5.3, r: 0.5 }; // 柱の中心から少しずらして横切る
    let minD = Infinity;
    for (let i = 0; i < 160; i++) {
      c.x += 0.05;
      w.moveCircle(c);
      minD = Math.min(minD, Math.hypot(c.x - 0, c.z - 5));
    }
    expect(minD).toBeGreaterThanOrEqual(1.5 - 1e-6);
    expect(c.x).toBeGreaterThan(1);
  });

  it('真正面から押しても、柱にめり込まない（滑る向きが無いので、その場で止まる）', () => {
    const w = world(circle(0, 5, 1, 3));
    const c = { x: -3, z: 5, r: 0.5 };
    for (let i = 0; i < 120; i++) {
      c.x += 0.05;
      w.moveCircle(c);
    }
    expect(Math.hypot(c.x, c.z - 5)).toBeGreaterThanOrEqual(1.5 - 1e-6);
  });

  it('箱: 面に向かって押すと面の外へ出る。角では丸く押し出される。箱の向き（yaw）に従う', () => {
    const w = world(box(0, 5, 2, 0.5, 0, 1.5));
    const front = { x: 0, z: 4.2, r: 0.5 }; // −z の面（z = 4.5）から 0.3 手前 → 重なる（半径 0.5）
    expect(w.moveCircle(front)).toBe(true);
    expect(front.z).toBeCloseTo(4.0);
    const side = { x: 2.3, z: 5, r: 0.5 }; // +x の面（x = 2）の外から 0.3 → 重なる
    expect(w.moveCircle(side)).toBe(true);
    expect(side.x).toBeCloseTo(2.5);
    const corner = { x: 2.2, z: 4.4, r: 0.5 }; // 角（2, 4.5）の外側
    expect(w.moveCircle(corner)).toBe(true);
    expect(Math.hypot(corner.x - 2, corner.z - 4.5)).toBeCloseTo(0.5, 5);
    // 90° 回した箱は、長い辺が z 方向を向く
    const turned = world(box(0, 5, 2, 0.5, Math.PI / 2, 1.5));
    const t = { x: 0, z: 7.3, r: 0.5 };
    expect(turned.moveCircle(t)).toBe(true);
    expect(t.z).toBeCloseTo(7.5); // 長い辺の端 5 + 2 の外へ 0.5
  });

  it('中心が箱の中にあっても、いちばん近い面から外へ出る', () => {
    const w = world(box(0, 5, 2, 1, 0, 1.5));
    const c = { x: 1.5, z: 5, r: 0.5 };
    expect(w.moveCircle(c)).toBe(true);
    expect(c.x).toBeCloseTo(2.5);
  });

  it('足の高さ y: 上面が y + STEP_UP 以下の障害物は体を止めない（段差は乗れる）。高い障害物は止める', () => {
    const w = world(circle(5, 0, 1, 0.4), circle(0, 5, 1, 1.5));
    const low = { x: 4.8, z: 0, r: 0.5 };
    expect(w.moveCircle(low, 0)).toBe(false); // 上面 0.4 ≤ 0 + STEP_UP
    const high = { x: 0, z: 4.8, r: 0.5 };
    expect(w.moveCircle(high, 0)).toBe(true);
    // 高さ 1.2 まで跳んでいれば、上面 1.5 の障害物（1.5 ≤ 1.2 + 0.45）も止めない
    const jumping = { x: 0, z: 4.8, r: 0.5 };
    expect(w.moveCircle(jumping, 1.2)).toBe(false);
    expect(STEP_UP).toBeGreaterThan(0);
  });

  it('並んだ障害物のあいだの、体が通れる幅の通路は通れる。体より狭い隙間には入れない', () => {
    const wide = world(circle(0, 5, 1, 3), circle(3.2, 5, 1, 3)); // 隙間 1.2m（体の直径 0.8m より広い）
    const c = { x: 1.6, z: 2, r: 0.4 };
    for (let i = 0; i < 200; i++) {
      c.z += 0.05;
      wide.moveCircle(c);
    }
    expect(c.z).toBeGreaterThan(8);
    const narrow = world(circle(0, 5, 1, 3), circle(2.6, 5, 1, 3)); // 隙間 0.6m（体より狭い）
    const d = { x: 1.3, z: 2, r: 0.4 };
    for (let i = 0; i < 200; i++) {
      d.z += 0.05;
      narrow.moveCircle(d);
    }
    expect(d.z).toBeLessThan(5);
  });

  it('境界の外へも出ない（障害物に押し出されたあとも境界の内側）', () => {
    const w = world(circle(13, 0, 1, 3));
    const c = { x: 12.6, z: 0, r: 0.5 };
    w.moveCircle(c);
    expect(Math.hypot(c.x, c.z)).toBeLessThanOrEqual(R - 0.5 + 1e-6);
  });

  it('overlapsObstacle は動かさずに、重なっているかだけ答える', () => {
    const w = world(circle(5, 0, 1, 3), box(0, 6, 1, 1, 0.3, 2));
    expect(w.overlapsObstacle({ x: 4.5, z: 0, r: 0.5 })).toBe(true);
    expect(w.overlapsObstacle({ x: 0, z: 0, r: 0.5 })).toBe(false);
    expect(w.overlapsObstacle({ x: 0, z: 6, r: 0.3 })).toBe(true);
    // 低い障害物は、足の高さが十分なら重なりに数えない
    const low = world(circle(5, 0, 1, 0.3));
    expect(low.overlapsObstacle({ x: 5, z: 0, r: 0.5 }, 0)).toBe(false);
  });
});

describe('World.raycast / lineOfSight: 弾・視線の遮り', () => {
  const hit = createRayHit();

  it('円柱: 手前の面に当たる。当たった点・法線（外向き）・t が正しい。外れる線・届かない線は当たらない', () => {
    const w = world(circle(0, 5, 1, 4));
    expect(w.raycast(0, 0, 0, 10, 1.1, hit)).toBe(true);
    expect(hit.t).toBeCloseTo(0.4);
    expect(hit.x).toBeCloseTo(0);
    expect(hit.z).toBeCloseTo(4);
    expect(hit.nx).toBeCloseTo(0);
    expect(hit.nz).toBeCloseTo(-1);
    expect(hit.index).toBe(0);
    expect(w.raycast(2, 0, 2, 10, 1.1, hit)).toBe(false); // 柱の脇
    expect(w.raycast(0, 0, 0, 3, 1.1, hit)).toBe(false); // 届かない
    expect(w.raycast(0, 10, 0, 0, 1.1, hit)).toBe(true); // 逆向きなら奥の面
    expect(hit.z).toBeCloseTo(6);
    expect(hit.nz).toBeCloseTo(1);
  });

  it('箱: 面に当たり、面の外向きの法線が出る（yaw を回した箱も）', () => {
    const w = world(box(0, 5, 2, 0.5, 0, 2));
    expect(w.raycast(1, 0, 1, 10, 1.1, hit)).toBe(true);
    expect(hit.z).toBeCloseTo(4.5);
    expect(hit.nz).toBeCloseTo(-1);
    expect(w.raycast(5, 5, 0, 5, 1.1, hit)).toBe(true); // 横から
    expect(hit.x).toBeCloseTo(2);
    expect(hit.nx).toBeCloseTo(1);
    expect(w.raycast(3, 0, 3, 10, 1.1, hit)).toBe(false); // 箱の外を通る
    const turned = world(box(0, 5, 2, 0.5, Math.PI / 2, 2));
    expect(turned.raycast(0, 0, 0, 10, 1.1, hit)).toBe(true);
    expect(hit.z).toBeCloseTo(3); // 長い辺（半分 2）が z 方向: 手前の端は 5 − 2
    expect(hit.nz).toBeCloseTo(-1);
  });

  it('高さ y: 上面が y 以下の障害物は遮らない（低い岩の上は飛び越える）。始点が障害物の中なら t = 0', () => {
    const w = world(circle(0, 5, 1, 0.8), circle(0, 9, 1, 3));
    expect(w.raycast(0, 0, 0, 7, 1.1, hit)).toBe(false); // 岩（上面 0.8）の上を通る
    expect(w.raycast(0, 0, 0, 7, 0.5, hit)).toBe(true); // 低い線は岩に当たる
    expect(hit.z).toBeCloseTo(4);
    expect(w.raycast(0, 9, 0, 14, 1.1, hit)).toBe(true); // 始点が柱の中
    expect(hit.t).toBe(0);
  });

  it('複数の障害物では、最初に当たるものを返す。lineOfSight は遮りが無いか', () => {
    const w = world(circle(0, 8, 1, 3), circle(0, 4, 1, 3));
    expect(w.raycast(0, 0, 0, 12, 1.1, hit)).toBe(true);
    expect(hit.z).toBeCloseTo(3);
    expect(hit.index).toBe(1);
    expect(w.lineOfSight(0, 0, 0, 2.5, 1.1)).toBe(true);
    expect(w.lineOfSight(0, 0, 0, 12, 1.1)).toBe(false);
    expect(w.lineOfSight(0, 0, 5, 0, 1.1)).toBe(true);
  });

  it('障害物が無い世界は何も遮らない。結果の out は当たったときだけ書き換わる', () => {
    const w = world();
    const h = createRayHit();
    h.t = 7;
    expect(w.raycast(0, 0, 10, 10, 1, h)).toBe(false);
    expect(h.t).toBe(7);
  });
});
