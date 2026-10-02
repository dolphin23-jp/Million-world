import { describe, expect, it } from 'vitest';
import { FixedStepper, STEP_DT } from './loop';

describe('FixedStepper', () => {
  it('60Hz の実時間なら 1 フレームにつき 1 ステップ', () => {
    const s = new FixedStepper();
    let steps = 0;
    for (let i = 0; i < 60; i++) s.advance(STEP_DT, () => steps++);
    expect(steps).toBe(60);
    expect(s.frame).toBe(60);
  });

  it('30Hz の実時間なら 1 フレームにつき 2 ステップ', () => {
    const s = new FixedStepper();
    let steps = 0;
    s.advance(1 / 30, () => steps++);
    expect(steps).toBe(2);
  });

  it('120Hz の実時間なら 2 フレームで 1 ステップ、alpha が中間値を返す', () => {
    const s = new FixedStepper();
    let steps = 0;
    const a1 = s.advance(1 / 120, () => steps++);
    expect(steps).toBe(0);
    expect(a1).toBeCloseTo(0.5, 5);
    const a2 = s.advance(1 / 120, () => steps++);
    expect(steps).toBe(1);
    expect(a2).toBeCloseTo(0, 5);
  });

  it('巨大な dt は maxFrameDt でクランプされ、maxSteps を超えたら残りを捨てる', () => {
    const s = new FixedStepper(STEP_DT, { maxStepsPerFrame: 5, maxFrameDt: 0.25 });
    let steps = 0;
    const alpha = s.advance(10, () => steps++);
    expect(steps).toBe(5);
    expect(alpha).toBe(0);
  });

  it('timeScale = 0 で sim が止まる（ヒットストップ）', () => {
    const s = new FixedStepper();
    let steps = 0;
    s.timeScale = 0;
    for (let i = 0; i < 10; i++) s.advance(STEP_DT, () => steps++);
    expect(steps).toBe(0);
    s.timeScale = 1;
    s.advance(STEP_DT, () => steps++);
    expect(steps).toBe(1);
  });

  it('負の dt は無視する', () => {
    const s = new FixedStepper();
    let steps = 0;
    s.advance(-1, () => steps++);
    expect(steps).toBe(0);
  });
});
