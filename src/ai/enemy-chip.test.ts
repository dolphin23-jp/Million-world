import { describe, expect, it } from 'vitest';
import { Enemy } from './enemy';
import { ENEMIES } from './data/enemies';
import type { HitEvent } from '../combat/hit';

/** 継続の刻み（HitEvent.chip。杖の吹雪・火炎放射。ADR-048）: ダメージとノックバックだけで、ひるませない。見た目の被弾の反応も軽い */
const hit = (over: Partial<HitEvent> = {}): HitEvent => ({ attackerId: 0, targetId: 1, damage: 10, knockback: 0.6, hitStop: 0, dirX: 0, dirZ: 1, x: 0, z: 4.5, ...over });
const make = (type: keyof typeof ENEMIES = 'imp') => {
  const e = new Enemy(ENEMIES[type], 1, 0, 5);
  e.place(0, 5, Math.PI);
  return e;
};
const settle = (e: Enemy, n = 90) => {
  for (let i = 0; i < n; i++) e.step(1 / 60, 0, 0);
};

describe('Enemy: 継続の刻み（chip）', () => {
  it('ダメージは通常どおり減るが、ひるまない（状態が変わらない）。ふつうの命中は、ひるむ', () => {
    const a = make();
    settle(a);
    const stateBefore = a.state;
    const hp0 = a.health.hp;
    const r = a.takeHit(hit({ chip: true }));
    expect(r.dealt).toBe(10);
    expect(a.health.hp).toBe(hp0 - 10);
    expect(a.state).toBe(stateBefore);
    expect(a.state).not.toBe('hit');
    const b = make();
    settle(b);
    b.takeHit(hit());
    expect(b.state).toBe('hit');
  });

  it('見た目の合図: chip は chipSerial だけを増やし（軽い反応）、通常の命中は hitSerial を増やす。とどめは通常の被弾', () => {
    const e = make();
    settle(e);
    e.takeHit(hit({ chip: true }));
    e.takeHit(hit({ chip: true }));
    expect(e.chipSerial).toBe(2);
    expect(e.hitSerial).toBe(0);
    e.takeHit(hit());
    expect(e.hitSerial).toBe(1);
    expect(e.chipSerial).toBe(2);
    const k = make();
    settle(k);
    k.health.hp = 5;
    const r = k.takeHit(hit({ chip: true }));
    expect(r.killed).toBe(true);
    expect(k.dead).toBe(true);
    expect(k.hitSerial).toBe(1);
  });

  it('体勢ゲージ（poise）は削れる = 刻みが続けば崩せる（ひるまないぶん、崩しが効く）', () => {
    const e = make('ogre');
    e.health.hp = e.health.max = 100000;
    settle(e);
    expect(e.poise).toBeDefined();
    const ratio0 = e.poise!.ratio;
    e.takeHit(hit({ chip: true, damage: 12 }));
    expect(e.poise!.ratio).toBeLessThan(ratio0);
  });

  it('ノックバックは受ける（刻みの向き = プレイヤーから離れる向きへ押される。受けない場合より遠くなる）', () => {
    const control = make();
    settle(control, 10);
    const pushed = make();
    settle(pushed, 0);
    pushed.takeHit(hit({ chip: true, knockback: 1.5, dirZ: 1 }));
    settle(pushed, 10);
    expect(pushed.body.z).toBeGreaterThan(control.body.z + 0.5);
  });
});
