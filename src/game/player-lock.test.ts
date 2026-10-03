import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import { wrapAngle } from '../core/math';

/** ロックオン中の照準（Player.setAim）。カメラ yaw = π のとき、スティックの上は +Z、右は −X */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const step = (p: Player, over: Partial<InputIntent> = {}, n = 1) => {
  for (let i = 0; i < n; i++) p.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
};
const near = (a: number, b: number) => Math.abs(wrapAngle(a - b)) < 1e-6;

describe('Player の照準（ロックオン）', () => {
  it('照準があれば、攻撃は入力方向でなく対象の方を向いて始まる', () => {
    const p = new Player();
    p.setAim({ x: 5, z: 0 }); // +X
    step(p, { attackPressed: true, moveX: 0, moveY: 1 }); // スティックは +Z を向いている
    expect(p.state).toBe('attack');
    expect(near(p.yaw, Math.PI / 2)).toBe(true);
  });

  it('照準がなければ、攻撃は入力方向を向いて始まる', () => {
    const p = new Player();
    step(p, { attackPressed: true, moveX: -1, moveY: 0 }); // 画面の左 = +X
    expect(near(p.yaw, Math.PI / 2)).toBe(true);
    const q = new Player();
    step(q, { attackPressed: true, moveX: 0, moveY: -1 }); // 下 = −Z
    expect(near(q.yaw, Math.PI)).toBe(true);
  });

  it('立ち止まっているあいだは、対象の方へ旋回速度で向き直る', () => {
    const p = new Player();
    p.setAim({ x: 0, z: -5 }); // 真後ろ（−Z）。yaw 0 から π 回る
    step(p, {}, 5);
    expect(Math.abs(p.yaw)).toBeGreaterThan(0.5);
    step(p, {}, 60);
    expect(near(p.yaw, Math.PI)).toBe(true);
  });

  it('走っているあいだはスティックの向き（照準があっても対象へは向かない）', () => {
    const p = new Player();
    p.setAim({ x: 0, z: -5 });
    step(p, { moveX: 0, moveY: 1 }, 30); // +Z へ走る
    expect(Math.abs(p.yaw)).toBeLessThan(1e-6);
  });

  it('照準を外せば、立ち止まっていても向きを変えない', () => {
    const p = new Player();
    p.setAim({ x: 0, z: -5 });
    step(p, {}, 3);
    const yaw = p.yaw;
    p.setAim(null);
    step(p, {}, 30);
    expect(p.yaw).toBe(yaw);
  });

  it('回避はスティック方向。無入力なら向いている方（= 対象）の後ろへ', () => {
    const p = new Player();
    p.setAim({ x: 0, z: 5 });
    step(p, { dodgePressed: true });
    expect(p.state).toBe('dodge');
    step(p, {}, 10);
    expect(p.body.z).toBeLessThan(0); // 対象（+Z）から離れる向き
  });
});
