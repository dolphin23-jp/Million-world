import { describe, expect, it } from 'vitest';
import { circlesOverlap, clampInsideArena, pushOutOfCircle, separateCircles } from './collision';

describe('collision', () => {
  it('pushOutOfCircle: 重なった円を押し出し、接する位置に置く', () => {
    const a = { x: 0.5, z: 0, r: 0.5 };
    const b = { x: 0, z: 0, r: 0.5 };
    expect(pushOutOfCircle(a, b)).toBe(true);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(1.0, 6);
    expect(b.x).toBe(0);
  });

  it('pushOutOfCircle: 離れていれば何もしない', () => {
    const a = { x: 3, z: 0, r: 0.5 };
    const b = { x: 0, z: 0, r: 0.5 };
    expect(pushOutOfCircle(a, b)).toBe(false);
    expect(a.x).toBe(3);
  });

  it('pushOutOfCircle: 完全一致でも NaN にならない', () => {
    const a = { x: 0, z: 0, r: 0.5 };
    const b = { x: 0, z: 0, r: 0.5 };
    pushOutOfCircle(a, b);
    expect(Number.isFinite(a.x)).toBe(true);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(1.0, 6);
  });

  it('separateCircles: 両方が等分に動く', () => {
    const a = { x: 0, z: 0, r: 0.5 };
    const b = { x: 0.6, z: 0, r: 0.5 };
    separateCircles(a, b);
    expect(a.x).toBeCloseTo(-0.2, 6);
    expect(b.x).toBeCloseTo(0.8, 6);
  });

  it('clampInsideArena: 外に出た円を境界内に戻す', () => {
    const c = { x: 20, z: 0, r: 0.5 };
    expect(clampInsideArena(c, 0, 0, 10)).toBe(true);
    expect(c.x).toBeCloseTo(9.5, 6);
    expect(clampInsideArena(c, 0, 0, 10)).toBe(false);
  });

  it('circlesOverlap', () => {
    expect(circlesOverlap({ x: 0, z: 0, r: 1 }, { x: 1.5, z: 0, r: 1 })).toBe(true);
    expect(circlesOverlap({ x: 0, z: 0, r: 1 }, { x: 2.5, z: 0, r: 1 })).toBe(false);
  });
});
