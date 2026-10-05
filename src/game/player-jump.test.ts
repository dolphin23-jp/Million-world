import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import { JUMP } from '../combat/data/jump';
import { MOVE } from '../combat/data/attacks';
import { World, type Obstacle } from '../world/world';

/** ジャンプ・落下・着地（M7-2）。カメラ yaw = π のとき、スティックの上は +Z、右は −X */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const step = (p: Player, over: Partial<InputIntent> = {}, n = 1): void => {
  for (let i = 0; i < n; i++) p.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
};
const box = (x: number, z: number, hx: number, hz: number, top: number): Obstacle => ({ kind: 'box', x, z, hx, hz, yaw: 0, top });
const worldOf = (...obstacles: Obstacle[]): World => new World({ radius: 14, obstacles });
const playerIn = (w: World): Player => {
  const p = new Player();
  p.world = w;
  return p;
};
/** 助走（前へ走る）n ステップ */
const run = (p: Player, n: number): void => step(p, { moveY: 1 }, n);
/** 着地するまで（または最大 max ステップ）進める。進めたステップ数を返す */
const untilGrounded = (p: Player, over: Partial<InputIntent> = {}, max = 200): number => {
  let n = 0;
  while (!p.grounded && n < max) {
    step(p, over);
    n++;
  }
  return n;
};
/** 跳んで頂点の高さまで進む。到達した最大の高さを返す */
const peakOf = (p: Player, over: Partial<InputIntent> = {}): number => {
  let max = 0;
  for (let i = 0; i < 120; i++) {
    step(p, i === 0 ? { ...over, jumpPressed: true } : over);
    max = Math.max(max, p.y);
    if (i > JUMP.squatFrames && p.grounded) break;
  }
  return max;
};

describe('ジャンプ: 基本の弧', () => {
  it('押すと踏み切りの沈み（地面に付いたまま）→ 跳ぶ。頂点は speed² / 2g、着地で land → 立つ', () => {
    const p = new Player();
    step(p, { jumpPressed: true });
    expect(p.state).toBe('air');
    expect(p.y).toBe(0);
    expect(p.grounded).toBe(true);
    expect(p.rising).toBe(true);
    step(p, {}, JUMP.squatFrames); // 沈みが終わって跳び出す
    expect(p.grounded).toBe(false);
    expect(p.y).toBeGreaterThan(0);
    expect(p.jumpSerial).toBe(1);
    let max = p.y;
    let landedAt = -1;
    for (let i = 0; i < 120 && landedAt < 0; i++) {
      step(p);
      max = Math.max(max, p.y);
      if (p.grounded) landedAt = i;
    }
    const apex = (JUMP.speed * JUMP.speed) / (2 * JUMP.gravity);
    // 1 ステップずつ積分するので、連続の式の頂点より v × dt / 2 ほど低い
    expect(max).toBeGreaterThan(apex - JUMP.speed * DT);
    expect(max).toBeLessThan(apex + 1e-6);
    expect(p.y).toBe(0);
    expect(p.state).toBe('land');
    expect(p.landSerial).toBe(1);
    expect(p.lastLandSpeed).toBeGreaterThan(JUMP.speed * 0.9);
    step(p, {}, JUMP.land.frames);
    expect(p.state).toBe('idle');
  });

  it('滞空は 2 × speed / gravity（約 0.67 秒）', () => {
    const p = new Player();
    step(p, { jumpPressed: true });
    step(p, {}, JUMP.squatFrames);
    const frames = untilGrounded(p) + 1;
    const expected = (2 * JUMP.speed) / JUMP.gravity / DT;
    expect(Math.abs(frames - expected)).toBeLessThan(3);
  });

  it('走っているときの勢いは跳んでも保つ（着地までに走る速さ × 滞空ぶん進む）。立って跳べば、ほとんど動かない', () => {
    const runner = new Player();
    run(runner, 30);
    const z0 = runner.body.z;
    step(runner, { moveY: 1, jumpPressed: true });
    step(runner, { moveY: 1 }, JUMP.squatFrames);
    untilGrounded(runner, { moveY: 1 });
    expect(runner.body.z - z0).toBeGreaterThan(MOVE.runSpeed * 0.5);
    const stander = new Player();
    step(stander, { jumpPressed: true });
    step(stander, {}, JUMP.squatFrames);
    untilGrounded(stander);
    expect(Math.hypot(stander.body.x, stander.body.z)).toBeLessThan(0.2);
  });

  it('空中でスティックを倒すと向きが曲がる（上限は走る速さ）。離しても勢いは保つ', () => {
    const p = new Player();
    step(p, { jumpPressed: true });
    step(p, {}, JUMP.squatFrames + 10);
    expect(p.grounded).toBe(false);
    step(p, { moveY: 1 }, 20);
    expect(p.velZ).toBeGreaterThan(1.5);
    expect(p.velZ).toBeLessThanOrEqual(MOVE.runSpeed + 1e-6);
    const vz = p.velZ;
    step(p, {}, 5);
    expect(p.velZ).toBeGreaterThan(vz - JUMP.airDrag * (5 * DT) - 1e-6); // 勢いはほとんど落ちない
  });
});

