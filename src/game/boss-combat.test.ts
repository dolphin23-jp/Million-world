import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { resolveEnemyAttacks, resolvePlayerAttack, type CombatTarget } from './combat';
import { cutProjectiles, resolveProjectilesOnPlayer, resolveReflectedProjectiles } from './projectile-combat';
import { Enemy } from '../ai/enemy';
import { ENEMIES } from '../ai/data/enemies';
import { BOSS_POISE_BREAK } from '../combat/data/poise';
import { PROJECTILES } from '../combat/data/projectiles';
import { ProjectileSystem, spawnShot, type Projectile, type ProjectileEnd } from '../combat/projectile';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import type { HitEvent } from '../combat/hit';
import type { LoadoutId } from '../combat/data/loadouts';
import { ARENA_RADIUS } from '../world/arena';

/**
 * ボス「夜行の大将」（ADR-029）と本物の Player の結合テスト。Game.step と同じ順序で 1 フレームずつ進める。
 * カメラ yaw = π のとき、スティックの上は +Z。ボスは (0, z) に置いてプレイヤー（原点）の方を向く。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const DEF = ENEMIES.boss;
const WISP = PROJECTILES.wisp;

interface Scene {
  player: Player;
  boss: Enemy;
  system: ProjectileSystem;
  hurt: HitEvent[];
  blocked: HitEvent[];
  parried: HitEvent[];
  step(over?: Partial<InputIntent>): void;
  run(n: number, over?: Partial<InputIntent>): void;
}

function scene(z: number, loadout: LoadoutId = 'sword', hpScale = 1): Scene {
  const player = new Player();
  player.equip(loadout);
  const boss = new Enemy(DEF, 1, 0, z);
  boss.place(0, z, Math.PI);
  if (hpScale < 1) boss.health.hp = Math.round(boss.health.max * hpScale);
  const system = new ProjectileSystem();
  let seenFire = 0;
  const sc: Scene = {
    player,
    boss,
    system,
    hurt: [],
    blocked: [],
    parried: [],
    step(over = {}) {
      player.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
      boss.step(DT, player.body.x, player.body.z, !player.dead);
      if (boss.fireSerial !== seenFire) {
        seenFire = boss.fireSerial;
        spawnShot(system, boss.id, boss.body.x, boss.body.z, boss.shot);
      }
      system.step(DT, ARENA_RADIUS);
      const onEnd = (_p: Projectile, _r: ProjectileEnd): void => undefined;
      resolvePlayerAttack(player, [boss as CombatTarget], () => undefined);
      cutProjectiles(system, player, onEnd);
      resolveEnemyAttacks([boss], player, (ev) => sc.hurt.push(ev), { onGuard: (ev) => sc.blocked.push(ev), onParry: (ev) => sc.parried.push(ev) });
      resolveProjectilesOnPlayer(system, player, (id) => (id === boss.id && !boss.dead ? boss.body : null), {
        onHit: (ev) => sc.hurt.push(ev),
        onGuard: (ev) => sc.blocked.push(ev),
        onParry: (ev) => sc.parried.push(ev),
        onEnd,
      });
      resolveReflectedProjectiles(system, [boss as CombatTarget], () => undefined, onEnd);
    },
    run(n, over) {
      for (let i = 0; i < n; i++) sc.step(over);
    },
  };
  return sc;
}

const hit = (damage: number): HitEvent => ({ attackerId: 0, targetId: 1, damage, knockback: 0, hitStop: 0, dirX: 0, dirZ: 1, x: 0, z: 0 });

/** ボスの最初の予備動作に入るまで進めて、その技の名前 */
function firstMoveId(z: number, id: number, hpScale = 1): string {
  const e = new Enemy(DEF, id, 0, z);
  e.place(0, z, Math.PI);
  e.health.hp = Math.round(e.health.max * hpScale);
  for (let i = 0; i < 600 && e.state !== 'windup'; i++) e.step(DT, 0, 0);
  return e.attackDef.id!;
}

