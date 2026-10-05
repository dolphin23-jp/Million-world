import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { Enemy } from '../ai/enemy';
import { ENEMIES } from '../ai/data/enemies';
import { HAZARD_RULES } from '../combat/data/hazards';
import { BASE_MODIFIERS } from '../combat/modifiers';
import { createEmptyIntent } from '../input/intent';
import { ARENA_WORLD } from '../world/data/arena-props';
import { HAZARD_TOP, World } from '../world/world';

/** 床の危険地帯（M7-4e。ADR-046）: プレイヤー・敵が受ける継続ダメージの単位。判定の間隔・場所は Game（撮影シーンで確認） */

describe('Player.takeEnvironmentDamage: 環境のダメージ', () => {
  it('ダメージだけ受ける: ひるまず、状態も変わらず、無敵もつかない（攻撃・回避・ガードは続けられる）', () => {
    const p = new Player();
    const hp0 = p.health.hp;
    const state0 = p.state;
    const r = p.takeEnvironmentDamage(HAZARD_RULES.fire.playerDamage);
    expect(r.killed).toBe(false);
    expect(r.dealt).toBe(HAZARD_RULES.fire.playerDamage);
    expect(p.health.hp).toBe(hp0 - HAZARD_RULES.fire.playerDamage);
    expect(p.state).toBe(state0);
    expect(p.body.invulnerable).toBe(false);
    // 攻撃の最中に受けても、攻撃は途切れない
    p.step(1 / 60, { ...createEmptyIntent(), attackPressed: true }, Math.PI);
    p.step(1 / 60, createEmptyIntent(), Math.PI);
    expect(p.state).toBe('attack');
    p.takeEnvironmentDamage(5);
    expect(p.state).toBe('attack');
  });

  it('防御の軽減（damageTaken）を受ける。最低 1', () => {
    const p = new Player();
    p.setModifiers({ ...BASE_MODIFIERS, damageTaken: 0.5 });
    expect(p.takeEnvironmentDamage(6).dealt).toBe(3);
    expect(p.takeEnvironmentDamage(1).dealt).toBe(1);
  });

  it('HP が 0 になれば死亡する（敵の攻撃で倒れたときと同じ。動きは止まり、入力を受けない）', () => {
    const p = new Player();
    p.health.hp = 3;
    const r = p.takeEnvironmentDamage(5);
    expect(r.killed).toBe(true);
    expect(r.dealt).toBe(3);
    expect(p.dead).toBe(true);
    expect(p.state).toBe('dead');
    const z0 = p.body.z;
    for (let i = 0; i < 30; i++) p.step(1 / 60, { ...createEmptyIntent(), moveY: 1 }, Math.PI);
    expect(p.body.z).toBeCloseTo(z0, 1);
  });
});

describe('Enemy.burn: 燃える敵', () => {
  const imp = (): Enemy => new Enemy({ ...ENEMIES.imp, aggroRange: 99, spawnIdleFrames: 0 }, 1, 0, 0);

  it('ダメージだけ受ける: ひるまず、予備動作・攻撃も中断されない', () => {
    const e = imp();
    e.place(0, 1.2, Math.PI);
    for (let i = 0; i < 200 && e.state !== 'windup'; i++) e.step(1 / 60, 0, 0, true, true, 0);
    expect(e.state).toBe('windup');
    const hp0 = e.health.hp;
    const r = e.burn(HAZARD_RULES.fire.enemyDamage);
    expect(r.dealt).toBe(HAZARD_RULES.fire.enemyDamage);
    expect(e.health.hp).toBe(hp0 - HAZARD_RULES.fire.enemyDamage);
    expect(e.state).toBe('windup');
    expect(e.hitSerial).toBe(0); // 被弾（ひるみ・閃光）の合図は出さない
  });

  it('HP が 0 になれば死亡する（無敵・dead）。死んだあとは何も起きない', () => {
    const e = imp();
    e.health.hp = 5;
    const r = e.burn(8);
    expect(r.killed).toBe(true);
    expect(e.dead).toBe(true);
    expect(e.body.invulnerable).toBe(true);
    expect(e.burn(8)).toEqual({ dealt: 0, killed: false });
  });
});

describe('炎の床のデータ', () => {
  it('間隔・ダメージが妥当（1 秒止まって受けても致命的でない。敵は人より少し多く受ける）', () => {
    const r = HAZARD_RULES.fire;
    expect(r.tickFrames).toBeGreaterThanOrEqual(15);
    expect(r.playerDamage).toBeGreaterThan(0);
    expect((r.playerDamage * 60) / r.tickFrames).toBeLessThan(20); // 毎秒 20 未満（体力 100）
    expect(r.enemyDamage).toBeGreaterThanOrEqual(r.playerDamage);
  });

  it('闘技場の炎の床は 2 か所。中心の足の低い者が受け、跳べば受けない', () => {
    const w = new World(ARENA_WORLD);
    expect(w.hazards).toHaveLength(2);
    for (const h of w.hazards) {
      expect(w.hazardAt(h.x, h.z, 0)).toBe(h);
      expect(w.hazardAt(h.x, h.z, HAZARD_TOP + 0.01)).toBeNull();
    }
  });
});
