import { describe, expect, it } from 'vitest';
import { Enemy } from './enemy';
import { ENEMIES, type EnemyDef } from './data/enemies';
import { stepSwarm } from './swarm';
import { ARENA_WORLD } from '../world/data/arena-props';
import { World, type Obstacle } from '../world/world';

/**
 * 敵の視線（M7-4b。ADR-044）: プレイヤーが柱・高い箱に遮られて見えないあいだ、敵は攻撃の予備動作に入らず、見える位置まで寄る。
 * 遠距離の敵（提灯）は弾の高さ（低い岩・壁の上は通る）で見る。
 */

const circle = (x: number, z: number, r: number, top: number): Obstacle => ({ kind: 'circle', x, z, r, top });
const box = (x: number, z: number, hx: number, hz: number, top: number): Obstacle => ({ kind: 'box', x, z, hx, hz, yaw: 0, top });
const worldOf = (...obstacles: Obstacle[]): World => new World({ radius: 14, obstacles });
const chaser = (type: keyof typeof ENEMIES): EnemyDef => ({ ...ENEMIES[type], aggroRange: 99, spawnIdleFrames: 0 });

/** 敵を (x, z) に置いて、プレイヤー（原点・動かない）へ向かわせる。予備動作に入った時点の視線の有無と、そこまでのステップ数 */
function untilWindup(type: keyof typeof ENEMIES, world: World, from: [number, number], maxSteps = 60 * 30): { steps: number; sight: boolean; e: Enemy } {
  const e = new Enemy(chaser(type), 1, from[0], from[1]);
  e.world = world;
  e.place(from[0], from[1], Math.atan2(-from[0], -from[1]));
  const y = e.y;
  for (let i = 0; i < maxSteps; i++) {
    stepSwarm([e], 1 / 60, 0, 0, true, 9, 0);
    world.moveCircle(e.body, y);
    if (e.state === 'windup') return { steps: i, sight: e.sight, e };
  }
  return { steps: -1, sight: e.sight, e };
}

describe('Enemy.sight: 視線', () => {
  it('遮るものが無ければ見えている。world を渡さなければ常に見えている', () => {
    const e = new Enemy(chaser('imp'), 1, 0, 3);
    e.world = worldOf();
    e.step(1 / 60, 0, 0);
    expect(e.sight).toBe(true);
    const blind = new Enemy(chaser('imp'), 2, 0, 3);
    blind.step(1 / 60, 0, 0);
    expect(blind.sight).toBe(true);
  });

  it('柱・高い箱が間にあれば見えない。低い岩・壁（上面が目の高さ未満）は遮らない', () => {
    const at = (o: Obstacle): boolean => {
      const e = new Enemy(chaser('imp'), 1, 0, 4);
      e.world = worldOf(o);
      e.step(1 / 60, 0, 0);
      return e.sight;
    };
    expect(at(circle(0, 2, 0.6, 3.2))).toBe(false);
    expect(at(box(0, 2, 1, 1, 1.5))).toBe(false);
    expect(at(circle(0, 2, 0.9, 0.85))).toBe(true);
    expect(at(box(0, 2, 2, 0.3, 0.9))).toBe(true);
  });

  it('プレイヤーが高い所（箱の上）にいても、その足場の箱は遮らない（足場に立っている）', () => {
    const w = worldOf(box(0, 0, 1, 1, 1.5));
    const e = new Enemy(chaser('ogre'), 1, 0, 4);
    e.world = w;
    e.step(1 / 60, 0, 0, true, true, 1.5);
    expect(e.sight).toBe(true);
  });

  it('飛び道具だけの敵（提灯）は弾の高さ（1.1m）で見る: 低い壁（0.9m）の上は通り、箱（1.5m）は遮る', () => {
    const at = (o: Obstacle): boolean => {
      const e = new Enemy(chaser('lantern'), 1, 0, 6);
      e.world = worldOf(o);
      e.step(1 / 60, 0, 0);
      return e.sight;
    };
    expect(at(box(0, 3, 2, 0.3, 0.9))).toBe(true);
    expect(at(box(0, 3, 1, 1, 1.5))).toBe(false);
  });
});

