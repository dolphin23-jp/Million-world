import { describe, expect, it } from 'vitest';
import { HitStop } from './hitstop';

const DT = 1 / 60;

describe('HitStop', () => {
  it('trigger した sim フレーム数ぶん、実時間で sim を止める', () => {
    const h = new HitStop();
    h.trigger(4);
    const scales: number[] = [];
    for (let i = 0; i < 7; i++) scales.push(h.update(DT));
    // 60Hz の描画で 4 回止まり、5 回目から 1
    expect(scales).toEqual([0, 0, 0, 0, 1, 1, 1]);
    expect(h.active).toBe(false);
  });

  it('止めている合計の実時間は frames / 60 秒（描画の dt が 60Hz でなくても同じ）', () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
      const h = new HitStop();
      h.trigger(6);
      let stopped = 0;
      for (let i = 0; i < 100 && h.active; i++) {
        const scale = h.update(dt);
        if (scale === 0) stopped += dt;
      }
      // 描画の刻みが粗いと最後の 1 描画ぶん（高々 dt）だけ長く止まる
      expect(stopped).toBeGreaterThanOrEqual(6 / 60 - 1e-9);
      expect(stopped).toBeLessThanOrEqual(6 / 60 + dt);
    }
  });

  it('重なったときは足さずに長いほうを取る', () => {
    const h = new HitStop();
    h.trigger(10);
    h.update(5 * DT);
    h.trigger(3); // 残り 5 フレームぶんあるので、3 では短くならない
    let n = 0;
    while (h.active) {
      h.update(DT);
      n++;
    }
    expect(n).toBe(5);

    const g = new HitStop();
    g.trigger(3);
    g.trigger(12);
    let m = 0;
    while (g.active) {
      g.update(DT);
      m++;
    }
    expect(m).toBe(12);
  });

  it('0 以下や止まっていないときは何もしない（timeScale 1）', () => {
    const h = new HitStop();
    h.trigger(0);
    h.trigger(-3);
    expect(h.active).toBe(false);
    expect(h.update(DT)).toBe(1);
  });

  it('reset で止まっている状態を解く', () => {
    const h = new HitStop();
    h.trigger(30);
    h.reset();
    expect(h.active).toBe(false);
    expect(h.update(DT)).toBe(1);
  });

  describe('スローモーション', () => {
    it('slow の間は scale、過ぎたら 1。時間は実時間で数える', () => {
      const h = new HitStop();
      h.slow(0.3, 0.1);
      const scales: number[] = [];
      for (let i = 0; i < 10; i++) scales.push(h.update(DT));
      // 0.1 秒 = 6 フレーム。最後の 1 回で尽きて 1 に戻る
      expect(scales.slice(0, 5)).toEqual([0.3, 0.3, 0.3, 0.3, 0.3]);
      expect(scales.slice(6)).toEqual([1, 1, 1, 1]);
      expect(h.active).toBe(false);
    });

    it('ヒットストップ（止める）のほうが強く、止まっている間もスローの時間は進む', () => {
      const h = new HitStop();
      h.slow(0.3, 0.2);
      h.trigger(6);
      const scales: number[] = [];
      for (let i = 0; i < 8; i++) scales.push(h.update(DT));
      expect(scales.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
      expect(scales[6]).toBe(0.3);
      // スローは 0.2 秒 = 12 フレームで尽きる（止めていた 6 フレームも数える）。ここまで 8 回、11 回目まで 0.3、12 回目で 1
      for (let i = 0; i < 3; i++) expect(h.update(DT)).toBe(0.3);
      expect(h.update(DT)).toBe(1);
    });

    it('重なったときは、いまより遅いスローだけが置き換える。遅いほうの scale を保つ', () => {
      const h = new HitStop();
      h.slow(0.3, 0.5);
      h.slow(0.8, 0.5); // 軽いスローは scale を変えない
      expect(h.update(DT)).toBe(0.3);
      h.slow(0.1, 0.5);
      expect(h.update(DT)).toBe(0.1);
    });

    it('scale >= 1 や 0 秒以下は無視する。reset で解く', () => {
      const h = new HitStop();
      h.slow(1, 1);
      h.slow(0.5, 0);
      expect(h.active).toBe(false);
      h.slow(0.5, 1);
      h.reset();
      expect(h.update(DT)).toBe(1);
    });
  });
});
