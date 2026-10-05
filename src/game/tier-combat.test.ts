import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { resolveEnemyAttacks } from './combat';
import { resolveProjectilesOnPlayer } from './projectile-combat';
import { Enemy } from '../ai/enemy';
import { ENEMIES } from '../ai/data/enemies';
import { enemyDef } from '../ai/data/enemy-variants';
import { PROJECTILES } from '../combat/data/projectiles';
import { ProjectileSystem, reflect, spawnShot } from '../combat/projectile';
import { createEmptyIntent } from '../input/intent';
import type { HitEvent } from '../combat/hit';
import { openWorld } from '../world/world';

/**
 * 敵の段階（色違いの強化版。ADR-036）と、本物の Player・Enemy・弾の sim の結合テスト。
 * カメラ yaw = π のとき、スティックの上は +Z。敵は (0, z) に置いてプレイヤー（原点）の方を向く。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const WISP = PROJECTILES.wisp;

describe('強化版の近接: 段階 3 の子鬼', () => {
  /** 近くに置いて、最初の 1 発が当たるまで進める */
  function firstHit(tier: number): { ev: HitEvent; frames: number } {
    const player = new Player();
    const enemy = new Enemy(enemyDef('imp', tier), 1, 0, 1.2);
    enemy.place(0, 1.2, Math.PI);
    let ev: HitEvent | null = null;
    let frames = 0;
    for (let i = 0; i < 400 && !ev; i++) {
      player.step(DT, createEmptyIntent(), CAM_YAW);
      enemy.step(DT, player.body.x, player.body.z, !player.dead);
      resolveEnemyAttacks([enemy], player, (h) => (ev = h));
      frames++;
    }
    expect(ev).not.toBeNull();
    return { ev: ev!, frames };
  }

  it('ダメージが倍率ぶん大きく、予備動作が短いぶん早く当たる', () => {
    const base = firstHit(1);
    const t3 = firstHit(3);
    expect(base.ev.damage).toBe(ENEMIES.imp.attack.damage);
    expect(t3.ev.damage).toBe(Math.round(ENEMIES.imp.attack.damage * 1.65));
    expect(t3.frames).toBeLessThan(base.frames);
    // 当たるまでの短縮は、予備動作の短縮ぶん（見て避けられる長さは残る）
    expect(base.frames - t3.frames).toBeLessThanOrEqual(ENEMIES.imp.attack.windupFrames - enemyDef('imp', 3).attack.windupFrames + 1);
  });

  it('プレイヤーの HP は被ダメージぶん減る（段 1 より多く減る）', () => {
    const hpAfter = (tier: number): number => {
      const player = new Player();
      const enemy = new Enemy(enemyDef('imp', tier), 1, 0, 1.2);
      enemy.place(0, 1.2, Math.PI);
      for (let i = 0; i < 400 && player.health.hp === player.health.max; i++) {
        player.step(DT, createEmptyIntent(), CAM_YAW);
        enemy.step(DT, player.body.x, player.body.z, !player.dead);
        resolveEnemyAttacks([enemy], player, (ev) => player.takeHit(ev));
      }
      return player.health.hp;
    };
    expect(100 - hpAfter(3)).toBeGreaterThan(100 - hpAfter(1));
  });
});

describe('強化版の弾: 提灯', () => {
  /** 提灯を撃たせて、その出どころ（Enemy.shot）から弾を作る */
  function fire(tier: number): { system: ProjectileSystem; enemy: Enemy } {
    const player = new Player();
    const enemy = new Enemy(enemyDef('lantern', tier), 1, 0, 6.5);
    enemy.place(0, 6.5, Math.PI);
    const system = new ProjectileSystem();
    for (let i = 0; i < 500 && enemy.fireSerial === 0; i++) {
      player.step(DT, createEmptyIntent(), CAM_YAW);
      enemy.step(DT, player.body.x, player.body.z, !player.dead);
    }
    expect(enemy.fireSerial).toBe(1);
    spawnShot(system, enemy.id, enemy.body.x, enemy.body.z, enemy.shot);
    return { system, enemy };
  }

  it('段 1・2 は 1 発、段 3 は 3 発、段 4 は 5 発の扇。弾のダメージは段階の倍率（扇は 1 発ずつ弱い）', () => {
    const counts = [1, 2, 3, 4].map((t) => fire(t).system.pool.filter((p) => p.alive).length);
    expect(counts).toEqual([1, 1, 3, 5]);
    expect(fire(1).system.pool.find((p) => p.alive)!.damage).toBe(WISP.damage);
    expect(fire(2).system.pool.find((p) => p.alive)!.damage).toBe(Math.round(WISP.damage * 1.3));
    expect(fire(3).system.pool.find((p) => p.alive)!.damage).toBe(Math.round(WISP.damage * 1.65 * 0.85));
  });

  it('扇の弾は、真ん中の 1 発が撃った向き（−Z）で、左右へ開く（向きが重ならない）', () => {
    const { system } = fire(3);
    const dirs = system.pool.filter((p) => p.alive).map((p) => Math.atan2(p.dirX, p.dirZ));
    expect(new Set(dirs.map((d) => d.toFixed(3))).size).toBe(3);
    const mid = dirs.reduce((a, b) => (Math.abs(Math.abs(b) - Math.PI) < Math.abs(Math.abs(a) - Math.PI) ? b : a));
    expect(Math.abs(mid)).toBeCloseTo(Math.PI, 3);
  });

  it('当たったときのダメージは弾の倍率どおり。弾き返した弾は、同じ段階の提灯の HP に対する割合が段 1 と同じ（一撃で倒せる関係を保つ）', () => {
    // 段 3 の弾 1 発（扇の中の 1 本）を、立っているプレイヤーに当てる
    const { system } = fire(3);
    const p = system.pool.find((q) => q.alive)!;
    expect(p.damage).toBe(Math.round(WISP.damage * 1.65 * 0.85));
    // 弾き返しのダメージ ÷ 提灯の HP は、段階によらず同じ（反射の価値が HP に比例して伸びる）
    const ratio = (tier: number): number => {
      const sys = fire(tier).system;
      const q = sys.pool.find((x) => x.alive)!;
      reflect(q, 0, 1);
      return q.damage / enemyDef('lantern', tier).hp;
    };
    expect(ratio(2)).toBeCloseTo(ratio(1), 1);
    expect(ratio(4)).toBeCloseTo(ratio(1), 1);
  });

  it('プレイヤーに当たると、倍率の掛かったダメージが入る（resolveProjectilesOnPlayer）', () => {
    const player = new Player();
    const { system } = fire(2);
    const hurt: number[] = [];
    // 弾の通り道（原点）まで進めて当てる
    for (let i = 0; i < 200 && hurt.length === 0; i++) {
      player.step(DT, createEmptyIntent(), CAM_YAW);
      system.step(DT, openWorld(14));
      resolveProjectilesOnPlayer(system, player, () => null, { onHit: (ev) => hurt.push(ev.damage) });
    }
    expect(hurt).toEqual([Math.round(WISP.damage * 1.3)]);
  });
});
