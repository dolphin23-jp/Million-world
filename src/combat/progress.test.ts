import { describe, expect, it } from 'vitest';
import { Progress } from './progress';
import { TIER_MAX } from '../ai/data/tiers';

describe('Progress（挑戦の進み具合）', () => {
  it('最初は何もクリアしておらず、段階 1 だけ挑める', () => {
    const p = new Progress();
    expect(p.cleared).toBe(0);
    expect(p.tier).toBe(1);
    expect(p.unlocked).toBe(1);
    expect(p.canSelect(1)).toBe(true);
    expect(p.canSelect(2)).toBe(false);
    expect(p.select(2)).toBe(false);
    expect(p.tier).toBe(1);
    expect(p.next).toBeNull();
  });

  it('段階 n をクリアすると n + 1 が解放される（新しく解放された段階を返す）。選んでいる段階は自動では変わらない', () => {
    const p = new Progress();
    expect(p.onClear(1)).toBe(2);
    expect(p.cleared).toBe(1);
    expect(p.unlocked).toBe(2);
    expect(p.tier).toBe(1);
    expect(p.next).toBe(2);
    expect(p.select(2)).toBe(true);
    expect(p.tier).toBe(2);
    expect(p.next).toBeNull(); // 2 の次（3）はまだ解放されていない
  });

  it('同じ段階・低い段階をもう一度クリアしても、解放は増えない（null）。解放前の段階のクリアは数えない', () => {
    const p = new Progress({ cleared: 2 });
    expect(p.onClear(2)).toBeNull();
    expect(p.onClear(1)).toBeNull();
    expect(p.onClear(4)).toBeNull(); // まだ挑めない段階のクリアは来ない（来ても数えない）
    expect(p.cleared).toBe(2);
    expect(p.onClear(3)).toBe(4);
  });

  it('最高の段階をクリアすると、それ以上は解放されない（null）。解放の上限は TIER_MAX', () => {
    const p = new Progress({ cleared: TIER_MAX - 1 });
    expect(p.unlocked).toBe(TIER_MAX);
    expect(p.onClear(TIER_MAX)).toBeNull();
    expect(p.cleared).toBe(TIER_MAX);
    expect(p.unlocked).toBe(TIER_MAX);
    expect(p.select(TIER_MAX)).toBe(true);
    expect(p.next).toBeNull();
  });

  it('解放済みの段階はいつでも選び直せる（低い段階で遊び直してよい）。next は選んでいる段階の次', () => {
    const p = new Progress({ cleared: 3, tier: 4 });
    expect(p.tier).toBe(4);
    expect(p.select(1)).toBe(true);
    expect(p.next).toBe(2);
    expect(p.select(3)).toBe(true);
    expect(p.next).toBe(4);
    expect(p.select(5)).toBe(false);
    expect(p.select(0)).toBe(false);
    expect(p.select(1.5)).toBe(false);
  });

  it('保存から戻すとき、範囲を丸め、解放していない段階を選んでいたら解放済みの最高に戻す', () => {
    expect(new Progress({ cleared: 1, tier: 4 }).toSnapshot()).toEqual({ cleared: 1, tier: 2 });
    expect(new Progress({ cleared: 99, tier: 99 }).toSnapshot()).toEqual({ cleared: TIER_MAX, tier: TIER_MAX });
    expect(new Progress({ cleared: -3, tier: -1 }).toSnapshot()).toEqual({ cleared: 0, tier: 1 });
    expect(new Progress({ cleared: Number.NaN, tier: 'x' as unknown as number }).toSnapshot()).toEqual({ cleared: 0, tier: 1 });
    expect(new Progress({ cleared: 1.6 }).toSnapshot().cleared).toBe(2);
  });

  it('serial は変化があったときだけ増える。reset は最初に戻す', () => {
    const p = new Progress();
    const s0 = p.serial;
    p.select(1); // 同じ選択
    expect(p.serial).toBe(s0);
    p.onClear(1);
    expect(p.serial).toBeGreaterThan(s0);
    const s1 = p.serial;
    p.onClear(1);
    expect(p.serial).toBe(s1);
    p.select(2);
    expect(p.serial).toBeGreaterThan(s1);
    p.reset();
    expect(p.toSnapshot()).toEqual({ cleared: 0, tier: 1 });
  });
});
