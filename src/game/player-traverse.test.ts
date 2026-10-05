import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import { TRAVERSE } from '../combat/data/traverse';
import { MOVE } from '../combat/data/attacks';
import { World, type Obstacle } from '../world/world';

/** 乗り上がり・乗り越え・掴んで登る（M7-3）。カメラ yaw = π のとき、スティックの上は +Z */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const step = (p: Player, over: Partial<InputIntent> = {}, n = 1): void => {
  for (let i = 0; i < n; i++) p.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
};
const box = (x: number, z: number, hx: number, hz: number, top: number, climbable = false): Obstacle => ({ kind: 'box', x, z, hx, hz, yaw: 0, top, climbable });
const circle = (x: number, z: number, r: number, top: number): Obstacle => ({ kind: 'circle', x, z, r, top });
const worldOf = (...obstacles: Obstacle[]): World => new World({ radius: 14, obstacles });
const playerIn = (w: World, z: number): Player => {
  const p = new Player();
  p.world = w;
  p.body.z = z;
  return p;
};
/** state が traverse でなくなるまで進める。進めたステップ数 */
const untilDone = (p: Player, over: Partial<InputIntent> = {}, max = 120): number => {
  let n = 0;
  while (p.state === 'traverse' && n < max) {
    step(p, over);
    n++;
  }
  return n;
};

