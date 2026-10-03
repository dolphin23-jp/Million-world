import { describe, expect, it } from 'vitest';
import { ATTACKS, resolveAttack } from './attacks';

describe('resolveAttack', () => {
  it('秒を rate で割って 60Hz フレームに変換する', () => {
    const f = resolveAttack({
      id: 't',
      segment: 't',
      segmentDuration: 1.0,
      activeStart: 0.5,
      activeEnd: 0.6,
      cancelAt: 0.8,
      rate: 2,
      lunge: 0,
      damage: 1,
      hitStop: 0,
      knockback: 0,
    });
    expect(f.startup).toBe(15);
    expect(f.active).toBe(3);
    expect(f.recovery).toBe(12);
    expect(f.total).toBe(30);
    expect(f.cancelFrame).toBe(24);
  });

  it('cancelFrame は持続終了より前にならない', () => {
    const f = resolveAttack({ ...ATTACKS.combo1!, cancelAt: 0 });
    expect(f.cancelFrame).toBeGreaterThanOrEqual(f.startup + f.active);
  });

  it('定義済みの攻撃はすべて 発生 ≥ 8f, 持続 ≥ 3f, 全体 ≤ 60f', () => {
    for (const a of Object.values(ATTACKS)) {
      const f = resolveAttack(a);
      expect(f.startup, a.id).toBeGreaterThanOrEqual(8);
      expect(f.active, a.id).toBeGreaterThanOrEqual(3);
      expect(f.total, a.id).toBeLessThanOrEqual(60);
      expect(f.startup + f.active + f.recovery).toBe(f.total);
    }
  });

  it('コンボの連鎖が終端で止まる', () => {
    let a = ATTACKS.combo1!;
    const seen = new Set<string>();
    while (a.next) {
      expect(seen.has(a.id)).toBe(false);
      seen.add(a.id);
      a = ATTACKS[a.next]!;
    }
    expect(a.id).toBe('combo3');
  });
});
