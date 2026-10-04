import { describe, expect, it } from 'vitest';
import { Mystical } from './mystical';
import { MYSTICAL } from './data/mystical';

/** n ステップ進めて、敵が進んだステップの数を返す */
function run(m: Mystical, n: number): number {
  let advanced = 0;
  for (let i = 0; i < n; i++) if (m.step()) advanced++;
  return advanced;
}

describe('Mystical: 発動とクールダウン', () => {
  it('最初は発動でき、発動中・クールダウン中は発動できない', () => {
    const m = new Mystical();
    expect(m.ready).toBe(true);
    expect(m.trigger()).toBe(true);
    expect(m.active).toBe(true);
    expect(m.trigger()).toBe(false);
    run(m, MYSTICAL.durationFrames);
    // 続きは切れたが、クールダウンが残っている（続く長さより長い）
    expect(m.active).toBe(false);
    expect(m.ready).toBe(false);
    expect(m.trigger()).toBe(false);
    run(m, MYSTICAL.cooldownFrames - MYSTICAL.durationFrames);
    expect(m.ready).toBe(true);
    expect(m.trigger()).toBe(true);
  });

  it('クールダウンは発動した瞬間から数える', () => {
    const m = new Mystical();
    m.trigger();
    run(m, MYSTICAL.cooldownFrames - 1);
    expect(m.ready).toBe(false);
    run(m, 1);
    expect(m.ready).toBe(true);
  });

  it('続く長さはちょうど durationFrames ステップ', () => {
    const m = new Mystical();
    m.trigger();
    run(m, MYSTICAL.durationFrames - 1);
    expect(m.active).toBe(true);
    run(m, 1);
    expect(m.active).toBe(false);
  });

  it('割合: 発動直後 1 → 切れて 0。終わりの手前だけ warning', () => {
    const m = new Mystical();
    expect(m.ratio).toBe(0);
    m.trigger();
    expect(m.ratio).toBe(1);
    expect(m.warning).toBe(false);
    run(m, MYSTICAL.durationFrames - MYSTICAL.warnFrames);
    expect(m.warning).toBe(true);
    run(m, MYSTICAL.warnFrames);
    expect(m.ratio).toBe(0);
    expect(m.warning).toBe(false);
  });

  it('reset はクールダウンも消す', () => {
    const m = new Mystical();
    m.trigger();
    m.reset();
    expect(m.active).toBe(false);
    expect(m.ready).toBe(true);
  });
});

describe('Mystical: 敵の時間', () => {
  it('発動していなければ毎ステップ敵が進む（等倍）', () => {
    const m = new Mystical();
    expect(run(m, 100)).toBe(100);
    expect(m.scale).toBe(1);
    expect(m.visualAlpha(0.37)).toBe(0.37);
  });

  it('発動中は enemyScale の割合のステップだけ敵が進む（5 回に 1 回）', () => {
    const m = new Mystical();
    m.trigger();
    // 切れるステップ（等倍に戻る）を除いた区間で数える
    const advanced = run(m, MYSTICAL.durationFrames - 1);
    expect(advanced).toBe(Math.floor((MYSTICAL.durationFrames - 1) * MYSTICAL.enemyScale + 1e-6));
    expect(m.scale).toBe(MYSTICAL.enemyScale);
  });

  it('間引きは等間隔: 敵が進むのは 1/enemyScale ステップごと', () => {
    const m = new Mystical();
    m.trigger();
    const gaps: number[] = [];
    let last = 0;
    for (let i = 1; i < 60; i++) {
      if (m.step()) {
        gaps.push(i - last);
        last = i;
      }
    }
    for (const g of gaps) expect(g).toBe(Math.round(1 / MYSTICAL.enemyScale));
  });

  it('切れたステップから等倍に戻る（補間の端数も 0）', () => {
    const m = new Mystical();
    m.trigger();
    run(m, MYSTICAL.durationFrames);
    expect(m.step()).toBe(true);
    expect(m.visualAlpha(0.5)).toBe(0.5);
    expect(run(m, 20)).toBe(20);
  });

  it('visualAlpha: 敵が進んだ直後は 0 から、次に進むまでに 1 へ向かう（跳ばない）', () => {
    const m = new Mystical();
    m.trigger();
    let prev = -1;
    let stepped = 0;
    for (let i = 0; i < 50; i++) {
      const advanced = m.step();
      if (advanced) stepped++;
      // 1 ステップの中の補間（alpha 0 → 1）。値は 0..1 のなかで、単調に増える（敵が進んだステップで 1 近くから 0 近くへ戻る）
      const a0 = m.visualAlpha(0);
      const a1 = m.visualAlpha(1);
      expect(a0).toBeGreaterThanOrEqual(0);
      expect(a1).toBeLessThanOrEqual(1);
      expect(a1).toBeGreaterThanOrEqual(a0);
      // ステップをまたいでも、見た目の時間は戻らない（敵が進んだ直後だけ 1 → 端数へ折り返す）
      if (!advanced && i > 0) expect(a0).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = a1;
    }
    expect(stepped).toBeGreaterThan(5);
  });

  it('visualAlpha: 敵の見た目の進みの合計 = 敵が進んだ回数 × 1（遅い時間で補間している）', () => {
    // 見た目の時間 = (敵が進んだ回数 - 1) + visualAlpha（先行 1 ステップ遅れの補間）。sim の 100 ステップで 20 回進むなら、見た目も 20 だけ進む
    const m = new Mystical();
    m.trigger();
    let advancedCount = 0;
    let visual = 0;
    for (let i = 0; i < 100; i++) {
      if (m.step()) advancedCount++;
      visual = advancedCount - 1 + m.visualAlpha(1);
    }
    expect(visual).toBeGreaterThan(advancedCount - 1);
    expect(visual).toBeLessThanOrEqual(advancedCount + 1e-9);
  });
});