describe('ボス: 段階と技の解放', () => {
  it('HP 900・体勢 140・ボス。HP 66% と 33% で段階が上がる（594 / 297）', () => {
    const e = new Enemy(DEF, 1, 0, 9);
    expect(e.health.max).toBe(900);
    expect(e.poise!.value).toBe(140);
    expect(DEF.boss).toBe(true);
    expect(e.phase).toBe(0);
    e.takeHit(hit(305)); // 595
    expect(e.phase).toBe(0);
    e.takeHit(hit(2)); // 593
    expect(e.phase).toBe(1);
    e.takeHit(hit(300)); // 293
    expect(e.phase).toBe(2);
    expect(e.phaseSerial).toBe(2);
  });

  it('段階 0 では、近距離は地ならし、遠距離は連弾だけ。号令・輪は選ばれない', () => {
    for (let id = 1; id <= 16; id++) {
      expect(firstMoveId(3.5, id)).toBe('pound');
      expect(firstMoveId(10, id)).toBe('volley');
    }
  });

  it('段階 1 から号令が、段階 2 から輪が、選ばれるようになる（距離にかかわらず）', () => {
    const seen1 = new Set<string>();
    const seen2 = new Set<string>();
    for (let id = 1; id <= 60; id++) {
      seen1.add(firstMoveId(10, id, 0.6));
      seen2.add(firstMoveId(10, id, 0.3));
    }
    expect(seen1.has('summon')).toBe(true);
    expect(seen1.has('ring')).toBe(false);
    expect(seen2.has('ring')).toBe(true);
    expect(seen2.has('summon')).toBe(true);
    for (const m of [...seen1, ...seen2]) expect(['pound', 'volley', 'summon', 'ring']).toContain(m);
  });

  it('号令は、判定が出る瞬間に 1 回だけ召喚の合図が出る（小蝙蝠 3 体・半径 3.4m）。近接の判定は出ない', () => {
    const sc = scene(12, 'sword', 0.6);
    let summoned = false;
    for (let i = 0; i < 1500 && !summoned; i++) {
      sc.step();
      if (sc.boss.summonSerial > 0) summoned = true;
    }
    // 号令が選ばれなければ、選ばれるまで別の id で
    if (!summoned) {
      for (let id = 2; id <= 40 && !summoned; id++) {
        const e = new Enemy(DEF, id, 0, 12);
        e.place(0, 12, Math.PI);
        e.health.hp = 540;
        for (let i = 0; i < 1500 && e.summonSerial === 0; i++) e.step(DT, 0, 0);
        if (e.summonSerial > 0) {
          expect(e.summon).toEqual({ type: 'bat', count: 3, radius: 3.4, max: 6 });
          expect(e.attackActive).toBe(false);
          summoned = true;
        }
      }
    } else {
      expect(sc.boss.summon).toEqual({ type: 'bat', count: 3, radius: 3.4, max: 6 });
    }
    expect(summoned).toBe(true);
  });
});

describe('ボス: 地ならし（全周・ガード不能）', () => {
  it('盾で構えていても被弾する（ガード・パリィが効かない）。ダメージ 36', () => {
    const sc = scene(3.2, 'sword-shield');
    while (!(sc.boss.state === 'windup' && sc.boss.stateFrame >= 56) && sc.hurt.length === 0) sc.step();
    expect(sc.boss.attackDef.id).toBe('pound');
    sc.step({ guardPressed: true, guardHeld: true });
    for (let i = 0; i < 60 && sc.hurt.length === 0; i++) sc.step({ guardHeld: true });
    expect(sc.hurt).toHaveLength(1);
    expect(sc.hurt[0]!.damage).toBe(36);
    expect(sc.blocked).toHaveLength(0);
    expect(sc.parried).toHaveLength(0);
  });

  it('円の外（半径 3.6m + 体）へ出れば避けられる', () => {
    const sc = scene(3.2);
    while (!(sc.boss.state === 'windup' && sc.boss.stateFrame >= 2)) sc.step();
    sc.run(60, { moveY: -1 }); // ボス（+Z 側）から離れる
    sc.run(60);
    expect(sc.hurt).toHaveLength(0);
    expect(sc.boss.impactSerial).toBeGreaterThanOrEqual(1);
  });
});

