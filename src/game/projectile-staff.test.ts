import { describe, expect, it } from 'vitest';
import { ProjectileSystem } from '../combat/projectile';
import { SPELL_PROJECTILES, PROJECTILES } from '../combat/data/projectiles';
import { SPELLS, BOLT_BURSTS } from '../combat/data/spells';
import { CRIT } from '../combat/data/crit';
import { openWorld } from '../world/world';
import { resolveBoltProjectiles, cutProjectiles, resolveProjectilesOnPlayer, resolveReflectedProjectiles } from './projectile-combat';
import type { CombatTarget } from './combat';
import type { HitEvent, Hurtbox } from '../combat/hit';

/** 杖の魔弾（team 'bolt'。ADR-048）: 最初に当たった 1 体へ。会心は当たったときに抽選。弾き返しの対象にならず、斬り落とされない */
const DT = 1 / 60;
const WORLD = openWorld(30);
const BOLT = SPELL_PROJECTILES.arcaneBolt;

class Target implements CombatTarget {
  readonly body: Hurtbox;
  readonly hits: HitEvent[] = [];
  constructor(id: number, x: number, z: number, r = 0.5) {
    this.body = { id, x, z, r, invulnerable: false };
  }
  takeHit(ev: HitEvent) {
    this.hits.push(ev);
    return { dealt: ev.damage, killed: false };
  }
}

const fire = (sys: ProjectileSystem, damage = 12, kb = 0.6, hs = 3) => sys.spawnBolt(BOLT, 'bolt1', 0, 0.9, 0, 1, damage, kb, hs);

describe('魔弾の飛び道具（spawnBolt）', () => {
  it('杖の先から前へまっすぐ一定の速さで飛ぶ。team は bolt、弾の ダメージ・ノックバック・ヒットストップは撃つ時点の値', () => {
    const sys = new ProjectileSystem();
    const p = fire(sys, 15.6, 0.8, 4);
    expect(p.team).toBe('bolt');
    expect(p.spell).toBe('bolt1');
    expect(p.damage).toBeCloseTo(15.6, 9);
    expect(p.knockback).toBeCloseTo(0.8, 9);
    expect(p.hitStop).toBe(4);
    for (let i = 0; i < 30; i++) sys.step(DT, WORLD);
    expect(p.z).toBeCloseTo(0.9 + (BOLT.speed * 30) / 60, 9);
    expect(p.x).toBeCloseTo(0, 9);
  });

  it('射程は speed × lifetime で、そこで消える。敵の鬼火の弾とは別の表（魔弾は敵の攻撃データから指せない）', () => {
    const sys = new ProjectileSystem();
    const p = fire(sys);
    for (let i = 0; i < BOLT.lifetimeFrames; i++) sys.step(DT, WORLD);
    expect(p.alive).toBe(false);
    expect(p.end).toBe('expire');
    for (const id of Object.keys(SPELL_PROJECTILES)) expect(Object.keys(PROJECTILES)).not.toContain(id);
  });

  it('魔弾の弾の速さは敵の鬼火より速い（走りながら当てやすい）。大魔弾は大きく遅い', () => {
    expect(SPELL_PROJECTILES.arcaneBolt.speed).toBeGreaterThan(PROJECTILES.wisp.speed);
    expect(SPELL_PROJECTILES.arcaneBolt3.radius).toBeGreaterThan(SPELL_PROJECTILES.arcaneBolt.radius);
    expect(SPELL_PROJECTILES.arcaneBolt3.speed).toBeLessThan(SPELL_PROJECTILES.arcaneBolt.speed);
  });

  it('魔弾の魔法はすべて SPELL_PROJECTILES の弾を指す。命中で爆ぜる魔弾（大魔弾）は BOLT_BURSTS に範囲がある', () => {
    for (const s of Object.values(SPELLS)) {
      if (s.kind !== 'bolt') continue;
      expect(Object.keys(SPELL_PROJECTILES), s.id).toContain(s.projectile);
      expect(BOLT_BURSTS[s.id] !== undefined, s.id).toBe(s.burst !== undefined);
    }
    expect(BOLT_BURSTS.bolt3!.warnFrames).toBe(0);
  });
});

