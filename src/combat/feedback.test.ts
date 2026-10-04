import { describe, expect, it } from 'vitest';
import { hitFeedback } from './feedback';
import { ATTACKS } from './data/attacks';
import { HIT_FEEDBACK } from './data/hit-feedback';
import { CRIT } from './data/crit';

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

describe('hitFeedback: 会心（ADR-035）', () => {
  const a = ATTACKS.combo2!;
  const base = hitFeedback({ damage: a.damage, hitStop: a.hitStop }, false);
  const crit = hitFeedback({ damage: a.damage, hitStop: a.hitStop, crit: true }, false);

  it('会心でない命中は crit: false。会心は crit: true', () => {
    expect(base.crit).toBe(false);
    expect(crit.crit).toBe(true);
  });
  it('会心は揺れ・エフェクトが大きい（ヒットストップは当たり判定が加算済みの値をそのまま使う）', () => {
    expect(crit.shakeAmp).toBeCloseTo(base.shakeAmp * CRIT.shakeScale, 9);
    expect(crit.power).toBeGreaterThan(base.power);
    expect(crit.hitStop).toBe(base.hitStop);
  });
  it('会心でも、とどめの重なりでも壊れない（とどめの揺れ・ヒットストップに会心の倍率が重なる）', () => {
    const k = hitFeedback({ damage: a.damage, hitStop: a.hitStop }, true);
    const kc = hitFeedback({ damage: a.damage, hitStop: a.hitStop, crit: true }, true);
    expect(kc.style).toBe('kill');
    expect(kc.crit).toBe(true);
    expect(kc.shakeAmp).toBeCloseTo(k.shakeAmp * CRIT.shakeScale, 9);
  });
  it('エフェクトの強さの上限は、会心のぶんだけ上がる', () => {
    expect(hitFeedback({ damage: 999, hitStop: 0, crit: true }, false).power).toBeCloseTo(HIT_FEEDBACK.power.max * CRIT.powerScale, 9);
  });
});
