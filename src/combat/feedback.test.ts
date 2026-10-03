import { describe, expect, it } from 'vitest';
import { hitFeedback } from './feedback';
import { ATTACKS } from './data/attacks';
import { HIT_FEEDBACK } from './data/hit-feedback';

const of = (id: string, killed = false) => hitFeedback({ damage: ATTACKS[id]!.damage, hitStop: ATTACKS[id]!.hitStop }, killed);

describe('hitFeedback', () => {
  it('重い技ほどヒットストップ・揺れ・エフェクトが大きい（コンボ 1 段目 < 3 段目 < 重撃）', () => {
    const a = of('combo1');
    const b = of('combo3');
    const c = of('heavy');
    expect(a.hitStop).toBeLessThan(b.hitStop);
    expect(b.hitStop).toBeLessThan(c.hitStop);
    expect(a.shakeAmp).toBeLessThan(b.shakeAmp);
    expect(b.shakeAmp).toBeLessThan(c.shakeAmp);
    expect(a.power).toBeLessThan(c.power);
  });

  it('とどめはヒットストップが伸び、揺れが大きく、見た目は kill', () => {
    const normal = of('combo2');
    const kill = of('combo2', true);
    expect(kill.hitStop).toBe(normal.hitStop + HIT_FEEDBACK.killExtraHitStop);
    expect(kill.shakeAmp).toBeCloseTo(normal.shakeAmp * HIT_FEEDBACK.shake.killScale, 9);
    expect(kill.style).toBe('kill');
  });

  it('見た目の区分: 軽いコンボは light、重撃は heavy', () => {
    expect(of('combo1').style).toBe('light');
    expect(of('combo2').style).toBe('light');
    expect(of('heavy').style).toBe('heavy');
  });

  it('エフェクトの強さは範囲に収まる', () => {
    expect(hitFeedback({ damage: 1, hitStop: 0 }, false).power).toBe(HIT_FEEDBACK.power.min);
    expect(hitFeedback({ damage: 999, hitStop: 0 }, false).power).toBe(HIT_FEEDBACK.power.max);
  });

  it('ヒットストップは 20 フレーム以下（長すぎて操作が止まった感じにならない）', () => {
    for (const a of Object.values(ATTACKS)) {
      expect(hitFeedback({ damage: a.damage, hitStop: a.hitStop }, true).hitStop, a.id).toBeLessThanOrEqual(20);
    }
  });
});
