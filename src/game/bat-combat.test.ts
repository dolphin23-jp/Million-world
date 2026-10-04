import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { resolveEnemyAttacks, resolvePlayerAttack, type CombatTarget } from './combat';
import { Enemy } from '../ai/enemy';
import { stepSwarm } from '../ai/swarm';
import { ENEMIES } from '../ai/data/enemies';
import { GUARDS } from '../combat/data/guard';
import { guardedDamage } from '../combat/guard';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import type { HitEvent } from '../combat/hit';
import type { LoadoutId } from '../combat/data/loadouts';

/**
 * 小蝙蝠（小型の群れ。ADR-028）と本物の Player の結合テスト。Game.step と同じ順序で 1 フレームずつ進める。
 * カメラ yaw = π のとき、スティックの上は +Z、右は −X、左は +X。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const DEF = ENEMIES.bat;
const ATK = DEF.attack;

interface Scene {
  player: Player;
  bats: Enemy[];
  hurt: HitEvent[];
  blocked: HitEvent[];
  step(over?: Partial<InputIntent>): void;
  run(n: number, over?: Partial<InputIntent>): void;
}

/** 蝙蝠を (x, z) に置く（プレイヤー = 原点の方を向く）。maxAttackers は攻撃権の予算 */
function scene(spots: readonly (readonly [number, number])[], loadout: LoadoutId = 'sword', maxAttackers = 2): Scene {
  const player = new Player();
  player.equip(loadout);
  const bats = spots.map(([x, z], i) => {
    const e = new Enemy(DEF, i + 1, x, z);
    e.place(x, z, Math.atan2(-x, -z));
    return e;
  });
  const sc: Scene = {
    player,
    bats,
    hurt: [],
    blocked: [],
    step(over = {}) {
      player.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
      stepSwarm(bats, DT, player.body.x, player.body.z, !player.dead, maxAttackers);
      resolvePlayerAttack(player, bats as CombatTarget[], () => undefined);
      resolveEnemyAttacks(bats, player, (ev) => sc.hurt.push(ev), { onGuard: (ev) => sc.blocked.push(ev) });
    },
    run(n, over) {
      for (let i = 0; i < n; i++) sc.step(over);
    },
  };
  return sc;
}

const hit = (damage: number): HitEvent => ({ attackerId: 0, targetId: 1, damage, knockback: 1, hitStop: 4, dirX: 0, dirZ: 1, x: 0, z: 0 });

describe('小蝙蝠（小型の群れ）', () => {
  it('弱い: 片手剣の 1 発（10）では落ちず、2 発で落ちる。大剣は 1 発で落ちる', () => {
    const e = new Enemy(DEF, 1, 0, 3);
    e.takeHit(hit(10));
    expect(e.dead).toBe(false);
    expect(e.state).toBe('hit'); // スーパーアーマーなし: 当たればひるむ
    e.takeHit(hit(10));
    expect(e.dead).toBe(true);
    const g = new Enemy(DEF, 2, 0, 3);
    g.takeHit(hit(26));
    expect(g.dead).toBe(true);
  });

  it('立ち止まっていると、予備動作のあと急降下の噛みつきが当たる（ダメージ 6）。1 回の攻撃で 1 回だけ', () => {
    const sc = scene([[0, 3.2]]);
    sc.run(DEF.spawnIdleFrames + ATK.windupFrames + ATK.startupFrames + ATK.activeFrames + 10);
    expect(sc.hurt).toHaveLength(1);
    expect(sc.hurt[0]!.damage).toBe(ATK.damage);
    expect(sc.player.health.hp).toBe(100 - ATK.damage);
  });

  it('向きが固定されたあとに、横へ動けば避けられる（予備動作の後半は 16f）', () => {
    const sc = scene([[0, 3.2]]);
    const bat = sc.bats[0]!;
    for (let i = 0; i < 300 && !(bat.state === 'windup' && bat.stateFrame >= ATK.windupTrackFrames + 1); i++) sc.step();
    expect(bat.state).toBe('windup');
    // 固定されてから攻撃が出るまで 16f。0.08m/f の走りで 12f 動けば体の幅（0.38 + 0.8）を外れる
    sc.run(18, { moveX: 1 });
    sc.run(60);
    expect(sc.hurt).toHaveLength(0);
  });

  it('盾のガードで噛みつきを受け止める（6 → 1）。ロール（無敵）でも避けられる', () => {
    const g = scene([[0, 3.2]], 'sword-shield');
    for (let i = 0; i < 300 && !(g.bats[0]!.state === 'windup' && g.bats[0]!.stateFrame >= 6); i++) g.step();
    g.step({ guardPressed: true, guardHeld: true });
    g.run(80, { guardHeld: true });
    expect(g.hurt).toHaveLength(0);
    expect(g.blocked).toHaveLength(1);
    expect(g.player.health.hp).toBe(100 - guardedDamage(ATK.damage, GUARDS.shield));

    const r = scene([[0, 3.2]]);
    for (let i = 0; i < 300 && !(r.bats[0]!.state === 'attack'); i++) r.step();
    r.step({ dodgePressed: true, moveX: 1 });
    r.run(60);
    expect(r.hurt).toHaveLength(0);
  });

  it('大剣の一振りで、前方に並んだ蝙蝠をまとめて落とせる（3 体）', () => {
    const spots: [number, number][] = [
      [-0.9, 1.2],
      [0, 1.4],
      [0.9, 1.2],
    ];
    const sc = scene(spots, 'greatsword', 0); // 攻撃権 0: 蝙蝠は噛みつかない（斬る側だけを見る）
    sc.step({ attackPressed: true });
    for (let i = 0; i < 60 && sc.bats.some((b) => !b.dead); i++) sc.step();
    expect(sc.bats.filter((b) => b.dead).length).toBe(3);
  });

  it('群れに囲まれても、予算（2）に収まる: 6 体が 1.5 秒のあいだ攻撃していても、同時に噛みつくのは 3 体まで', () => {
    const spots: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      spots.push([Math.sin(a) * 3.3, Math.cos(a) * 3.3]);
    }
    const sc = scene(spots, 'sword', 2);
    let peak = 0;
    for (let i = 0; i < 400; i++) {
      sc.player.health.hp = sc.player.health.max; // 死なない（数だけ見る）
      sc.step();
      peak = Math.max(peak, sc.bats.filter((b) => b.attacking).length);
    }
    expect(peak).toBe(3);
  });
});