describe('乗り上がり（立ち止まって押し込む）', () => {
  // 岩（半径 0.95・上面 0.85）が (0, 5) にある。面は z = 4.05
  const rock = (): World => worldOf(circle(0, 5, 0.95, 0.85));

  it('面に接して押し込み続けると、holdFrames のあとに始まり、岩の上に立つ（高さ = 上面）', () => {
    const p = playerIn(rock(), 4.05 - MOVE.radius - 0.01);
    step(p, { moveY: 1 }, TRAVERSE.holdFrames - 2);
    expect(p.state).not.toBe('traverse');
    step(p, { moveY: 1 }, 4);
    expect(p.state).toBe('traverse');
    expect(p.traversing).toBe(true);
    expect(p.traverseClip!.spec.kind).toBe('mantle');
    untilDone(p, { moveY: 1 });
    expect(p.traversing).toBe(false);
    expect(p.state).toBe('idle');
    expect(p.grounded).toBe(true);
    expect(p.y).toBeCloseTo(0.85, 6);
    expect(p.body.z).toBeCloseTo(4.05 + Math.min(TRAVERSE.standZ, 0.95), 2); // 面から standZ
    expect(p.landSerial).toBe(1);
    // そのまま上に立っていられる（足場が支える）
    step(p, {}, 30);
    expect(p.y).toBeCloseTo(0.85, 6);
    expect(p.grounded).toBe(true);
  });

  it('擦っただけでは始まらない: 押し込みを途中で離すと数え直し。斜め 70° の押し込みも始まらない', () => {
    const p = playerIn(rock(), 4.05 - MOVE.radius - 0.01);
    step(p, { moveY: 1 }, TRAVERSE.holdFrames - 1);
    step(p, {}, 3); // 離す
    step(p, { moveY: 1 }, TRAVERSE.holdFrames - 1);
    expect(p.state).not.toBe('traverse');
    const oblique = playerIn(worldOf(box(0, 5, 6, 0.5, 0.9)), 4.5 - MOVE.radius - 0.01);
    for (let i = 0; i < 40; i++) step(oblique, { moveX: -0.94, moveY: 0.34 }); // 約 70° 右へ（カメラ yaw π では moveX 負が +X）
    expect(oblique.state).not.toBe('traverse');
  });

  it('始まったあとは位置・高さがなめらか（1 ステップの移動が走る速さを超えない）で、高さは単調に上がる', () => {
    const p = playerIn(rock(), 4.05 - MOVE.radius - 0.01);
    step(p, { moveY: 1 }, TRAVERSE.holdFrames + 1);
    expect(p.state).toBe('traverse');
    let prevY = p.y;
    let prevX = p.body.x;
    let prevZ = p.body.z;
    let maxMove = 0;
    let monotone = true;
    for (let i = 0; i < 80 && p.state === 'traverse'; i++) {
      step(p, { moveY: 1 });
      maxMove = Math.max(maxMove, Math.hypot(p.body.x - prevX, p.body.z - prevZ) / DT);
      if (p.y < prevY - 1e-9) monotone = false;
      prevY = p.y;
      prevX = p.body.x;
      prevZ = p.body.z;
    }
    expect(monotone).toBe(true);
    expect(maxMove).toBeLessThan(MOVE.runSpeed * 2); // 乗り上がりの最中の最高速（走る速さの 2 倍未満）
  });

  it('越えている最中は、攻撃・回避・ジャンプ・ガードの入力を受け付けない（終わってから先行入力が出る）', () => {
    const p = playerIn(rock(), 4.05 - MOVE.radius - 0.01);
    step(p, { moveY: 1 }, TRAVERSE.holdFrames + 1);
    expect(p.state).toBe('traverse');
    step(p, { dodgePressed: true });
    step(p, { jumpPressed: true });
    step(p, { guardPressed: true, guardHeld: true });
    expect(p.state).toBe('traverse');
    step(p, { attackPressed: true });
    untilDone(p);
    expect(p.state === 'attack' || p.attackQueued).toBe(true); // 終わった次のステップで、押してあった攻撃が出る
  });

  it('被弾すると中断してひるみ、足場から離れていれば落ちて地面に着く（空中で固まらない）', () => {
    const p = playerIn(rock(), 4.05 - MOVE.radius - 0.01);
    step(p, { moveY: 1 }, TRAVERSE.holdFrames + 1);
    step(p, { moveY: 1 }, 14); // 引き上げの途中（上面の高さの半分あたり）
    expect(p.state).toBe('traverse');
    expect(p.y).toBeGreaterThan(0.1);
    p.takeHit({ attackerId: 1, targetId: p.body.id, damage: 1, knockback: 0, hitStop: 0, dirX: 0, dirZ: 1, x: 0, z: 0 });
    expect(p.state).toBe('hit');
    expect(p.traversing).toBe(false);
    step(p, {}, 90);
    expect(p.grounded).toBe(true);
    expect(['idle', 'land']).toContain(p.state);
    // 岩の外か上のどちらかに立っている（中にめり込まない）
    const inside = Math.hypot(p.body.x, p.body.z - 5) < 0.95 + MOVE.radius - 1e-3 && p.y < 0.4;
    expect(inside).toBe(false);
  });

  it('空中・ジャンプの最中は始まらない。足の高さが上面に近ければ（段差）、乗り上がりではなく歩いて乗る', () => {
    const p = playerIn(rock(), 3.2);
    step(p, { jumpPressed: true });
    step(p, { moveY: 1 }, 40);
    expect(p.state).not.toBe('traverse');
    const low = playerIn(worldOf(circle(0, 5, 0.95, 0.4)), 4.05 - MOVE.radius - 0.01);
    step(low, { moveY: 1 }, 30);
    expect(low.state).not.toBe('traverse');
    expect(low.y).toBeCloseTo(0.4, 6);
  });
});

