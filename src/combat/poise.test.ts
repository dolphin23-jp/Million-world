import { describe, expect, it } from 'vitest';
import { Poise } from './poise';
import { POISE_BREAK, type PoiseDef } from './data/poise';

const DEF: PoiseDef = { max: 80, regenDelayFrames: 10, regenPerFrame: 2, breakEffect: POISE_BREAK };

describe('体勢ゲージ（ADR-027）', () => {
  it('受けたダメージぶん減り、0 になった一撃で「崩れた」を 1 度だけ返す', () => {
    const p = new Poise(DEF);
    expect(p.ratio).toBe(1);
    expect(p.hit(30)).toBe(false);
    expect(p.value).toBe(50);
    expect(p.hit(49)).toBe(false);
    expect(p.hit(1)).toBe(true);
    expect(p.value).toBe(0);
    // すでに 0: 崩れたことは繰り返し知らせない（崩れている間に殴り続けても何度も崩れない）
    expect(p.hit(10)).toBe(false);
    expect(p.value).toBe(0);
  });

  it('1 撃で超過して 0 になっても崩れる（0 未満にはならない）', () => {
    const p = new Poise(DEF);
    expect(p.hit(500)).toBe(true);
    expect(p.value).toBe(0);
  });

  it('最後に受けてから regenDelayFrames のあいだは回復せず、そのあと毎フレーム regenPerFrame ずつ戻る（最大で止まる）', () => {
    const p = new Poise(DEF);
    p.hit(40);
    for (let i = 0; i < DEF.regenDelayFrames; i++) p.step();
    expect(p.value).toBe(40);
    p.step();
    expect(p.value).toBe(42);
    for (let i = 0; i < 100; i++) p.step();
    expect(p.value).toBe(80);
    expect(p.ratio).toBe(1);
  });

  it('回復の途中で受けると、待ちが数え直しになる', () => {
    const p = new Poise(DEF);
    p.hit(40);
    for (let i = 0; i < 15; i++) p.step();
    expect(p.value).toBeGreaterThan(40);
    const v = p.value;
    p.hit(5);
    expect(p.value).toBe(v - 5);
    for (let i = 0; i < DEF.regenDelayFrames; i++) p.step();
    expect(p.value).toBe(v - 5);
  });

  it('refill は満タンに戻し、すぐ次の被弾で減らせる', () => {
    const p = new Poise(DEF);
    p.hit(500);
    p.refill();
    expect(p.value).toBe(80);
    expect(p.hit(80)).toBe(true);
  });
});
