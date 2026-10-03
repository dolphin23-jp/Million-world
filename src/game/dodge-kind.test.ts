import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import { DODGES } from '../combat/data/attacks';
import { wrapAngle } from '../core/math';

/** 回避の種類の選択（ロール / 後ろステップ）と、移動。カメラ yaw = π のとき、スティックの上は +Z、右は −X */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const step = (p: Player, over: Partial<InputIntent> = {}, n = 1) => {
  for (let i = 0; i < n; i++) p.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
};
const near = (a: number, b: number) => Math.abs(wrapAngle(a - b)) < 1e-6;

describe('回避の種類', () => {
  it('スティックを倒していれば、その向きへ向きを変えて前転（ロール）', () => {
    const p = new Player();
    step(p, { dodgePressed: true, moveX: -1, moveY: 0 }); // 画面の左 = +X
    expect(p.state).toBe('dodge');
    expect(p.dodgeKind).toBe('roll');
    expect(near(p.yaw, Math.PI / 2)).toBe(true);
  });

  it('入力なしなら、向きを保ったまま後ろステップ（振り向かない）', () => {
    const p = new Player(); // +Z（yaw 0）を向いている
    step(p, { dodgePressed: true });
    expect(p.dodgeKind).toBe('back');
    expect(near(p.yaw, 0)).toBe(true);
  });

  it('ロック中は、対象から離れる向き（真後ろ ± 50°）へ倒していれば、対象を向いたまま後ろステップ', () => {
    const p = new Player();
    p.setAim({ x: 0, z: 6 }); // 対象は +Z。離れる向きは −Z（スティック下）
    step(p, { dodgePressed: true, moveX: 0, moveY: -1 });
    expect(p.dodgeKind).toBe('back');
    expect(near(p.yaw, 0)).toBe(true); // 対象（+Z）を向いたまま
  });

  it('ロック中でも、横や対象へ向かう向きなら前転（その向きへ向きを変える）', () => {
    const side = new Player();
    side.setAim({ x: 0, z: 6 });
    step(side, { dodgePressed: true, moveX: 1, moveY: 0 }); // 画面の右 = −X（対象に対して真横）
    expect(side.dodgeKind).toBe('roll');
    expect(near(side.yaw, -Math.PI / 2)).toBe(true);

    const toward = new Player();
    toward.setAim({ x: 0, z: 6 });
    step(toward, { dodgePressed: true, moveX: 0, moveY: 1 });
    expect(toward.dodgeKind).toBe('roll');
  });

  it('ロック中の入力なしは、対象を向いて後ろステップ（いま背を向けていても）', () => {
    const p = new Player();
    p.setAim({ x: 5, z: 0 }); // 対象は +X
    step(p, { dodgePressed: true });
    expect(p.dodgeKind).toBe('back');
    expect(near(p.yaw, Math.PI / 2)).toBe(true);
  });

  it('後ろ寄りのしきい（50°）の内外で切り替わる', () => {
    const inside = new Player();
    inside.setAim({ x: 0, z: 6 });
    // 真後ろ（−Z）から 40° ずれた向き
    step(inside, { dodgePressed: true, moveX: -Math.sin((40 * Math.PI) / 180), moveY: -Math.cos((40 * Math.PI) / 180) });
    expect(inside.dodgeKind).toBe('back');
    const outside = new Player();
    outside.setAim({ x: 0, z: 6 });
    step(outside, { dodgePressed: true, moveX: -Math.sin((60 * Math.PI) / 180), moveY: -Math.cos((60 * Math.PI) / 180) });
    expect(outside.dodgeKind).toBe('roll');
  });
});

describe('回避の移動', () => {
  it('ロールは向いた方へほぼ 2.95m 進み、立ち上がって待機に戻る', () => {
    const p = new Player();
    step(p, { dodgePressed: true, moveX: 0, moveY: 1 });
    step(p, {}, DODGES.roll.frames + 2);
    expect(p.state).toBe('idle');
    expect(Math.hypot(p.body.x, p.body.z)).toBeGreaterThan(2.8);
    expect(Math.hypot(p.body.x, p.body.z)).toBeLessThan(3.1);
    expect(p.body.z).toBeGreaterThan(2.8); // +Z へ
  });

  it('後ろステップは向きの後ろへ約 2.0m 進み、向きは変わらない', () => {
    const p = new Player();
    step(p, { dodgePressed: true });
    step(p, {}, DODGES.back.frames + 2);
    expect(p.state).toBe('idle');
    expect(p.body.z).toBeLessThan(-1.85);
    expect(p.body.z).toBeGreaterThan(-2.15);
    expect(Math.abs(p.body.x)).toBeLessThan(1e-6);
    expect(near(p.yaw, 0)).toBe(true);
  });

  it('ロック中の後ろステップは、対象の向きの真後ろへ進む（斜めに立っていても）', () => {
    const p = new Player();
    p.setAim({ x: 6, z: 6 }); // 対象は斜め前（+X +Z）
    step(p, { dodgePressed: true });
    step(p, {}, DODGES.back.frames + 2);
    // 対象と反対（−X −Z）へ約 2m
    expect(p.body.x).toBeLessThan(-1.2);
    expect(p.body.z).toBeLessThan(-1.2);
    expect(Math.abs(p.body.x - p.body.z)).toBeLessThan(0.05);
  });
});
