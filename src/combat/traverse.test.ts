import { describe, expect, it } from 'vitest';
import { probeTraverse, quantize } from './traverse';
import { TRAVERSE } from './data/traverse';
import { MOVE } from './data/attacks';
import { World, createLedgeHit, type Obstacle } from '../world/world';

const R = MOVE.radius;
const box = (x: number, z: number, hx: number, hz: number, top: number, yaw = 0, climbable = false): Obstacle => ({ kind: 'box', x, z, hx, hz, yaw, top, climbable });
const circle = (x: number, z: number, r: number, top: number): Obstacle => ({ kind: 'circle', x, z, r, top });
const worldOf = (...obstacles: Obstacle[]): World => new World({ radius: 14, obstacles });

describe('World.probeLedge: 縁の面・上面・奥行き', () => {
  it('箱: 面の位置・外向きの法線・上面・奥行き（壁の厚み）。円柱の奥行きは直径', () => {
    const w = worldOf(box(0, 5, 2, 0.3, 0.9), circle(6, 0, 1, 0.85));
    const hit = createLedgeHit();
    expect(w.probeLedge(0, 0, 0, 1, 6, 0, hit)).toBe(true);
    expect(hit.dist).toBeCloseTo(4.7);
    expect(hit.z).toBeCloseTo(4.7);
    expect(hit.nz).toBeCloseTo(-1);
    expect(hit.top).toBe(0.9);
    expect(hit.depth).toBeCloseTo(0.6);
    expect(hit.climbable).toBe(false);
    expect(w.probeLedge(0, 0, 1, 0, 8, 0, hit)).toBe(true);
    expect(hit.x).toBeCloseTo(5);
    expect(hit.nx).toBeCloseTo(-1);
    expect(hit.depth).toBeCloseTo(2);
  });

  it('向きを回した箱でも、面の法線の逆向きに測った厚みになる。届かなければ false。climbable は障害物の印', () => {
    const w = worldOf({ kind: 'box', x: 0, z: 5, hx: 2, hz: 0.3, yaw: Math.PI / 2, top: 1.5, climbable: true });
    const hit = createLedgeHit();
    // yaw = π/2 なら長辺（4m）が z 方向。原点から +Z へは短辺の面（長辺の端）に当たる: 厚みは 4m
    expect(w.probeLedge(0, 0, 0, 1, 6, 0, hit)).toBe(true);
    expect(hit.depth).toBeCloseTo(4);
    expect(hit.climbable).toBe(true);
    expect(w.probeLedge(0, 0, 0, 1, 2, 0, hit)).toBe(false);
  });

  it('足の高さ y で体を止める障害物だけを探す（上面が y + STEP_UP 以下の段差は無視。手前の低い物の向こうの壁は見える）', () => {
    const w = worldOf(box(0, 3, 2, 0.3, 0.3), box(0, 5, 2, 0.3, 0.9));
    const hit = createLedgeHit();
    expect(w.probeLedge(0, 0, 0, 1, 8, 0, hit)).toBe(true);
    expect(hit.top).toBe(0.9);
    expect(hit.z).toBeCloseTo(4.7);
  });
});