describe('ボス: 鬼火の連弾（扇に 5 発）', () => {
  it('撃つと、扇に 5 本の弾が出る（広がり 1.3rad。中心の向きはプレイヤー。体の外 = 銃口 1.8m）', () => {
    const sc = scene(10);
    for (let i = 0; i < 600 && sc.boss.fireSerial === 0; i++) sc.step();
    expect(sc.boss.fireSerial).toBe(1);
    expect(sc.boss.attackDef.id).toBe('volley');
    const alive = sc.system.pool.filter((p) => p.alive);
    expect(alive).toHaveLength(5);
    // −Z（プレイヤーの方）からの角度（±π の継ぎ目をまたがないよう、−Z を 0 とする）。中心は 0、±0.65rad で広がる
    const devs = alive.map((p) => Math.atan2(p.dirX, -p.dirZ)).sort((a, b) => a - b);
    expect(devs[2]!).toBeCloseTo(0, 6);
    expect(devs[devs.length - 1]! - devs[0]!).toBeCloseTo(1.3, 6);
    for (const p of alive) expect(Math.hypot(p.x - 0, p.z - 10)).toBeLessThan(2.2);
    expect(Math.min(...alive.map((p) => Math.hypot(p.x, p.z - 10)))).toBeGreaterThan(1.5);
  });

  it('立っていると真ん中の 1 発が当たる（10）。横へ大きく動く・ロールで避けられる', () => {
    const stand = scene(10);
    stand.run(400);
    expect(stand.hurt.length).toBeGreaterThanOrEqual(1);
    expect(stand.hurt[0]!.damage).toBe(WISP.damage);

    const roll = scene(10);
    for (let i = 0; i < 600 && roll.boss.fireSerial === 0; i++) roll.step();
    const dist = (): number => Math.min(...roll.system.pool.filter((p) => p.alive).map((p) => Math.hypot(p.x - roll.player.body.x, p.z - roll.player.body.z)));
    while (dist() > 2.2 && roll.hurt.length === 0) roll.step();
    roll.step({ dodgePressed: true, moveX: 1 });
    roll.run(30);
    expect(roll.hurt).toHaveLength(0);
  });

  it('盾のパリィで真ん中の 1 発を弾き返すと、ボスに 60 のダメージと体勢ダメージが入る', () => {
    const sc = scene(10, 'sword-shield');
    for (let i = 0; i < 600 && sc.boss.fireSerial === 0; i++) sc.step();
    const nearest = (): Projectile | undefined => sc.system.pool.filter((p) => p.alive && p.team === 'enemy').sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
    while (nearest() && Math.hypot(nearest()!.x - sc.player.body.x, nearest()!.z - sc.player.body.z) > 1.9) sc.step();
    sc.step({ guardPressed: true, guardHeld: true });
    for (let i = 0; i < 20 && sc.parried.length === 0 && sc.hurt.length === 0; i++) sc.step({ guardHeld: true });
    expect(sc.parried).toHaveLength(1);
    const hp0 = sc.boss.health.hp;
    const poise0 = sc.boss.poise!.value;
    for (let i = 0; i < 120 && sc.boss.health.hp === hp0; i++) sc.step({ guardHeld: true });
    expect(hp0 - sc.boss.health.hp).toBe(WISP.reflect.damage);
    expect(poise0 - sc.boss.poise!.value).toBe(WISP.reflect.damage);
    expect(sc.boss.state).not.toBe('stagger'); // 体勢 140 のうち 60 では崩れない
  });
});

describe('ボス: 鬼火の輪（全周に 8 発）と体勢崩し', () => {
  it('輪は 8 本が等間隔（45°）で全周に出る。体の外（銃口 1.9m）から放射状', () => {
    const sc = scene(10, 'sword', 0.3);
    let ring = false;
    for (let id = 1; id <= 60 && !ring; id++) {
      const e = new Enemy(DEF, id, 0, 10);
      e.place(0, 10, Math.PI);
      e.health.hp = 250;
      const sys = new ProjectileSystem();
      for (let i = 0; i < 1500 && e.fireSerial === 0; i++) e.step(DT, 0, 0);
      if (e.fireSerial > 0 && e.attackDef.id === 'ring') {
        spawnShot(sys, e.id, e.body.x, e.body.z, e.shot);
        const ps = sys.pool.filter((p) => p.alive);
        expect(ps).toHaveLength(8);
        const angles = ps.map((p) => Math.atan2(p.dirX, p.dirZ)).sort((a, b) => a - b);
        for (let i = 1; i < angles.length; i++) expect(angles[i]! - angles[i - 1]!).toBeCloseTo(Math.PI / 4, 6);
        ring = true;
      }
    }
    expect(ring).toBe(true);
    expect(sc.boss.phase).toBe(2);
  });

  it('体勢 140 を削り切ると、2 秒の体勢崩し（反撃 1.6 倍）。予備動作中なら攻撃を中断させる', () => {
    const sc = scene(3.2);
    while (!(sc.boss.state === 'windup' && sc.boss.stateFrame >= 20)) sc.step();
    sc.boss.takeHit(hit(100));
    expect(sc.boss.state).toBe('windup');
    sc.boss.takeHit(hit(40));
    expect(sc.boss.state).toBe('stagger');
    expect(sc.boss.parryEffect).toBe(BOSS_POISE_BREAK);
    expect(sc.boss.riposte).toBe(BOSS_POISE_BREAK);
    expect(BOSS_POISE_BREAK.frames).toBe(120);
    sc.run(150);
    expect(sc.hurt.filter((h) => h.damage === 36)).toHaveLength(0);
  });
});
