import { describe, expect, it } from 'vitest';
import { Enemy } from './enemy';
import { ENEMIES } from './data/enemies';
import type { HitEvent } from '../combat/hit';

const DT = 1 / 60;
const hit = (over: Partial<HitEvent> = {}): HitEvent => ({
  attackerId: 0,
  targetId: 1,
  damage: 10,
  knockback: 0.6,
  hitStop: 4,
  dirX: 0,
  dirZ: 1,
  x: 0,
  z: 4.5,
  ...over,
});
const make = () => {
  const e = new Enemy(ENEMIES.imp, 1, 0, 5);
  e.place(0, 5, Math.PI); // プレイヤー（原点）の方を向いている
  return e;
};
const run = (e: Enemy, frames: number, tx = 0, tz = 0) => {
  for (let i = 0; i < frames; i++) e.step(DT, tx, tz);
};

describe('Enemy', () => {
  it('被弾すると HP が減り、ひるみに入り、ノックバックの距離ぶん進む', () => {
    const e = make();
    const r = e.takeHit(hit({ damage: 10, knockback: 0.6, dirZ: -1 })); // プレイヤー側（-Z）へ押される
    expect(r).toEqual({ dealt: 10, killed: false });
    expect(e.health.hp).toBe(ENEMIES.imp.hp - 10);
    expect(e.state).toBe('hit');
    expect(e.hitSerial).toBe(1);
    run(e, ENEMIES.imp.knockbackFrames);
    expect(5 - e.body.z).toBeCloseTo(0.6, 6);
  });

  it('ひるみのフレームが終わると待機に戻る', () => {
    const e = make();
    e.takeHit(hit());
    run(e, ENEMIES.imp.hitStunFrames);
    expect(e.state).toBe('hit');
    run(e, 1);
    expect(e.state).toBe('idle');
  });

  it('ひるみ中にもう一度当たると、ひるみがやり直しになる', () => {
    const e = make();
    e.takeHit(hit());
    run(e, 15);
    e.takeHit(hit());
    expect(e.stateFrame).toBe(0);
    expect(e.hitSerial).toBe(2);
    run(e, ENEMIES.imp.hitStunFrames);
    expect(e.state).toBe('hit');
  });

  it('HP が 0 になると死亡し、無敵になり、演出のあと removable になる', () => {
    const e = make();
    const r = e.takeHit(hit({ damage: 999 }));
    expect(r.killed).toBe(true);
    expect(r.dealt).toBe(ENEMIES.imp.hp);
    expect(e.dead).toBe(true);
    expect(e.body.invulnerable).toBe(true);
    run(e, ENEMIES.imp.deathFrames);
    expect(e.removable).toBe(false);
    run(e, 1);
    expect(e.removable).toBe(true);
  });

  it('死亡後の被弾はダメージにならず、状態も変わらない', () => {
    const e = make();
    e.takeHit(hit({ damage: 999 }));
    const serial = e.hitSerial;
    const r = e.takeHit(hit());
    expect(r).toEqual({ dealt: 0, killed: false });
    expect(e.hitSerial).toBe(serial);
    expect(e.dead).toBe(true);
  });

  it('待機中はプレイヤーの方へ向き直る（旋回速度で）', () => {
    const e = make();
    e.place(0, 5, 0); // 背を向けている
    run(e, 1, 0, 0);
    expect(Math.abs(e.yaw)).toBeCloseTo(ENEMIES.imp.turnSpeed * DT, 6);
    run(e, 120, 0, 0);
    expect(Math.abs(Math.abs(e.yaw) - Math.PI)).toBeLessThan(1e-6);
  });

  it('ひるみ中は向き直らない', () => {
    const e = make();
    e.place(0, 5, 0);
    e.takeHit(hit({ knockback: 0 }));
    run(e, 5, 0, 0);
    expect(e.yaw).toBe(0);
  });
});
