import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { resolveEnemyAttacks, resolvePlayerAttack, type CombatTarget } from './combat';
import { cutProjectiles, resolveProjectilesOnPlayer, resolveReflectedProjectiles } from './projectile-combat';
import { Enemy } from '../ai/enemy';
import { ENEMIES } from '../ai/data/enemies';
import { PROJECTILES } from '../combat/data/projectiles';
import { PARRY_EFFECTS } from '../combat/data/guard';
import { GUARDS } from '../combat/data/guard';
import { guardedDamage } from '../combat/guard';
import { ProjectileSystem, type Projectile, type ProjectileEnd } from '../combat/projectile';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import type { HitEvent } from '../combat/hit';
import type { LoadoutId } from '../combat/data/loadouts';
import { ARENA_RADIUS } from '../world/arena';

/**
 * 提灯（遠距離型。ADR-026）と本物の Player の結合テスト。Game.step と同じ順序で 1 フレームずつ進める。
 * カメラ yaw = π のとき、スティックの上は +Z、右は −X、左は +X。提灯は (0, z) に置いてプレイヤー（原点）の方を向く。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const ATK = ENEMIES.lantern.attack;
const WISP = PROJECTILES.wisp;

interface Scene {
  player: Player;
  enemy: Enemy;
  system: ProjectileSystem;
  hurt: HitEvent[];
  guarded: HitEvent[];
  parried: HitEvent[];
  /** 弾き返した弾が敵に当たった（ダメージ） */
  reflectedHits: { damage: number; killed: boolean }[];
  ends: ProjectileEnd[];
  step(over?: Partial<InputIntent>): void;
  run(n: number, over?: Partial<InputIntent>): void;
  /** 提灯の弾が飛んでいる間、最初の 1 発 */
  orb(): Projectile | undefined;
  /** 弾が撃たれるまで進める */
  toFire(): Projectile;
  /** 弾までの距離（プレイヤーの中心から） */
  orbDist(): number;
}

function scene(loadout: LoadoutId = 'sword', z = 6.5): Scene {
  const player = new Player();
  player.equip(loadout);
  const enemy = new Enemy(ENEMIES.lantern, 1, 0, z);
  enemy.place(0, z, Math.PI);
  const system = new ProjectileSystem();
  let seenFire = 0;
  const sc: Scene = {
    player,
    enemy,
    system,
    hurt: [],
    guarded: [],
    parried: [],
    reflectedHits: [],
    ends: [],
    step(over = {}) {
      player.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
      enemy.step(DT, player.body.x, player.body.z, !player.dead);
      if (enemy.fireSerial !== seenFire) {
        seenFire = enemy.fireSerial;
        const s = enemy.shot;
        system.spawn(PROJECTILES[s.projectile], enemy.id, s.x, s.z, s.dirX, s.dirZ);
      }
      system.step(DT, ARENA_RADIUS, (_p, r) => sc.ends.push(r));
      const onEnd = (_p: Projectile, r: ProjectileEnd): void => void sc.ends.push(r);
      resolvePlayerAttack(player, [enemy as CombatTarget], () => undefined);
      cutProjectiles(system, player, onEnd);
      resolveEnemyAttacks([enemy], player, (ev) => sc.hurt.push(ev));
      resolveProjectilesOnPlayer(system, player, (id) => (id === enemy.id && !enemy.dead ? enemy.body : null), {
        onHit: (ev) => sc.hurt.push(ev),
        onGuard: (ev) => sc.guarded.push(ev),
        onParry: (ev) => sc.parried.push(ev),
        onEnd,
      });
      resolveReflectedProjectiles(system, [enemy as CombatTarget], (ev, _t, r) => sc.reflectedHits.push({ damage: ev.damage, killed: r.killed }), onEnd);
    },
    run(n, over) {
      for (let i = 0; i < n; i++) sc.step(over);
    },
    orb() {
      return system.pool.find((p) => p.alive);
    },
    toFire() {
      for (let i = 0; i < 400 && enemy.fireSerial === 0; i++) sc.step();
      expect(enemy.fireSerial).toBe(1);
      return sc.orb()!;
    },
    orbDist() {
      const p = sc.orb();
      return p ? Math.hypot(p.x - player.body.x, p.z - player.body.z) : Infinity;
    },
  };
  return sc;
}

