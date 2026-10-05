import { describe, expect, it } from 'vitest';
import { Breakable, createBreakables } from './breakable';
import { NEVER_CRIT, resolvePlayerAttack, type AttackerView } from './combat';
import { Player } from './player';
import { Enemy } from '../ai/enemy';
import { ENEMIES } from '../ai/data/enemies';
import { ATTACKS } from '../combat/data/attacks';
import { HitTracker, type HitEvent } from '../combat/hit';
import { Inventory } from '../combat/inventory';
import { ITEM_RULES, type DropDef } from '../combat/data/items';
import { createEmptyIntent } from '../input/intent';
import { ARENA_WORLD } from '../world/data/arena-props';
import { World, type Obstacle } from '../world/world';

const crateObstacle = (x: number, z: number, hp = 30): Obstacle & { breakable: { hp: number } } => ({ kind: 'box', x, z, hx: 0.45, hz: 0.45, yaw: 0, top: 0.9, breakable: { hp } });
const hit = (damage: number): HitEvent => ({ attackerId: 0, targetId: -1, damage, knockback: 0, hitStop: 0, dirX: 0, dirZ: 1, x: 0, z: 0 });

describe('Breakable: 壊せる物の体力', () => {
  it('当たりの円・高さ・負の id（敵・プレイヤーと重ならない）。円柱はその円、箱は長い辺の半分', () => {
    const w = new World({ radius: 14, obstacles: [circle(), crateObstacle(2, 3)] });
    const [barrel, crate] = createBreakables(w);
    expect(barrel!.body.id).toBe(-1);
    expect(crate!.body.id).toBe(-2);
    expect(barrel!.body.r).toBeCloseTo(0.42);
    expect(crate!.body.r).toBeCloseTo(0.45);
    expect(crate!.height).toBe(0.9);
    expect(crate!.index).toBe(1);
  });

  it('当たるたびに体力が減り、0 で壊れる。壊れたあとは当たらない（ダメージ 0・無敵）。実際に減った量を返す', () => {
    const b = new Breakable(0, crateObstacle(0, 3, 30));
    expect(b.takeHit(hit(10))).toEqual({ dealt: 10, killed: false });
    expect(b.hp).toBe(20);
    expect(b.broken).toBe(false);
    expect(b.takeHit(hit(15))).toEqual({ dealt: 15, killed: false });
    const last = b.takeHit(hit(50)); // 残り 5 しかない
    expect(last).toEqual({ dealt: 5, killed: true });
    expect(b.broken).toBe(true);
    expect(b.body.invulnerable).toBe(true);
    expect(b.takeHit(hit(10))).toEqual({ dealt: 0, killed: false });
    expect(b.hitSerial).toBe(3);
  });

  it('markBroken（突き破られた）で壊れた状態にでき、reset で元に戻る', () => {
    const b = new Breakable(0, crateObstacle(0, 3));
    b.markBroken();
    expect(b.broken).toBe(true);
    b.reset();
    expect(b.broken).toBe(false);
    expect(b.hp).toBe(b.max);
    expect(b.body.invulnerable).toBe(false);
  });

  it('闘技場の壊せる物（木箱・樽）すべてから作れ、id が重ならない', () => {
    const w = new World(ARENA_WORLD);
    const list = createBreakables(w);
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(new Set(list.map((b) => b.body.id)).size).toBe(list.length);
    for (const b of list) expect(w.obstacles[b.index]!.breakable).toBeDefined();
  });
});

function circle(): Obstacle & { breakable: { hp: number } } {
  return { kind: 'circle', x: 0, z: 5, r: 0.42, top: 0.95, breakable: { hp: 20 } };
}

