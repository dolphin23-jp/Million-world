import { describe, expect, it } from 'vitest';
import { Enemy } from './enemy';
import { ENEMIES, type EnemyAttackDef, type EnemyDef } from './data/enemies';
import { enemyDef } from './data/enemy-variants';
import { CRASH } from '../combat/data/crash';
import { World, type Obstacle } from '../world/world';

/**
 * 突進の激突（M7-4c。ADR-045）: 突進（猪）が踏み込みのあいだに障害物にぶつかると、突進が止まり、自分にダメージを受けて体勢を崩す。
 * 猪は (0, 0)、プレイヤー（目標）は (0, 3.5)。突進は +Z へ約 6m。障害物は目標の先に置く（目標までの視線は通す）
 */

const circle = (x: number, z: number, r: number, top: number): Obstacle => ({ kind: 'circle', x, z, r, top });
const box = (x: number, z: number, hx: number, hz: number, top: number): Obstacle => ({ kind: 'box', x, z, hx, hz, yaw: 0, top });
const worldOf = (...obstacles: Obstacle[]): World => new World({ radius: 14, obstacles });
const BOAR: EnemyDef = { ...ENEMIES.boar, aggroRange: 99, spawnIdleFrames: 0 };

/** 猪を (0, 0) に置いて目標（0, 3.5）へ。突進の判定が出て、激突するか終わるまで進める。動きを返す */
function charge(def: EnemyDef, world: World | null, hp?: number): { e: Enemy; crashedAt: number; peakZ: number } {
  const e = new Enemy(def, 1, 0, 0);
  e.world = world;
  e.place(0, 0, 0);
  if (hp !== undefined) e.health.hp = hp;
  let crashedAt = -1;
  let peakZ = 0;
  for (let i = 0; i < 400; i++) {
    e.step(1 / 60, 0, 3.5, true, true, 0);
    world?.moveCircle(e.body, e.y);
    peakZ = Math.max(peakZ, e.body.z);
    if (e.crashSerial > 0 && crashedAt < 0) crashedAt = i;
    if (e.state === 'chase' && e.stateSerial > 0 && i > 200 && crashedAt >= 0) break;
  }
  return { e, crashedAt, peakZ };
}