describe('提灯（遠距離型）の撃つ弾', () => {
  it('距離 6.5m から予備動作に入り、固定した向きへ鬼火を 1 つ撃つ（銃口は前へ 0.8m）', () => {
    const sc = scene();
    const p = sc.toFire();
    expect(p.team).toBe('enemy');
    expect(p.ownerId).toBe(1);
    expect(p.dirX).toBeCloseTo(0, 6);
    expect(p.dirZ).toBeCloseTo(-1, 6);
    expect(p.z).toBeLessThan(6.5 - WISP.muzzle + 0.01);
    expect(p.z).toBeGreaterThan(6.5 - WISP.muzzle - WISP.speed / 60 - 0.01); // 撃った同じステップで 1 フレームぶん進んでいる
    expect(sc.enemy.attackActive).toBe(false); // 近接の判定は出ない
    expect(sc.enemy.state).toBe('attack');
  });

  it('立ち止まっていると当たる（ダメージ 10）。1 発で 1 回だけ。弾は消える', () => {
    const sc = scene();
    sc.run(200);
    expect(sc.hurt).toHaveLength(1);
    expect(sc.hurt[0]!.damage).toBe(WISP.damage);
    expect(sc.player.health.hp).toBe(100 - WISP.damage);
    expect(sc.ends[0]).toBe('hit');
    // 向きは弾の飛んできた向き（提灯 → プレイヤー = −Z）。被弾でその向きを向く
    expect(sc.hurt[0]!.dirZ).toBeCloseTo(-1, 6);
  });

  it('向きが固定されたあとに、横へ 1m 以上動けば当たらない。弾は通り過ぎて消える', () => {
    const sc = scene();
    for (let i = 0; i < 300 && !(sc.enemy.state === 'windup' && sc.enemy.stateFrame >= ATK.windupTrackFrames + 1); i++) sc.step();
    expect(sc.enemy.state).toBe('windup');
    sc.run(20, { moveX: 1 });
    expect(Math.abs(sc.player.body.x)).toBeGreaterThan(1.0);
    // 最初の 1 発が縁で消えるまで（そのあと提灯は硬直・待ちを経て次の 1 発を撃つ。ここでは見ない）
    sc.run(100);
    expect(sc.enemy.fireSerial).toBe(1);
    expect(sc.hurt).toHaveLength(0);
    expect(['expire', 'wall']).toContain(sc.ends[0]); // 寿命（12.6m）か縁。アリーナの中央から撃てば寿命で消える
    expect(sc.system.aliveCount).toBe(0);
  });

  it('ロール（無敵）でも避けられる。弾が近づいたところで横へ転がれば、すり抜ける', () => {
    const sc = scene();
    sc.toFire();
    while (sc.orbDist() > 2.2 && sc.hurt.length === 0) sc.step();
    sc.step({ dodgePressed: true, moveX: 1 });
    sc.run(60);
    expect(sc.hurt).toHaveLength(0);
  });

  it('向きが固定される前に横へ動いても、提灯は追って向き直る（固定されるのは後半だけ）', () => {
    const sc = scene();
    for (let i = 0; i < 300 && !(sc.enemy.state === 'windup' && sc.enemy.stateFrame >= 6); i++) sc.step();
    const early = sc.enemy.yaw;
    sc.run(14, { moveX: 1 }); // まだ追っているあいだに横へ
    expect(sc.enemy.state).toBe('windup');
    expect(sc.enemy.stateFrame).toBeLessThan(ATK.windupTrackFrames);
    expect(sc.enemy.yaw).not.toBeCloseTo(early, 2);
  });
});

