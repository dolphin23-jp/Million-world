import { describe, expect, it } from 'vitest';
import { KillBuff } from './buffs';
import { KILL_BUFF } from './data/passives';

describe('闘気（KillBuff）', () => {
  it('最初は何も重なっていない。倒すたびに 1 つ重なり、残り時間が満タンに戻る', () => {
    const b = new KillBuff();
    expect(b.stacks).toBe(0);
    expect(b.bonus(0.06)).toBe(0);
    b.onKill();
    expect(b.stacks).toBe(1);
    expect(b.remaining).toBe(KILL_BUFF.frames);
    for (let i = 0; i < 100; i++) b.step();
    expect(b.remaining).toBe(KILL_BUFF.frames - 100);
    b.onKill();
    expect(b.stacks).toBe(2);
    expect(b.remaining).toBe(KILL_BUFF.frames); // 倒し続ければ保つ
  });

  it('重なる数には上限がある（超えても増えない）。攻撃力への加算は 1 回あたり × 重なり', () => {
    const b = new KillBuff();
    for (let i = 0; i < KILL_BUFF.maxStacks + 3; i++) b.onKill();
    expect(b.stacks).toBe(KILL_BUFF.maxStacks);
    expect(b.bonus(0.02)).toBeCloseTo(0.02 * KILL_BUFF.maxStacks, 9);
    expect(b.bonus(0)).toBe(0); // 闘気を持っていない（Modifiers.killBuff = 0）
    expect(b.bonus(-1)).toBe(0);
  });

  it('時間が尽きると、重なりは全部いっぺんに消える', () => {
    const b = new KillBuff();
    b.onKill();
    b.onKill();
    for (let i = 0; i < KILL_BUFF.frames - 1; i++) b.step();
    expect(b.stacks).toBe(2);
    b.step();
    expect(b.stacks).toBe(0);
    expect(b.remaining).toBe(0);
    expect(b.ratio).toBe(0);
    b.step(); // 何もない状態で進めても壊れない
    expect(b.stacks).toBe(0);
  });

  it('ratio は残り時間の割合（1 → 0）。clear で全部消える。serial は変化があったときだけ増える', () => {
    const b = new KillBuff();
    const s0 = b.serial;
    b.step();
    b.clear();
    expect(b.serial).toBe(s0); // 何もないときは変わらない
    b.onKill();
    expect(b.ratio).toBe(1);
    for (let i = 0; i < KILL_BUFF.frames / 2; i++) b.step();
    expect(b.ratio).toBeCloseTo(0.5, 2);
    const s1 = b.serial;
    b.clear();
    expect(b.stacks).toBe(0);
    expect(b.serial).toBeGreaterThan(s1);
  });
});