describe('ジャンプ: 空中の操作の制限・先行入力', () => {
  it('空中では攻撃・回避・ガードを始められない。押した攻撃は着地の硬直の途中から出る（先行入力）', () => {
    const p = new Player();
    step(p, { jumpPressed: true });
    step(p, {}, JUMP.squatFrames + 8);
    step(p, { dodgePressed: true });
    step(p, { guardPressed: true, guardHeld: true });
    expect(p.state).toBe('air');
    step(p, { attackPressed: true });
    expect(p.state).toBe('air');
    untilGrounded(p);
    expect(p.state).toBe('land');
    step(p, {}, JUMP.land.cancelFrame + 1);
    // 空中で押したガード（先行入力は 12f）は切れているので、残っているのは攻撃だけ
    expect(p.state).toBe('attack');
  });

  it('着地の硬直の途中（cancelFrame）から、回避で切り上げられる。それより前は出ない', () => {
    const p = new Player();
    step(p, { jumpPressed: true });
    step(p, {}, JUMP.squatFrames);
    untilGrounded(p);
    expect(p.state).toBe('land');
    step(p, { dodgePressed: true });
    expect(p.state).toBe('land');
    step(p, {}, JUMP.land.cancelFrame);
    step(p, { dodgePressed: true });
    expect(p.state).toBe('dodge');
  });

  it('着地の直前に押したジャンプは、着地のあとで出る（先行入力）。ずっと前に押したものは出ない', () => {
    const early = new Player();
    step(early, { jumpPressed: true });
    step(early, {}, JUMP.squatFrames + 3);
    step(early, { jumpPressed: true }); // 頂点の少し前に押す（着地の 30 フレーム以上前）
    untilGrounded(early);
    step(early, {}, JUMP.land.frames + 3);
    expect(early.jumpSerial).toBe(1);

    const late = new Player();
    step(late, { jumpPressed: true });
    step(late, {}, JUMP.squatFrames + 3);
    // 着地の 2 フレーム前に押す
    let n = 0;
    while (late.y > 0.15 || late.velY > 0) {
      step(late);
      if (n++ > 200) break;
    }
    step(late, { jumpPressed: true });
    untilGrounded(late);
    step(late, {}, JUMP.land.frames);
    expect(late.jumpSerial).toBe(2);
  });

  it('跳んでいる最中に攻撃を受けるとひるむ。落ちて着地し、そのあと立てる（空中で固まらない）', () => {
    const p = new Player();
    step(p, { jumpPressed: true });
    step(p, {}, JUMP.squatFrames + 10);
    expect(p.grounded).toBe(false);
    p.takeHit({ attackerId: 1, targetId: p.body.id, damage: 1, knockback: 0, hitStop: 0, dirX: 0, dirZ: 1, x: 0, z: 0 });
    expect(p.state).toBe('hit');
    step(p, {}, 120);
    expect(p.grounded).toBe(true);
    expect(p.y).toBe(0);
    expect(['idle', 'land']).toContain(p.state);
  });

  it('reset で高さ・速さ・接地が元に戻る', () => {
    const p = new Player();
    step(p, { jumpPressed: true });
    step(p, {}, JUMP.squatFrames + 10);
    p.reset();
    expect(p.y).toBe(0);
    expect(p.velY).toBe(0);
    expect(p.grounded).toBe(true);
    expect(p.state).toBe('idle');
  });
});