describe('提灯の弾を防ぐ', () => {
  it('ガード（盾）: 受け止めて削りだけ通る（10 → 2）。弾は消え、被弾にはならない', () => {
    const sc = scene('sword-shield');
    sc.toFire();
    // パリィの受付（10f）が過ぎてから弾が着くよう、早めに構えて待つ
    sc.step({ guardPressed: true, guardHeld: true });
    sc.run(20, { guardHeld: true });
    expect(sc.parried).toHaveLength(0);
    while (sc.guarded.length === 0 && sc.hurt.length === 0 && sc.system.aliveCount > 0) sc.step({ guardHeld: true });
    expect(sc.hurt).toHaveLength(0);
    expect(sc.guarded).toHaveLength(1);
    expect(sc.ends).toContain('guard');
    expect(sc.player.health.hp).toBe(100 - guardedDamage(WISP.damage, GUARDS.shield));
  });

  it('ガードは構えの正面だけ: 横を向いて構えていると被弾する（コーン外）', () => {
    const sc = scene('sword-shield');
    sc.toFire();
    // 提灯（+Z）に背を向けるよう走り（スティック下 = −Z）、そのまま構える
    sc.run(14, { moveY: -1 });
    sc.step({ guardPressed: true, guardHeld: true });
    sc.run(6, { guardHeld: true });
    expect(sc.player.state).toBe('guard');
    while (sc.hurt.length === 0 && sc.guarded.length === 0 && sc.system.aliveCount > 0) sc.step({ guardHeld: true });
    expect(sc.guarded).toHaveLength(0);
  });

  it('パリィ（盾）: 着く直前に構えると弾き返し、弾は撃った提灯へ飛んで一撃で倒す（ダメージ 60 ≥ 体力 50）', () => {
    const sc = scene('sword-shield');
    sc.toFire();
    // 構えてから弾が着くまで 10f 以内に収まるよう、弾が約 1.9m（= 着くまで約 8f）まで来てから構える
    while (sc.orbDist() > 1.9) sc.step();
    sc.step({ guardPressed: true, guardHeld: true });
    for (let i = 0; i < 20 && sc.parried.length === 0 && sc.hurt.length === 0; i++) sc.step({ guardHeld: true });
    expect(sc.parried).toHaveLength(1);
    expect(sc.hurt).toHaveLength(0);
    expect(sc.player.health.hp).toBe(100);
    const p = sc.orb()!;
    expect(p.team).toBe('player');
    expect(p.speed).toBeCloseTo(WISP.speed * WISP.reflect.speedScale, 9);
    // 撃った提灯（0, ~5.7）の方へ戻る
    expect(p.dirZ).toBeGreaterThan(0.99);
    for (let i = 0; i < 90 && !sc.enemy.dead; i++) sc.step({ guardHeld: true });
    expect(sc.reflectedHits).toEqual([{ damage: WISP.reflect.damage, killed: true }]);
    expect(sc.enemy.dead).toBe(true);
    expect(sc.system.aliveCount).toBe(0);
  });

  it('パリィで弾き返した弾は、撃った提灯が横へずれていても、その位置を狙う', () => {
    const sc = scene('sword-shield');
    sc.toFire();
    // 提灯を斜めへ動かす（撃ったあとに動いた体）
    sc.enemy.place(3, 5.5, Math.PI);
    while (sc.orbDist() > 1.9) sc.step();
    sc.step({ guardPressed: true, guardHeld: true });
    for (let i = 0; i < 20 && sc.parried.length === 0; i++) sc.step({ guardHeld: true });
    expect(sc.parried).toHaveLength(1);
    const p = sc.orb()!;
    expect(p.dirX).toBeGreaterThan(0.3); // 提灯の側（+X）へ曲がる
  });

  it('パリィの受付に間に合わなければガード（盾の受付 10f を過ぎている）', () => {
    const sc = scene('sword-shield');
    sc.toFire();
    while (sc.orbDist() > 4) sc.step();
    sc.step({ guardPressed: true, guardHeld: true });
    sc.run(14, { guardHeld: true });
    while (sc.parried.length === 0 && sc.guarded.length === 0 && sc.hurt.length === 0) sc.step({ guardHeld: true });
    expect(sc.parried).toHaveLength(0);
    expect(sc.guarded).toHaveLength(1);
  });

  it('大剣のパリィ（受付 6f）も弾き返せる。弾き返しの演出は構えごとの効果（ダウン）', () => {
    const sc = scene('greatsword');
    sc.toFire();
    while (sc.orbDist() > 1.4) sc.step();
    sc.step({ guardPressed: true, guardHeld: true });
    for (let i = 0; i < 20 && sc.parried.length === 0 && sc.hurt.length === 0; i++) sc.step({ guardHeld: true });
    expect(sc.parried).toHaveLength(1);
    expect(sc.hurt).toHaveLength(0);
    expect(GUARDS.greatsword.parryEffect).toBe('down');
    expect(PARRY_EFFECTS.down.sfx).toBe('parryDown');
    for (let i = 0; i < 90 && !sc.enemy.dead; i++) sc.step({ guardHeld: true });
    expect(sc.enemy.dead).toBe(true);
  });

  it('素手（パリィなし）のガードは、構えていても受け止めるだけ（軽減 50%）', () => {
    const sc = scene('sword');
    sc.toFire();
    while (sc.orbDist() > 1.9) sc.step();
    sc.step({ guardPressed: true, guardHeld: true });
    for (let i = 0; i < 20 && sc.guarded.length === 0 && sc.hurt.length === 0; i++) sc.step({ guardHeld: true });
    expect(sc.parried).toHaveLength(0);
    expect(sc.guarded).toHaveLength(1);
    expect(sc.player.health.hp).toBe(100 - guardedDamage(WISP.damage, GUARDS.sword));
  });

  it('斬り落とせる: 弾が振りの範囲に入るタイミングで攻撃すれば、ダメージなしで弾が消える', () => {
    // 押すタイミングを 1 フレームずつずらして探す（どこかで必ず斬れ、斬れなければ当たる）
    let cutAt = -1;
    for (let wait = 0; wait < 30 && cutAt < 0; wait++) {
      const sc = scene('sword');
      sc.toFire();
      for (let i = 0; i < wait; i++) sc.step();
      sc.step({ attackPressed: true });
      sc.run(40);
      if (sc.ends.includes('cut')) {
        cutAt = wait;
        expect(sc.hurt).toHaveLength(0);
        expect(sc.player.health.hp).toBe(100);
      }
    }
    expect(cutAt).toBeGreaterThanOrEqual(0);
  });

  it('cutProjectiles: 判定の出ていない構えでは斬れない。弾き返した弾は斬らない', () => {
    const sc = scene('sword');
    const sys = new ProjectileSystem();
    const p = sys.spawn(WISP, 1, 0, 1.0, 0, -1);
    expect(cutProjectiles(sys, sc.player)).toBe(0); // 攻撃していない
    // 攻撃の持続フレームまで進める
    sc.player.step(DT, { ...createEmptyIntent(), attackPressed: true }, CAM_YAW);
    for (let i = 0; i < 60 && !sc.player.attackActive; i++) sc.player.step(DT, createEmptyIntent(), CAM_YAW);
    expect(sc.player.attackActive).toBe(true);
    p.team = 'player';
    expect(cutProjectiles(sys, sc.player)).toBe(0);
    p.team = 'enemy';
    expect(cutProjectiles(sys, sc.player)).toBe(1);
    expect(p.alive).toBe(false);
    expect(p.end).toBe('cut');
  });
});

