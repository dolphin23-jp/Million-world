import { describe, expect, it } from 'vitest';
import { Shake } from './shake';

const DT = 1 / 60;

describe('Shake', () => {
  it('trigger した直後から揺れ、時間とともに減衰して 0 になる', () => {
    const s = new Shake();
    s.trigger(0.1, 0.2);
    s.update(DT);
    expect(Math.hypot(s.x, s.y)).toBeGreaterThan(0);
    let peakEarly = 0;
    let peakLate = 0;
    for (let i = 0; i < 12; i++) {
      s.update(DT);
      const m = Math.hypot(s.x, s.y);
      if (i < 4) peakEarly = Math.max(peakEarly, m);
      if (i >= 8) peakLate = Math.max(peakLate, m);
    }
    expect(peakLate).toBeLessThan(peakEarly);
    s.update(DT);
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
    expect(s.current).toBe(0);
  });

  it('揺れの大きさは amp を超えない', () => {
    const s = new Shake();
    s.trigger(0.05, 0.3);
    for (let i = 0; i < 30; i++) {
      s.update(DT);
      expect(Math.abs(s.x)).toBeLessThanOrEqual(0.05 + 1e-12);
      expect(Math.abs(s.y)).toBeLessThanOrEqual(0.05 + 1e-12);
    }
  });

  it('強い揺れの途中で弱い揺れは置き換えない。強いものは置き換える', () => {
    const s = new Shake();
    s.trigger(0.1, 0.3);
    s.update(DT);
    const before = s.current;
    s.trigger(0.02, 0.5);
    expect(s.current).toBe(before);
    s.trigger(0.2, 0.1);
    expect(s.current).toBeCloseTo(0.2, 9);
  });

  it('0 以下の入力は無視する。揺れていなければオフセットは 0', () => {
    const s = new Shake();
    s.trigger(0, 1);
    s.trigger(0.1, 0);
    s.update(DT);
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
  });
});
