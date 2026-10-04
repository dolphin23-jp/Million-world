import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { PLAYER_STATS } from '../combat/data/attacks';
import type { HitEvent } from '../combat/hit';

/** アイテムの回復（Player.heal。ADR-030） */

const HIT: HitEvent = { attackerId: 1, targetId: 0, damage: 40, knockback: 1, hitStop: 0, dirX: 0, dirZ: -1, x: 0, z: 0 };

describe('Player.heal', () => {
  it('減っている体力だけ回復し、実際に増えた量を返す（最大体力を超えない）', () => {
    const p = new Player();
    p.takeHit(HIT);
    expect(p.health.hp).toBe(PLAYER_STATS.maxHp - 40);
    expect(p.heal(30)).toBe(30);
    expect(p.health.hp).toBe(PLAYER_STATS.maxHp - 10);
    expect(p.heal(60)).toBe(10);
    expect(p.health.hp).toBe(PLAYER_STATS.maxHp);
    expect(p.heal(30)).toBe(0);
  });

  it('負の量・小数は丸めて、体力を減らさない', () => {
    const p = new Player();
    p.takeHit(HIT);
    const hp = p.health.hp;
    expect(p.heal(-20)).toBe(0);
    expect(p.health.hp).toBe(hp);
    expect(p.heal(10.4)).toBe(10);
  });

  it('死んでいるときは回復しない', () => {
    const p = new Player();
    p.takeHit({ ...HIT, damage: 999 });
    expect(p.dead).toBe(true);
    expect(p.heal(60)).toBe(0);
    expect(p.health.hp).toBe(0);
  });
});