describe('提灯の動き', () => {
  it('近づかれる（距離 3m < 4.5m）と、プレイヤーの方を向いたまま後ろへ下がり、4.5m で止まる', () => {
    const e = new Enemy(ENEMIES.lantern, 1, 0, 3);
    e.place(0, 3, Math.PI);
    for (let i = 0; i < ENEMIES.lantern.spawnIdleFrames + 20; i++) e.step(DT, 0, 0, true, false);
    expect(e.state).toBe('chase');
    // 20f（0.33 秒）で 1m 近く下がる（3.4m/s）。まだ下がっている途中
    expect(e.body.z).toBeGreaterThan(3.9);
    expect(e.body.z).toBeLessThan(4.4);
    for (let i = 0; i < 60; i++) e.step(DT, 0, 0, true, false);
    expect(e.body.z).toBeGreaterThan(ENEMIES.lantern.retreatDistance - 0.06);
    expect(e.body.z).toBeLessThan(ENEMIES.lantern.retreatDistance + 0.2);
    expect(Math.sin(e.yaw)).toBeCloseTo(0, 3);
    expect(Math.cos(e.yaw)).toBeLessThan(-0.99);
  });

  it('退く距離（4.5m）と近づく距離（6.5m）の間では動かず、遠ければ近づく', () => {
    const hold = new Enemy(ENEMIES.lantern, 1, 0, 5.5);
    hold.place(0, 5.5, Math.PI);
    for (let i = 0; i < 80; i++) hold.step(DT, 0, 0, true, false);
    expect(hold.body.z).toBeCloseTo(5.5, 6);
    const far = new Enemy(ENEMIES.lantern, 1, 0, 10);
    far.place(0, 10, Math.PI);
    for (let i = 0; i < 100; i++) far.step(DT, 0, 0, true, false);
    expect(far.body.z).toBeLessThan(9.5);
  });

  it('予備動作の途中でひるまされる（スーパーアーマーなし）と、撃たずに終わる', () => {
    const e = new Enemy(ENEMIES.lantern, 1, 0, 6.5);
    e.place(0, 6.5, Math.PI);
    for (let i = 0; i < 300 && !(e.state === 'windup' && e.stateFrame >= 20); i++) e.step(DT, 0, 0);
    expect(e.state).toBe('windup');
    e.takeHit({ attackerId: 0, targetId: 1, damage: 12, knockback: 1, hitStop: 4, dirX: 0, dirZ: 1, x: 0, z: 0 });
    expect(e.state).toBe('hit');
    for (let i = 0; i < 30; i++) e.step(DT, 0, 0);
    expect(e.fireSerial).toBe(0);
  });

  it('撃ったあとの硬直（recover）は動けない。弾は 1 攻撃に 1 発', () => {
    const sc = scene();
    sc.toFire();
    sc.run(ATK.recoverFrames - 2);
    expect(sc.enemy.fireSerial).toBe(1);
    expect(sc.enemy.state).toBe('attack');
  });

  it('提灯の体力は 50 で、弾き返しの 60 で足りる。通常の斬り（片手剣 combo1）は 2〜3 発', () => {
    expect(ENEMIES.lantern.hp).toBeLessThanOrEqual(WISP.reflect.damage);
  });
});