describe('プレイヤーの攻撃で壊せる物が壊れる', () => {
  const combo1 = ATTACKS.combo1!;
  const attacker = (y = 0): AttackerView => ({ attackActive: true, attack: combo1, attackPower: 1, body: { x: 0, z: 0, r: 0.38 }, yaw: 0, hitTracker: new HitTracker(), y });

  it('目の前の木箱に当たる。続けて当てると壊れる（1 攻撃 1 回なので、攻撃ごとに記録を戻す）', () => {
    const b = new Breakable(0, crateObstacle(0, 1.1, 30));
    let hits = 0;
    while (!b.broken && hits < 10) {
      const a = attacker();
      const n = resolvePlayerAttack(a, [b], () => undefined, NEVER_CRIT);
      expect(n).toBe(1);
      expect(resolvePlayerAttack(a, [b], () => undefined, NEVER_CRIT)).toBe(0); // 同じ攻撃では 1 回だけ
      hits++;
    }
    expect(b.broken).toBe(true);
    expect(hits).toBeGreaterThanOrEqual(2);
    expect(hits).toBeLessThanOrEqual(5);
  });

  it('届かない所（遠い・壇の上の足の高さ）の木箱には当たらない。当たりが記録されない', () => {
    const far = new Breakable(0, crateObstacle(0, 6));
    expect(resolvePlayerAttack(attacker(), [far], () => undefined, NEVER_CRIT)).toBe(0);
    const near = new Breakable(0, crateObstacle(0, 1.1));
    // 壇の上（足 2.2m）から、高さ 0.9m の木箱には届かない
    expect(resolvePlayerAttack(attacker(2.2), [near], () => undefined, NEVER_CRIT)).toBe(0);
    expect(resolvePlayerAttack(attacker(0), [near], () => undefined, NEVER_CRIT)).toBe(1);
  });

  it('本物の Player の攻撃（combo1）でも、木箱が壊れる', () => {
    const player = new Player();
    player.body.x = 0;
    player.body.z = 0;
    const b = new Breakable(0, crateObstacle(0, 1.2, 5));
    let broken = false;
    for (let i = 0; i < 200 && !broken; i++) {
      player.step(1 / 60, { ...createEmptyIntent(), attackPressed: i === 0 }, Math.PI);
      resolvePlayerAttack(player, [b], () => undefined, NEVER_CRIT);
      broken = b.broken;
    }
    expect(broken).toBe(true);
  });
});

describe('猪の突進は壊せる物を突き破る（激突しない）', () => {
  const BOAR = { ...ENEMIES.boar, aggroRange: 99, spawnIdleFrames: 0 };

  /** 猪（0, 0）→ 目標（0, 3.5）。障害物 o は突進の先（z = 7）。壊せる物なら Game のかわりに、smashIndex を見て World から外す */
  function run(o: Obstacle): { crash: number; smashed: number[]; peakZ: number } {
    const w = new World({ radius: 14, obstacles: [o] });
    const e = new Enemy(BOAR, 1, 0, 0);
    e.world = w;
    e.place(0, 0, 0);
    const smashed: number[] = [];
    let peakZ = 0;
    for (let i = 0; i < 400; i++) {
      e.step(1 / 60, 0, 3.5, true, true, 0);
      if (e.smashIndex >= 0) {
        smashed.push(e.smashIndex);
        w.setActive(e.smashIndex, false);
        e.smashIndex = -1;
      }
      w.moveCircle(e.body, 0);
      peakZ = Math.max(peakZ, e.body.z);
    }
    return { crash: e.crashSerial, smashed, peakZ };
  }

  it('木箱（壊せる）に突っ込むと、smashIndex が立ち、壊されて、突進は止まらず通り抜ける。激突しない', () => {
    const r = run(crateObstacle(0, 7));
    expect(r.smashed).toEqual([0]);
    expect(r.crash).toBe(0);
    expect(r.peakZ).toBeGreaterThan(5.8); // 木箱の位置（z = 7 − 0.45 − 0.7 = 5.85）を過ぎて進んだ
  });

  it('壊せない箱・柱には、従来どおり激突する（smashIndex は立たない）', () => {
    const solid: Obstacle = { kind: 'box', x: 0, z: 7, hx: 0.45, hz: 0.45, yaw: 0, top: 0.9 };
    const r = run(solid);
    expect(r.smashed).toEqual([]);
    expect(r.crash).toBe(1);
  });
});

describe('Inventory.rollDrops: 壊せる物の抽選は、撃破の救済（pity）に関わらない', () => {
  const sure: DropDef[] = [{ item: 'potionS', chance: 0 }];
  it('pity = false なら、何も落ちなくても数えず、救済も出ない。通常（既定）は従来どおり救済が出る', () => {
    const inv = new Inventory();
    for (let i = 0; i < ITEM_RULES.pityKills + 3; i++) expect(inv.rollDrops(sure, () => 0.99, 1, false)).toEqual([]);
    // まだ「何も落ちない撃破」は 0 回: 救済が出るのは pityKills 回の撃破のあと
    for (let i = 0; i < ITEM_RULES.pityKills - 1; i++) expect(inv.rollDrops(sure, () => 0.99)).toEqual([]);
    expect(inv.rollDrops(sure, () => 0.99)).toEqual([ITEM_RULES.pityItem]);
  });
});
