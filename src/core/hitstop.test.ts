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
});