describe('足場: 障害物の上に乗る・縁から落ちる', () => {
  // 低い壁（上面 0.9、z 方向の厚み 1.2）が z = 4 にある。幅は広く、横から回り込めない
  const wall = (): World => worldOf(box(0, 4, 3, 0.6, 0.9));

  it('走って近づいて跳ぶと、低い壁（0.9）の上に乗れる', () => {
    const p = playerIn(wall());
    p.body.z = 1.2;
    step(p, { moveY: 1 }, 8);
    step(p, { moveY: 1, jumpPressed: true });
    for (let i = 0; i < 60; i++) {
      step(p, { moveY: 1 });
      if (p.grounded && p.y > 0.5) break;
    }
    expect(p.grounded).toBe(true);
    expect(p.y).toBeCloseTo(0.9, 6);
    expect(p.body.z).toBeGreaterThan(3.2);
  });

  it('跳ばずに突っ込むと壁に止められる（上面 0.9 > STEP_UP）。足は地面のまま', () => {
    const p = playerIn(wall());
    p.body.z = 1.2;
    step(p, { moveY: 1 }, 120);
    expect(p.y).toBe(0);
    expect(p.body.z).toBeLessThan(4 - 0.6 - MOVE.radius + 1e-3);
  });

  it('助走が足りずに壁の手前で落ちると、壁の側面に押し戻されて地面に着く（めり込まない）', () => {
    const p = playerIn(wall());
    p.body.z = -1;
    step(p, { moveY: 1, jumpPressed: true });
    for (let i = 0; i < 80; i++) step(p, { moveY: 1 });
    expect(p.grounded).toBe(true);
    expect(p.y).toBe(0);
    expect(p.body.z).toBeLessThan(4 - 0.6 - MOVE.radius + 1e-3);
  });

  it('石の箱（上面 1.5）には、立ったままの跳躍では乗れない（頂点 + 縁の猶予 < 1.5）', () => {
    const w = worldOf(box(0, 3, 3, 0.8, 1.5));
    const p = playerIn(w);
    p.body.z = 1.4;
    step(p, { moveY: 1, jumpPressed: true });
    for (let i = 0; i < 90; i++) step(p, { moveY: 1 });
    expect(p.y).toBe(0);
    expect(p.body.z).toBeLessThan(3 - 0.8 - MOVE.radius + 1e-3);
  });

  it('上面に立っているあいだは足の高さが保たれ、縁から歩いて出ると落ちて、着地の硬直を経て地面に立つ', () => {
    const w = worldOf(box(0, 4, 3, 1, 0.9));
    const p = playerIn(w);
    // 上面の中央に立つ（高さを置いて、1 ステップで足場に吸い付く）
    p.body.z = 4;
    p.y = 0.9;
    step(p, {}, 3);
    expect(p.grounded).toBe(true);
    expect(p.y).toBeCloseTo(0.9, 6);
    // +Z へ歩いて縁（z = 5）を越える
    for (let i = 0; i < 40 && p.grounded; i++) step(p, { moveY: 1 });
    expect(p.grounded).toBe(false);
    step(p, { moveY: 1 }); // 離れた次のステップで、状態が空中（落下）になる
    expect(p.state).toBe('air');
    expect(p.rising).toBe(false);
    untilGrounded(p, { moveY: 1 });
    expect(p.y).toBe(0);
    expect(p.state).toBe('land');
  });

  it('縁から歩いて出た直後（縁の猶予）はジャンプできる。猶予が切れたあとは跳べない', () => {
    const make = (): Player => {
      const p = playerIn(worldOf(box(0, 4, 3, 1, 0.9)));
      p.body.z = 4;
      p.y = 0.9;
      step(p, {}, 3);
      for (let i = 0; i < 60 && p.grounded; i++) step(p, { moveY: 1 });
      expect(p.grounded).toBe(false);
      return p;
    };
    const quick = make();
    step(quick, { moveY: 1, jumpPressed: true });
    expect(quick.jumpSerial).toBe(1);
    expect(quick.velY).toBeGreaterThan(0);

    const slow = make();
    step(slow, { moveY: 1 }, JUMP.coyote + 3);
    step(slow, { moveY: 1, jumpPressed: true });
    expect(slow.jumpSerial).toBe(0);
  });

  it('段差（上面が STEP_UP 以下）は、跳ばずに歩いて乗り降りできる（落下も着地の硬直もない）', () => {
    const w = worldOf(box(0, 3, 3, 0.8, 0.3));
    const p = playerIn(w);
    p.body.z = 1;
    let maxY = 0;
    let airborne = false;
    for (let i = 0; i < 90; i++) {
      step(p, { moveY: 1 });
      maxY = Math.max(maxY, p.y);
      if (!p.grounded) airborne = true;
    }
    expect(maxY).toBeCloseTo(0.3, 6); // 上に乗った
    expect(p.body.z).toBeGreaterThan(3.8); // 向こう側へ降りた
    expect(p.y).toBe(0);
    expect(airborne).toBe(false);
    expect(p.landSerial).toBe(0);
    expect(p.state).toBe('run');
  });

  it('跳び上がる途中で壁の縁にかかれば（足が上面の 0.12m 以内）、そのまま上に乗れる（縁の猶予）。高さの目安: 低い岩・壁は乗れる', () => {
    const p = playerIn(wall());
    p.body.z = 2.2; // 壁の手前の面まで 1.2m（壁の面は z = 3.4）
    step(p, { moveY: 1, jumpPressed: true });
    for (let i = 0; i < 60; i++) {
      step(p, { moveY: 1 });
      if (p.grounded && p.y > 0.5) break;
    }
    expect(p.y).toBeCloseTo(0.9, 6);
  });

  it('頂点は 1.33m。乗れる高さの上限（頂点 + 0.12）は箱の 1.5 より低く、岩・壁（0.85〜0.9）より高い', () => {
    const p = new Player();
    const apex = peakOf(p);
    expect(apex + 0.12).toBeLessThan(1.5);
    expect(apex).toBeGreaterThan(0.9 + 0.3);
  });
});