describe('突進の激突', () => {
  it('突進の先に柱があれば、柱の手前で激突する: 突進が止まり、体勢を崩し（stagger）、最大 HP の 20% のダメージを受ける', () => {
    const w = worldOf(circle(0, 7, 0.75, 3.2));
    const e = new Enemy(BOAR, 1, 0, 0);
    e.world = w;
    e.place(0, 0, 0);
    const hp0 = e.health.hp;
    let crashState = '';
    for (let i = 0; i < 400 && e.crashSerial === 0; i++) {
      e.step(1 / 60, 0, 3.5, true, true, 0);
      w.moveCircle(e.body, 0);
      if (e.crashSerial > 0) crashState = e.state;
    }
    expect(e.crashSerial).toBe(1);
    expect(crashState).toBe('stagger');
    expect(e.parryEffect).toBe(CRASH.effect);
    expect(e.health.hp).toBe(hp0 - Math.round(hp0 * CRASH.damageRatio));
    // 柱にめり込まない（柱の手前 7 − 0.75 − 0.7）
    expect(e.body.z).toBeLessThanOrEqual(7 - 0.75 - 0.7 + 0.05);
    expect(e.body.z).toBeGreaterThan(5);
  });

  it('激突のあとは動けず（110f）、そのあいだは反撃の窓（90f）。窓の外は通常のダメージ。終われば追跡に戻り、すぐには構えない', () => {
    const w = worldOf(circle(0, 7, 0.75, 3.2));
    const e = new Enemy(BOAR, 1, 0, 0);
    e.world = w;
    e.place(0, 0, 0);
    for (let i = 0; i < 400 && e.crashSerial === 0; i++) {
      e.step(1 / 60, 0, 3.5, true, true, 0);
      w.moveCircle(e.body, 0);
    }
    expect(e.held).toBe(true);
    expect(e.riposte).toBe(CRASH.effect);
    let inWindow = 0;
    let frames = 0;
    while (e.state === 'stagger' && frames < 300) {
      e.step(1 / 60, 0, 3.5, true, true, 0);
      w.moveCircle(e.body, 0);
      if (e.riposte) inWindow++;
      frames++;
    }
    expect(frames).toBeGreaterThanOrEqual(CRASH.effect.frames - 3);
    expect(frames).toBeLessThanOrEqual(CRASH.effect.frames + 3);
    expect(inWindow).toBeGreaterThanOrEqual(CRASH.effect.riposteFrames - 3);
    expect(inWindow).toBeLessThan(CRASH.effect.frames);
    expect(e.state).toBe('chase');
    // 立て直した直後は、待ち（recoverCooldownFrames）のあいだ構えない
    for (let i = 0; i < CRASH.effect.recoverCooldownFrames - 5; i++) {
      e.step(1 / 60, 0, 3.5, true, true, 0);
      w.moveCircle(e.body, 0);
    }
    expect(e.attacking).toBe(false);
  });

  it('激突では倒れない（HP は 1 までしか減らない）。死亡扱い・撃破の経験値が起きない', () => {
    const w = worldOf(circle(0, 7, 0.75, 3.2));
    const { e } = charge(BOAR, w, 10);
    expect(e.crashSerial).toBe(1);
    expect(e.health.hp).toBe(1);
    expect(e.dead).toBe(false);
  });

  it('何もない所への突進は最後まで届き、激突しない。世界を渡さなければ（迂回なしの従来どおり）激突しない', () => {
    const open = charge(BOAR, worldOf());
    expect(open.e.crashSerial).toBe(0);
    expect(open.peakZ).toBeGreaterThan(5.5);
    const none = charge(BOAR, null);
    expect(none.e.crashSerial).toBe(0);
  });

  it('体を止める高さの障害物（岩 0.85・箱 1.5・壁）にはぶつかるが、歩いて乗れる段差（0.3）にはぶつからない', () => {
    expect(charge(BOAR, worldOf(circle(0, 7, 0.9, 0.85))).e.crashSerial).toBe(1);
    expect(charge(BOAR, worldOf(box(0, 7.2, 2, 0.6, 1.5))).e.crashSerial).toBe(1);
    expect(charge(BOAR, worldOf(box(0, 7, 2, 0.6, 0.3))).e.crashSerial).toBe(0);
  });

  it('突進の通り道の脇にある障害物には、ぶつからない（かすめて通る）', () => {
    const w = worldOf(circle(2.2, 4, 0.75, 3.2)); // 通り道（x = 0）から 2.2 離れる: 猪の半径 0.7 + 柱 0.75 = 1.45 < 2.2
    const r = charge(BOAR, w);
    expect(r.e.crashSerial).toBe(0);
    expect(r.peakZ).toBeGreaterThan(5.5); // 突進は最後まで届いた
  });

  it('激突の付かない攻撃（子鬼）は、障害物にぶつかっても激突しない（押し出されるだけ）。強化版の猪は激突する', () => {
    expect((ENEMIES.imp.attack as EnemyAttackDef).crash).toBeUndefined();
    expect((ENEMIES.boar.attack as EnemyAttackDef).crash).toBe(true);
    for (const tier of [2, 3, 4]) expect(enemyDef('boar', tier).attack.crash).toBe(true);
  });

  it('激突のあと、敵の強さに応じたダメージ（強化版は最大 HP が大きいぶん多い）', () => {
    const w = worldOf(circle(0, 7, 0.75, 3.2));
    const strong = enemyDef('boar', 3);
    const { e } = charge({ ...strong, aggroRange: 99, spawnIdleFrames: 0 }, w);
    expect(e.crashSerial).toBe(1);
    expect(e.health.max - e.health.hp).toBe(Math.round(e.health.max * CRASH.damageRatio));
  });
});
