import { describe, expect, it } from 'vitest';
import { AdaptiveResolution, buildLevels } from './adaptive-resolution';

/** 一定の frameMs を n フレーム流し、途中で段が変わったら記録する */
function feed(a: AdaptiveResolution, ms: number, frames: number): number[] {
  const changes: number[] = [];
  for (let i = 0; i < frames; i++) {
    const r = a.update(ms);
    if (r !== null) changes.push(r);
  }
  return changes;
}

const opts = { levels: [1.5, 1.25, 1.0], windowFrames: 10, settleFrames: 5, upAfterWindows: 3, upAfterMax: 12 };

describe('AdaptiveResolution', () => {
  it('起動直後の遅いフレームは捨てる（設定の猶予）', () => {
    const a = new AdaptiveResolution(opts);
    expect(feed(a, 40, 10)).toEqual([]); // settle = 5*2 = 10 フレーム
    expect(a.ratio).toBe(1.5);
  });

  it('遅い窓が続くと 1 段ずつ下げ、最下段で止まる', () => {
    const a = new AdaptiveResolution(opts);
    feed(a, 16, 10); // 猶予を消化
    expect(feed(a, 30, 10)).toEqual([1.25]);
    feed(a, 30, 5); // 切り替え直後の猶予
    expect(feed(a, 30, 10)).toEqual([1.0]);
    feed(a, 30, 5);
    expect(feed(a, 30, 100)).toEqual([]);
    expect(a.ratio).toBe(1.0);
  });

  it('余裕が続けば 1 段戻す。ぎりぎり（60fps ちょうど）では戻さない', () => {
    const a = new AdaptiveResolution(opts);
    feed(a, 16, 10);
    feed(a, 30, 10); // → 1.25
    feed(a, 30, 5);
    expect(feed(a, 18.5, 60)).toEqual([]); // fastMs(17.6) より遅いので戻さない
    expect(feed(a, 16.7, 30)).toEqual([1.5]); // 3 窓続いて戻す
  });

  it('戻したらすぐ遅くなった段は、次に戻すまでの待ちを倍にする', () => {
    const a = new AdaptiveResolution(opts);
    feed(a, 16, 10);
    feed(a, 30, 10); // → 1.25
    feed(a, 30, 5);
    expect(feed(a, 16, 30)).toEqual([1.5]); // 3 窓で戻す
    feed(a, 16, 5);
    expect(feed(a, 30, 10)).toEqual([1.25]); // 戻し失敗 → また下げる。1.5 への待ちが 3 → 6 窓に
    feed(a, 30, 5);
    expect(feed(a, 16, 50)).toEqual([]); // 5 窓では戻さない
    expect(feed(a, 16, 10)).toEqual([1.5]); // 6 窓目で戻す
  });

  it('外れ値（タブ復帰など）の 1 フレームは数えない', () => {
    const a = new AdaptiveResolution(opts);
    feed(a, 16, 10);
    for (let w = 0; w < 5; w++) {
      feed(a, 16, 9);
      expect(a.update(900)).toBeNull();
      expect(a.update(16)).toBeNull();
    }
    expect(a.ratio).toBe(1.5);
  });

  it('lock() または段が 1 つなら何もしない', () => {
    const locked = new AdaptiveResolution(opts);
    locked.lock();
    expect(feed(locked, 50, 200)).toEqual([]);
    const single = new AdaptiveResolution({ ...opts, levels: [1] });
    expect(single.inert).toBe(true);
    expect(feed(single, 50, 200)).toEqual([]);
  });

  it('buildLevels: DPR を超える段は潰して降順・重複なしにする', () => {
    expect(buildLevels(2, [1, 1.5, 1.25])).toEqual([1.5, 1.25, 1]);
    expect(buildLevels(1.25, [1.5, 1.25, 1])).toEqual([1.25, 1]);
    expect(buildLevels(1, [1.5, 1.25, 1])).toEqual([1]);
  });
});
