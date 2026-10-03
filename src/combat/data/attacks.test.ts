import { describe, expect, it } from 'vitest';
import { ATTACKS, resolveAttack } from './attacks';
import { HERO } from '../../character/data/hero';

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

  it('攻撃が参照するアニメ区間が存在し、長さが segmentDuration と一致する', () => {
    const segs: Record<string, { start: number; end: number }> = HERO.segments;
    for (const a of Object.values(ATTACKS)) {
      const seg = segs[a.segment];
      expect(seg, `${a.id} の区間 ${a.segment}`).toBeDefined();
      expect(seg!.end - seg!.start, a.id).toBeCloseTo(a.segmentDuration, 2);
      // 当たり判定は区間の中、次段の受付は持続の終わり以降
      expect(a.activeStart, a.id).toBeGreaterThanOrEqual(0);
      expect(a.activeEnd, a.id).toBeLessThanOrEqual(a.segmentDuration);
    }
  });
});