describe('Enemy: 見えないあいだは攻撃に入らず、見える位置まで寄る', () => {
  it('柱の真後ろから近づく子鬼は、柱を回って見えた位置で予備動作に入る（見えないあいだに構えない）', () => {
    const w = worldOf(circle(0, 2, 0.75, 3.2));
    const r = untilWindup('imp', w, [0, 3.6]);
    expect(r.steps).toBeGreaterThan(0);
    expect(r.sight).toBe(true);
    // 柱の裏のまま構えていない: 構えた位置から原点が見える
    expect(w.lineOfSight(r.e.body.x, r.e.body.z, 0, 0, 1)).toBe(true);
  });

  it('止まる距離の内側でも、見えなければ近づく（柱に隠れたプレイヤーの前で立ち尽くさない）', () => {
    // 子鬼の stopDistance は 1.6m。柱（半径 0.75）をはさんで中心間 3.0m
    const w = worldOf(circle(0, 1.5, 0.75, 3.2));
    const e = new Enemy(chaser('imp'), 1, 0, 3);
    e.world = w;
    e.place(0, 3, Math.PI);
    let started = false;
    for (let i = 0; i < 60 * 10 && !started; i++) {
      stepSwarm([e], 1 / 60, 0, 0, true, 9, 0);
      w.moveCircle(e.body, 0);
      started = e.state === 'windup';
    }
    expect(started).toBe(true);
    expect(e.sight).toBe(true);
  });

  it('提灯は、箱の陰で後退せず、撃てる位置まで寄ってから構える', () => {
    const w = worldOf(box(0, 3, 1.2, 1, 1.5));
    const r = untilWindup('lantern', w, [0, 6]);
    expect(r.steps).toBeGreaterThan(0);
    expect(r.sight).toBe(true);
    expect(w.lineOfSight(r.e.body.x, r.e.body.z, 0, 0, 1.1)).toBe(true);
  });

  it('提灯は低い壁（0.9m）の向こうからでも、そのまま構える（弾は上を通る）', () => {
    const w = worldOf(box(0, 3, 3, 0.3, 0.9));
    const r = untilWindup('lantern', w, [0, 7], 60 * 10);
    expect(r.steps).toBeGreaterThan(0);
    // 壁を回り込まずに構えた（真後ろのまま）
    expect(Math.abs(r.e.body.x)).toBeLessThan(0.5);
  });

  it('闘技場: 柱の裏にいるプレイヤーへ、全種の敵が見える位置まで来て構える（どの敵も 30 秒以内）', () => {
    const arena = new World(ARENA_WORLD);
    // 折れた柱（45°・半径 9m）の真裏: 柱の中心から外向きに 1.6m
    const col = ARENA_WORLD.obstacles.find((o) => o.kind === 'circle' && o.top > 3 && o.top < 4 && o.x > 0 && o.z > 0)!;
    const px = col.x - 0.7071 * 1.6;
    const pz = col.z - 0.7071 * 1.6; // 柱の手前（中心側）にプレイヤー
    for (const type of ['imp', 'boar', 'lantern', 'ogre', 'bat'] as const) {
      const sx = col.x + 0.7071 * 4;
      const sz = col.z + 0.7071 * 4; // 柱の向こう（縁側）から来る
      const e = new Enemy(chaser(type), 1, sx, sz);
      e.world = arena;
      e.place(sx, sz, Math.atan2(px - sx, pz - sz));
      let steps = -1;
      for (let i = 0; i < 60 * 30; i++) {
        stepSwarm([e], 1 / 60, px, pz, true, 9, 0);
        arena.moveCircle(e.body, e.y);
        if (e.state === 'windup') {
          steps = i;
          break;
        }
      }
      expect(steps, type).toBeGreaterThan(0);
      expect(e.sight, type).toBe(true);
    }
  });
});