describe('乗り越え（走って低くて薄い壁へ）', () => {
  // 壁（0.9 の高さ・厚み 0.6）が z = 5（面は 4.7 と 5.3）。向こう側は平らな地面
  const wall = (): World => worldOf(box(0, 5, 4, 0.3, 0.9));

  it('走って近づくと、勢いを保ったまま壁を越えて向こう側へ着地し、そのまま走り続ける', () => {
    const p = playerIn(wall(), 1.5);
    let started = -1;
    for (let i = 0; i < 80 && started < 0; i++) {
      step(p, { moveY: 1 });
      if (p.state === 'traverse') started = i;
    }
    expect(started).toBeGreaterThan(0);
    expect(p.traverseClip!.spec.kind).toBe('vault');
    expect(p.body.z).toBeLessThan(4.7 - MOVE.radius + 0.01);
    untilDone(p, { moveY: 1 });
    expect(p.state).toBe('run');
    expect(p.y).toBe(0);
    expect(p.body.z).toBeGreaterThan(5.3 + 0.3);
    expect(p.velZ).toBeGreaterThan(TRAVERSE.vault.exitSpeed * 0.9);
    expect(p.landSerial).toBe(1);
    // そのまま走り続けられる（壁の向こうで引っかからない）
    const z0 = p.body.z;
    step(p, { moveY: 1 }, 30);
    expect(p.body.z).toBeGreaterThan(z0 + 1);
  });

  it('乗り越えの最中の高さは弧（足元の原点は持ち上がるが、体は水平に近く倒れるので上面の高さまでは上がらない）。終点では地面（0）', () => {
    const p = playerIn(wall(), 1.5);
    let peak = 0;
    for (let i = 0; i < 160; i++) {
      step(p, { moveY: 1 });
      peak = Math.max(peak, p.y);
      if (p.body.z > 6.5) break;
    }
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThan(0.9);
    expect(p.y).toBe(0);
  });

  it('立ち止まって押し込むと乗り上がり（壁の上に立つ）。壁の上から歩いて出れば向こうへ降りられる', () => {
    const p = playerIn(wall(), 4.7 - MOVE.radius - 0.01);
    step(p, { moveY: 1 }, TRAVERSE.holdFrames + 1);
    expect(p.traverseClip!.spec.kind).toBe('mantle');
    untilDone(p, { moveY: 1 });
    expect(p.y).toBeCloseTo(0.9, 6);
    for (let i = 0; i < 60; i++) step(p, { moveY: 1 });
    expect(p.y).toBe(0);
    expect(p.body.z).toBeGreaterThan(5.3);
  });
});

