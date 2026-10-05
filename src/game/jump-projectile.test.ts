import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { resolveProjectilesOnPlayer } from './projectile-combat';
import { PROJECTILES, PROJECTILE_HEIGHT } from '../combat/data/projectiles';
import { ProjectileSystem } from '../combat/projectile';
import { openWorld } from '../world/world';

/** 跳んでいる足が弾の高さ（PROJECTILE_HEIGHT）より上なら、弾は足の下を通って当たらない（M7-2）。地面に立っていれば当たる */
const DT = 1 / 60;

function fire(footY: number): { hits: number; alive: boolean } {
  const player = new Player();
  player.y = footY;
  const system = new ProjectileSystem();
  system.spawn(PROJECTILES.wisp, 99, 0, 4, 0, -1); // +Z 4m から −Z（プレイヤーのいる原点）へ
  let hits = 0;
  let alive = true;
  for (let i = 0; i < 90; i++) {
    system.step(DT, openWorld(14));
    resolveProjectilesOnPlayer(system, player, () => null, { onHit: () => hits++ });
    alive = system.pool.some((p) => p.alive);
    if (!alive) break;
  }
  return { hits, alive };
}

describe('跳び越える弾', () => {
  it('地面に立っていれば当たる（弾は消える）', () => {
    const r = fire(0);
    expect(r.hits).toBe(1);
    expect(r.alive).toBe(false);
  });

  it('足が弾の高さを越えていれば、当たらずに足の下を通り抜ける', () => {
    const r = fire(PROJECTILE_HEIGHT + 0.1);
    expect(r.hits).toBe(0);
  });

  it('足が弾の高さ以下なら（頂点の少し手前でも）当たる', () => {
    expect(fire(PROJECTILE_HEIGHT - 0.1).hits).toBe(1);
  });
});