describe('probeTraverse: 乗り上がり・乗り越えの計画', () => {
  const faceOf = (z: number): number => z - R; // 面（z）に体の縁が接するときの体の中心 z

  it('低い厚い障害物（岩 0.85）に接して押し込むと「乗り上がり」。始点は面から faceZ 手前、終点は上面の上', () => {
    const w = worldOf(circle(0, 5, 1, 0.85));
    const p = probeTraverse(w, 0, faceOf(4) + 0.01, 0, 0, 1, 0)!;
    expect(p).not.toBeNull();
    expect(p.touching).toBe(true);
    expect(p.immediate).toBe(false);
    expect(p.plan.kind).toBe('mantle');
    expect(p.plan.height).toBeCloseTo(0.85);
    expect(p.plan.top).toBe(0.85);
    expect(p.plan.endY).toBe(0.85);
    expect(p.plan.startZ).toBeCloseTo(4 - TRAVERSE.faceZ);
    expect(p.plan.endZ).toBeCloseTo(4 + TRAVERSE.standZ);
    expect(p.plan.span).toBeCloseTo(TRAVERSE.faceZ + TRAVERSE.standZ);
    expect(p.plan.yaw).toBeCloseTo(0);
  });

  it('走って近づくと、体の縁が面の手前 runStartDist に入ったところですぐ始まる（immediate）。遅いと始まらない（まだ接していない）', () => {
    const w = worldOf(circle(0, 5, 1, 0.85));
    const z = faceOf(4) - 0.3; // 縁から面まで 0.3m
    expect(probeTraverse(w, 0, z, 0, 0, 1, 4.8)!.immediate).toBe(true);
    expect(probeTraverse(w, 0, z, 0, 0, 1, 1)).toBeNull();
    expect(probeTraverse(w, 0, faceOf(4) - TRAVERSE.runStartDist - 0.2, 0, 0, 1, 4.8)).toBeNull(); // まだ遠い
  });

  it('低くて薄い壁（0.9 × 厚み 0.6）を走って越えようとすると「乗り越え」。終点は向こう側の地面。立ち止まって押すと乗り上がり', () => {
    const w = worldOf(box(0, 5, 3, 0.3, 0.9));
    const run = probeTraverse(w, 0, faceOf(4.7) - 0.2, 0, 0, 1, 4.8)!;
    expect(run.plan.kind).toBe('vault');
    expect(run.plan.endY).toBe(0);
    expect(run.plan.endZ).toBeCloseTo(5.3 + TRAVERSE.vault.landZ);
    expect(run.plan.depth).toBeCloseTo(0.6);
    const still = probeTraverse(w, 0, faceOf(4.7) + 0.01, 0, 0, 1, 0)!;
    expect(still.plan.kind).toBe('mantle');
    expect(still.plan.endZ).toBeCloseTo(5); // 薄い壁の中ほど（奥行き 0.6 の半分 = 0.3）
  });

  it('厚い壁は乗り越えず乗り上がる。向こう側に別の障害物があれば乗り越えられない（乗り上がりになる）', () => {
    const thick = worldOf(box(0, 5, 3, 0.8, 0.9)); // 厚み 1.6 > maxDepth
    expect(probeTraverse(thick, 0, faceOf(4.2) - 0.2, 0, 0, 1, 4.8)!.plan.kind).toBe('mantle');
    const blocked = worldOf(box(0, 5, 3, 0.3, 0.9), box(0, 6.1, 3, 0.4, 2)); // 着地する場所に高い壁
    expect(probeTraverse(blocked, 0, faceOf(4.7) - 0.2, 0, 0, 1, 4.8)!.plan.kind).toBe('mantle');
  });

  it('高すぎる障害物（登れない箱 1.5・柱）・低すぎる段差（0.3）は対象外。足の高さを上げれば相対の高さで判定する', () => {
    expect(probeTraverse(worldOf(box(0, 5, 2, 1, 1.5)), 0, faceOf(4) + 0.01, 0, 0, 1, 0)).toBeNull();
    expect(probeTraverse(worldOf(circle(0, 5, 0.6, 4.5)), 0, faceOf(4.4) + 0.01, 0, 0, 1, 0)).toBeNull();
    expect(probeTraverse(worldOf(box(0, 5, 2, 1, 0.3)), 0, faceOf(4) + 0.01, 0, 0, 1, 0)).toBeNull(); // 歩いて乗れる
    // 足が 0.85 の岩の上にいれば、1.5 の箱は相対 0.65（乗り上がれる）
    const w = worldOf(box(0, 5, 2, 1, 1.5));
    expect(probeTraverse(w, 0, faceOf(4) + 0.01, 0.85, 0, 1, 0)!.plan.height).toBeCloseTo(0.65);
  });

  it('向きが面の正面から 50° を超えてずれていれば始まらない（擦って通るだけ）。斜め 30° なら始まる', () => {
    const w = worldOf(box(0, 5, 4, 0.5, 0.9));
    const z = faceOf(4.5) + 0.01;
    const dir = (deg: number): [number, number] => [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)];
    expect(probeTraverse(w, 0, z, 0, ...dir(30), 0)).not.toBeNull();
    expect(probeTraverse(w, 0, z, 0, ...dir(70), 0)).toBeNull();
  });

  it('終点が上面から外れる（奥行きが無さすぎる）・境界の外・高い障害物に重なるときは始まらない', () => {
    // 境界（半径 14）にはみ出た岩: 終点が境界の外（境界が広ければ乗り上がれる）
    const w = worldOf(circle(0, 14.6, 0.8, 0.85));
    expect(probeTraverse(w, 0, 13.8 - R + 0.01, 0, 0, 1, 0)).toBeNull();
    const wide = new World({ radius: 20, obstacles: [circle(0, 14.6, 0.8, 0.85)] });
    expect(probeTraverse(wide, 0, 13.8 - R + 0.01, 0, 0, 1, 0)).not.toBeNull();
    // 低い壁のすぐ向こうに高い柱: 乗り上がった終点が柱に重なる
    const w2 = worldOf(box(0, 5, 3, 0.8, 0.9), circle(0, 5.6, 0.5, 4));
    expect(probeTraverse(w2, 0, faceOf(4.2) + 0.01, 0, 0, 1, 0)).toBeNull();
  });

  it('登れる縁（climbable）: mantleMax を超え climbMax 以下の高さなら「掴んで登る」。始点・終点は乗り上がりと同じ作り。走って近づいても乗り越えにはならない', () => {
    const w = worldOf(box(0, 5, 2, 1, 1.5, 0, true)); // 面は z = 4
    const p = probeTraverse(w, 0, faceOf(4) + 0.01, 0, 0, 1, 0)!;
    expect(p).not.toBeNull();
    expect(p.plan.kind).toBe('climb');
    expect(p.plan.height).toBeCloseTo(1.5);
    expect(p.plan.endY).toBe(1.5);
    expect(p.plan.startZ).toBeCloseTo(4 - TRAVERSE.faceZ);
    expect(p.plan.endZ).toBeCloseTo(4 + TRAVERSE.standZ);
    expect(p.plan.span).toBeCloseTo(TRAVERSE.faceZ + TRAVERSE.standZ);
    // 走って近づく（immediate）: 薄い高い壁でも乗り越えでなく登り
    const thin = worldOf(box(0, 5, 3, 0.3, 1.5, 0, true));
    const run = probeTraverse(thin, 0, faceOf(4.7) - 0.2, 0, 0, 1, 4.8)!;
    expect(run.immediate).toBe(true);
    expect(run.plan.kind).toBe('climb');
    // 最も高い登れる縁（上面 2.2 の壇）も登れる。climbMax を超えたら対象外
    expect(probeTraverse(worldOf(box(0, 5, 2, 1, 2.2, 0, true)), 0, faceOf(4) + 0.01, 0, 0, 1, 0)!.plan.kind).toBe('climb');
    expect(probeTraverse(worldOf(box(0, 5, 2, 1, TRAVERSE.climbMax + 0.1, 0, true)), 0, faceOf(4) + 0.01, 0, 0, 1, 0)).toBeNull();
  });

  it('登れる縁でない高い障害物は、同じ高さでも対象外。mantleMax ちょうどまでは印がなくても乗り上がり', () => {
    expect(probeTraverse(worldOf(box(0, 5, 2, 1, 2.2)), 0, faceOf(4) + 0.01, 0, 0, 1, 0)).toBeNull();
    expect(probeTraverse(worldOf(box(0, 5, 2, 1, TRAVERSE.mantleMax)), 0, faceOf(4) + 0.01, 0, 0, 1, 0)!.plan.kind).toBe('mantle');
    // 登れる印があっても、mantleMax 以下は乗り上がり（登りにしない）
    expect(probeTraverse(worldOf(box(0, 5, 2, 1, 1.1, 0, true)), 0, faceOf(4) + 0.01, 0, 0, 1, 0)!.plan.kind).toBe('mantle');
  });

  it('登れる縁でも、上面に立てない（終点に高い障害物が重なる・境界の外）なら始まらない。足が高ければ相対の高さで登り／乗り上がりが変わる', () => {
    const blocked = worldOf(box(0, 5, 2, 1, 1.5, 0, true), circle(0, 5.3, 0.4, 4));
    expect(probeTraverse(blocked, 0, faceOf(4) + 0.01, 0, 0, 1, 0)).toBeNull();
    // 足が 0.85 の岩の上: 2.2 の壇は相対 1.35（登り）、1.5 の箱は相対 0.65（乗り上がり）
    expect(probeTraverse(worldOf(box(0, 5, 2, 1, 2.2, 0, true)), 0, faceOf(4) + 0.01, 0.85, 0, 1, 0)!.plan.kind).toBe('climb');
    expect(probeTraverse(worldOf(box(0, 5, 2, 1, 1.5, 0, true)), 0, faceOf(4) + 0.01, 0.85, 0, 1, 0)!.plan.kind).toBe('mantle');
  });

  it('quantize: 刻みの倍数へ丸める', () => {
    expect(quantize(0.87, 0.05)).toBeCloseTo(0.85);
    expect(quantize(0.9, 0.05)).toBeCloseTo(0.9);
    expect(quantize(0.926, 0.05)).toBeCloseTo(0.95);
  });
});