describe('魔弾の命中（resolveBoltProjectiles）', () => {
  it('飛んだ線分の始点にいちばん近い 1 体だけに当たり、弾は消える（すり抜けて奥の敵に当たらない）', () => {
    const sys = new ProjectileSystem();
    const near = new Target(1, 0, 5);
    const far = new Target(2, 0, 7);
    fire(sys);
    const ended: string[] = [];
    let total = 0;
    for (let i = 0; i < 40; i++) {
      sys.step(DT, WORLD);
      total += resolveBoltProjectiles(sys, [far, near], {}, () => undefined, (_p, r) => ended.push(r));
    }
    expect(total).toBe(1);
    expect(near.hits.length).toBe(1);
    expect(far.hits.length).toBe(0);
    expect(ended).toEqual(['hit']);
  });

  it('当たりのイベントは、弾の値（ダメージの丸め・ノックバック・ヒットストップ）と飛ぶ向き。会心なら会心ダメージ・ノックバック・ヒットストップが増える', () => {
    const run = (rng: () => number, rate: number) => {
      const sys = new ProjectileSystem();
      const t = new Target(1, 0, 4);
      fire(sys, 12.4, 0.6, 3);
      for (let i = 0; i < 40; i++) {
        sys.step(DT, WORLD);
        resolveBoltProjectiles(sys, [t], { critRate: rate, critDamage: 1.8 }, () => undefined, undefined, rng);
      }
      return t.hits[0]!;
    };
    const plain = run(() => 1, 0.5);
    expect(plain.crit).toBeUndefined();
    expect(plain.damage).toBe(12);
    expect(plain.hitStop).toBe(3);
    expect(plain.dirX).toBeCloseTo(0, 9);
    expect(plain.dirZ).toBeCloseTo(1, 9);
    const crit = run(() => 0, 0.5);
    expect(crit.crit).toBe(true);
    expect(crit.damage).toBe(Math.round(12.4 * 1.8));
    expect(crit.knockback).toBeCloseTo(0.6 * CRIT.knockbackScale, 9);
    expect(crit.hitStop).toBe(3 + CRIT.hitStopBonus);
    // 会心率 0 なら、乱数が 0 でも会心しない
    expect(run(() => 0, 0).crit).toBeUndefined();
  });

  it('倒れている・死んでいる相手（invulnerable）はすり抜ける。敵の弾・弾き返した弾は魔弾の判定に入らない', () => {
    const sys = new ProjectileSystem();
    const down = new Target(1, 0, 4);
    down.body.invulnerable = true;
    const behind = new Target(2, 0, 6);
    fire(sys);
    for (let i = 0; i < 40; i++) {
      sys.step(DT, WORLD);
      resolveBoltProjectiles(sys, [down, behind], {}, () => undefined);
    }
    expect(down.hits.length).toBe(0);
    expect(behind.hits.length).toBe(1);
    // 敵の弾（team enemy）は魔弾の判定では当たらない
    const sys2 = new ProjectileSystem();
    sys2.spawn(PROJECTILES.wisp, 9, 0, 0.9, 0, 1);
    const t = new Target(3, 0, 3);
    for (let i = 0; i < 40; i++) {
      sys2.step(DT, WORLD);
      expect(resolveBoltProjectiles(sys2, [t], {}, () => undefined)).toBe(0);
    }
  });

  it('魔弾は、障害物・アリーナの縁で消える（壁に当たって消える）', () => {
    const sys = new ProjectileSystem();
    const small = openWorld(5);
    const p = fire(sys);
    for (let i = 0; i < 40 && p.alive; i++) sys.step(DT, small);
    expect(p.alive).toBe(false);
    expect(p.end).toBe('wall');
  });

  it('魔弾はプレイヤーの攻撃で斬り落とされず、敵の弾としてプレイヤーに当たらず、パリィの弾き返しの判定にも入らない', () => {
    const sys = new ProjectileSystem();
    const p = fire(sys);
    sys.step(DT, WORLD);
    const player = {
      attackActive: true,
      attack: { hitbox: { kind: 'arc', range: 50, halfAngle: 3 } } as never,
      attackPower: 1,
      body: { id: 0, x: 0, z: 0, r: 0.4, invulnerable: false },
      yaw: 0,
      hitTracker: { has: () => false, add: () => undefined } as never,
    };
    expect(cutProjectiles(sys, player as never)).toBe(0);
    expect(p.alive).toBe(true);
    const victim = { body: { id: 0, x: 0, z: p.z, r: 0.5, invulnerable: false }, takeHit: () => ({ dealt: 0, killed: false }) };
    expect(resolveProjectilesOnPlayer(sys, victim as never, () => null, { onHit: () => undefined })).toBe(0);
    expect(resolveReflectedProjectiles(sys, [new Target(1, 0, p.z)], () => undefined)).toBe(0);
    expect(p.alive).toBe(true);
  });
});