describe('掴んで登る（登れる縁。M7-3b）', () => {
  // 登れる箱（上面 1.5・奥行き 2。面は z = 4）と、壇（上面 2.2・奥行き 2）
  const block = (top = 1.5): World => worldOf(box(0, 5, 2, 1, top, true));

  it('登れる縁に押し込み続けると「登り」が始まり、1.5 の箱の上に立つ（高さ = 上面。そのまま立っていられる）', () => {
    const p = playerIn(block(), 4 - MOVE.radius - 0.01);
    step(p, { moveY: 1 }, TRAVERSE.holdFrames + 1);
    expect(p.state).toBe('traverse');
    expect(p.traverseClip!.spec.kind).toBe('climb');
    expect(p.traverseClip!.spec.height).toBeCloseTo(1.5);
    const n = untilDone(p, { moveY: 1 });
    expect(n).toBeGreaterThan(40); // 乗り上がり（0.7 秒）より長い 1 秒前後
    expect(n).toBeLessThan(90);
    expect(p.state).toBe('idle');
    expect(p.grounded).toBe(true);
    expect(p.y).toBeCloseTo(1.5, 6);
    expect(p.body.z).toBeCloseTo(4 + TRAVERSE.standZ, 2);
    expect(p.landSerial).toBe(1);
    step(p, {}, 30);
    expect(p.y).toBeCloseTo(1.5, 6);
    expect(p.grounded).toBe(true);
  });

  it('壇（上面 2.2）も登れる。高さはほぼ単調に上がり（ぶら下がりの沈みは 6cm 未満）、1 ステップの移動は走る速さの 3 倍を超えない（跳びつきの瞬間を含む）', () => {
    const p = playerIn(block(2.2), 4 - MOVE.radius - 0.01);
    step(p, { moveY: 1 }, TRAVERSE.holdFrames + 1);
    expect(p.traverseClip!.spec.kind).toBe('climb');
    expect(p.traverseClip!.spec.height).toBeCloseTo(2.2);
    let peak = p.y;
    let sag = 0; // これまでの最高から下がった量の最大（ぶら下がりの勢いを止める沈みだけ）
    let maxMove = 0;
    let prevZ = p.body.z;
    while (p.state === 'traverse') {
      step(p, { moveY: 1 });
      peak = Math.max(peak, p.y);
      sag = Math.max(sag, peak - p.y);
      maxMove = Math.max(maxMove, Math.abs(p.body.z - prevZ) / DT);
      prevZ = p.body.z;
    }
    expect(sag).toBeLessThan(0.06);
    expect(maxMove).toBeLessThan(MOVE.runSpeed * 3);
    expect(p.y).toBeCloseTo(2.2, 6);
    expect(p.grounded).toBe(true);
  });

  it('縁にぶら下がっている間は、足が地面を離れている（跳びつく高さなら）。腕で支えるので、落ちない', () => {
    const p = playerIn(block(2.2), 4 - MOVE.radius - 0.01);
    step(p, { moveY: 1 }, TRAVERSE.holdFrames + 1);
    // 構えのあと、跳びついて縁を掴む（0.083 + 0.16 秒）。そのあとぶら下がる
    step(p, { moveY: 1 }, 20);
    expect(p.state).toBe('traverse');
    expect(p.y).toBeGreaterThan(0.3);
    const y1 = p.y;
    step(p, { moveY: 1 }, 3);
    expect(p.state).toBe('traverse');
    expect(p.y).toBeGreaterThan(y1 - 0.15); // ぶら下がりの沈みは小さい（重力で落ち続けない）
  });

  it('登りの最中は、攻撃・回避・ジャンプ・ガードの入力を受け付けない。終わってから先行入力が出る', () => {
    const p = playerIn(block(), 4 - MOVE.radius - 0.01);
    step(p, { moveY: 1 }, TRAVERSE.holdFrames + 1);
    step(p, { dodgePressed: true });
    step(p, { jumpPressed: true });
    step(p, { guardPressed: true, guardHeld: true });
    expect(p.state).toBe('traverse');
    step(p, { attackPressed: true });
    untilDone(p);
    expect(p.state === 'attack' || p.attackQueued).toBe(true);
  });

  it('被弾すると中断してひるみ、足場から離れていれば落ちて地面（または箱の上）に着く。空中で固まらない', () => {
    const p = playerIn(block(2.2), 4 - MOVE.radius - 0.01);
    step(p, { moveY: 1 }, TRAVERSE.holdFrames + 1);
    step(p, { moveY: 1 }, 24); // ぶら下がりの途中
    expect(p.state).toBe('traverse');
    expect(p.y).toBeGreaterThan(0.3);
    p.takeHit({ attackerId: 1, targetId: p.body.id, damage: 1, knockback: 0, hitStop: 0, dirX: 0, dirZ: 1, x: 0, z: 0 });
    expect(p.state).toBe('hit');
    expect(p.traversing).toBe(false);
    step(p, {}, 120);
    expect(p.grounded).toBe(true);
    expect(['idle', 'land']).toContain(p.state);
    // 箱の中にめり込まない（外の地面か、上面の上に立つ）
    const inside = Math.abs(p.body.x) < 2 + MOVE.radius - 1e-3 && Math.abs(p.body.z - 5) < 1 + MOVE.radius - 1e-3 && p.y < 2;
    expect(inside).toBe(false);
  });

  it('登った上から歩いて出て、縁から降りられる（上面から地面へ。登りがまた始まらない）', () => {
    const p = playerIn(block(), 4 - MOVE.radius - 0.01);
    step(p, { moveY: 1 }, TRAVERSE.holdFrames + 1);
    untilDone(p, { moveY: 1 });
    for (let i = 0; i < 120; i++) step(p, { moveY: 1 }); // 奥へ歩いて向こうの縁から降りる
    expect(p.y).toBe(0);
    expect(p.body.z).toBeGreaterThan(6);
    expect(p.state).not.toBe('traverse');
  });
});

describe('対象外', () => {
  it('石の箱（1.5。登れる縁でない）・高い柱は越えられない（押し込んでも始まらず、足も地面のまま）', () => {
    for (const o of [box(0, 5, 2, 1, 1.5), circle(0, 5, 0.6, 4.5)]) {
      const p = playerIn(worldOf(o), 3);
      step(p, { moveY: 1 }, 90);
      expect(p.state).not.toBe('traverse');
      expect(p.y).toBe(0);
    }
  });
});
