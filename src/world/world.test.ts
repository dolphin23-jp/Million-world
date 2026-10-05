import { describe, expect, it } from 'vitest';
import { AIR_STEP_UP, STEP_UP, SUPPORT_RADIUS, World, createRayHit, type Obstacle } from './world';

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

describe('World.raycast の inflate: 体の幅つきの掃引（M7-4a）', () => {
  it('円柱: 半径 r の体が柱に触れずに通れる線だけが通る（柱の半径 + r の太さで調べる）', () => {
    const w = world(circle(5, 0, 1, 3));
    const out = createRayHit();
    // 中心の線が柱の中心から 1.3 離れて通る: 点（r = 0）なら当たらないが、r = 0.5 の体は柱（1.0）に触れる（1.3 < 1.5）
    expect(w.raycast(0, 1.3, 10, 1.3, 0, out)).toBe(false);
    expect(w.raycast(0, 1.3, 10, 1.3, 0, out, 0.5)).toBe(true);
    // 1.6 離れていれば r = 0.5 でも通れる（1.6 > 1.5）
    expect(w.raycast(0, 1.6, 10, 1.6, 0, out, 0.5)).toBe(false);
    // 当たった点は太らせた面（柱の中心から 1.5 の距離）の上で、法線は柱の中心から外向き
    expect(w.raycast(0, 0, 10, 0, 0, out, 0.5)).toBe(true);
    expect(out.x).toBeCloseTo(3.5);
    expect(out.nx).toBeCloseTo(-1);
  });

  it('箱: 半幅を r だけ太らせる。yaw を回した箱でも同じ。始点が太らせた箱の中なら t = 0', () => {
    const w = world(box(0, 5, 2, 0.3, 0, 0.9));
    const out = createRayHit();
    expect(w.raycast(2.4, 0, 2.4, 10, 0, out)).toBe(false); // 箱の端（2.0）の外 0.4 を通る: 点は通る
    expect(w.raycast(2.4, 0, 2.4, 10, 0, out, 0.5)).toBe(true); // r = 0.5 の体は触れる（2.4 < 2.5）
    expect(w.raycast(2.6, 0, 2.6, 10, 0, out, 0.5)).toBe(false);
    // 手前の面: 厚み（0.3）+ r の位置で止まる（z = 5 − 0.3 − 0.5）
    expect(w.raycast(0, 0, 0, 10, 0, out, 0.5)).toBe(true);
    expect(out.z).toBeCloseTo(4.2);
    expect(out.nz).toBeCloseTo(-1);
    expect(w.raycast(0, 4.6, 0, 10, 0, out, 0.5)).toBe(true);
    expect(out.t).toBe(0);
    const turned = world(box(0, 5, 2, 0.3, Math.PI / 2, 0.9)); // 長辺が z 方向
    expect(turned.raycast(0.7, 0, 0.7, 10, 0, out, 0.5)).toBe(true); // 短辺の半幅 0.3 + 0.5 = 0.8 より内側
    expect(turned.raycast(0.9, 0, 0.9, 10, 0, out, 0.5)).toBe(false);
  });

  it('inflate の既定は 0（従来どおり）。高さ y の扱いも同じ（上面が y 以下なら遮らない）', () => {
    const w = world(circle(5, 0, 1, 0.85));
    const out = createRayHit();
    expect(w.raycast(0, 0, 10, 0, 0, out)).toBe(true);
    expect(w.raycast(0, 0, 10, 0, 0.85, out, 0.5)).toBe(false);
  });
});

describe('World.groundHeight: 足場の高さ（M7-2）', () => {
  const flat = (x: number, z: number, hx: number, hz: number, top: number): Obstacle => box(x, z, hx, hz, 0, top);
  it('障害物が無ければ地面（0）。障害物の上なら、その上面の高さ', () => {
    expect(world().groundHeight(3, 3, 0)).toBe(0);
    const w = world(flat(0, 5, 2, 1, 0.9));
    expect(w.groundHeight(0, 5, 1.5)).toBeCloseTo(0.9); // 足が 1.5 の高さ（上から降りる）
    expect(w.groundHeight(0, 0, 1.5)).toBe(0); // 箱の外
  });

  it('足より高い障害物（立ちはだかる壁）は足場に数えない。上面が足の高さ + stepUp 以下のものだけ', () => {
    const w = world(flat(0, 5, 2, 1, 0.9));
    expect(w.groundHeight(0, 5, 0)).toBe(0); // 地面から見た 0.9 は壁（> STEP_UP）
    expect(w.groundHeight(0, 5, 0.9 - STEP_UP)).toBeCloseTo(0.9); // 足が 0.45 なら、段差として上がれる
    // 低い段差は地面からそのまま乗れる
    expect(world(circle(0, 5, 1, 0.3)).groundHeight(0, 5, 0)).toBeCloseTo(0.3);
  });

  it('stepUp を小さくする（空中）と、足よりそれ以上高い上面は足場にならない。縁の猶予（AIR_STEP_UP）以内なら足場', () => {
    const w = world(flat(0, 5, 2, 1, 0.9));
    expect(w.groundHeight(0, 5, 0.9 - AIR_STEP_UP + 0.01, AIR_STEP_UP)).toBeCloseTo(0.9);
    expect(w.groundHeight(0, 5, 0.9 - AIR_STEP_UP - 0.05, AIR_STEP_UP)).toBe(0);
  });

  it('縁から SUPPORT_RADIUS までは立てる（足が少しはみ出す）。それより外は足場がない', () => {
    const w = world(flat(0, 5, 2, 1, 0.9)); // z の範囲 4〜6
    expect(w.groundHeight(0, 6 + SUPPORT_RADIUS * 0.8, 1.5)).toBeCloseTo(0.9);
    expect(w.groundHeight(0, 6 + SUPPORT_RADIUS * 1.2, 1.5)).toBe(0);
    const col = world(circle(0, 5, 1, 0.9));
    expect(col.groundHeight(1 + SUPPORT_RADIUS * 0.8, 5, 1.5)).toBeCloseTo(0.9);
    expect(col.groundHeight(1 + SUPPORT_RADIUS * 1.2, 5, 1.5)).toBe(0);
  });

  it('重なった足場が複数あれば、乗れるうちでいちばん高い上面（低い台の上に高い台が重なる）', () => {
    const w = world(flat(0, 5, 3, 3, 0.4), flat(0, 5, 1, 1, 1.0), flat(0, 5, 0.5, 0.5, 2.5));
    expect(w.groundHeight(0, 5, 1.2)).toBeCloseTo(1.0); // 2.5 は足 + STEP_UP より高い（立ちはだかる）
    expect(w.groundHeight(2, 5, 1.2)).toBeCloseTo(0.4);
  });

  it('moveCircle の stepUp: 空中の許容を小さくすると、上面がそれより高い障害物には押し戻される', () => {
    const w = world(flat(0, 5, 2, 1, 0.9));
    const ground = { x: 0, z: 3.7, r: 0.5 };
    expect(w.moveCircle(ground, 0.6, STEP_UP)).toBe(false); // 足 0.6 + 0.45 ≥ 0.9: 乗れる
    const air = { x: 0, z: 3.7, r: 0.5 };
    expect(w.moveCircle(air, 0.6, AIR_STEP_UP)).toBe(true); // 足 0.6 + 0.12 < 0.9: 壁
    expect(air.z).toBeCloseTo(3.5);
  });
});
