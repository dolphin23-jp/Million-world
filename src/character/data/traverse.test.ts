import { describe, expect, it } from 'vitest';
import { traverseDef, traverseName, traverseSpec, traverseSpecsFor } from './traverse';
import { rootYCurve, rootZCurve } from '../authoring';
import { TRAVERSE } from '../../combat/data/traverse';
import { ARENA_WORLD } from '../../world/data/arena-props';

describe('traverseSpec / traverseDef: 乗り上がり・乗り越えのクリップの仕様', () => {
  it('高さ・前進量は刻みに丸められ、同じ仕様は同じ名前・同じ定義（メモ化）', () => {
    const a = traverseSpec('mantle', 0.87, 0.93);
    expect(a.height).toBeCloseTo(0.85);
    expect(a.span).toBeCloseTo(0.95);
    expect(traverseName(a)).toBe('mantle@0.85@0.95');
    expect(traverseDef(a)).toBe(traverseDef(traverseSpec('mantle', 0.86, 0.94)));
    expect(traverseDef(a)).not.toBe(traverseDef(traverseSpec('vault', 0.87, 1.45)));
  });

  it('乗り上がり: 体は上面の高さまで上がり（単調）、前進量は仕様どおり。時間は 0.7 秒', () => {
    for (const h of [0.5, 0.85, 1.2]) {
      const spec = traverseSpec('mantle', h, 0.95);
      const def = traverseDef(spec);
      const y = rootYCurve(def);
      const z = rootZCurve(def);
      expect(def.duration).toBeCloseTo(0.7);
      expect(y(0)).toBe(0);
      expect(y(def.duration)).toBeCloseTo(spec.height, 9);
      expect(z(def.duration)).toBeCloseTo(spec.span, 9);
      let prev = 0;
      let monotone = true;
      for (let t = 0; t <= def.duration; t += 0.01) {
        const v = y(t);
        if (v < prev - 1e-9) monotone = false;
        prev = v;
      }
      expect(monotone).toBe(true);
    }
  });

  it('乗り越え: 体は面の上を弧で越えて地面（0）に戻り、終点の前進量は仕様どおり。時間は 0.55 秒', () => {
    const spec = traverseSpec('vault', 0.9, 1.45);
    const def = traverseDef(spec);
    const y = rootYCurve(def);
    const z = rootZCurve(def);
    expect(def.duration).toBeCloseTo(0.55);
    expect(y(def.duration)).toBe(0);
    expect(z(def.duration)).toBeCloseTo(spec.span, 9);
    let peak = 0;
    for (let t = 0; t <= def.duration; t += 0.01) peak = Math.max(peak, y(t));
    expect(peak).toBeGreaterThan(0.1);
    // 面（faceZ）を越えるのは、体が上がっているあいだ
    for (let t = 0; t <= def.duration; t += 0.01) if (z(t) > TRAVERSE.faceZ - 0.05 && z(t) < TRAVERSE.faceZ + 0.4) expect(y(t)).toBeGreaterThan(0.05);
  });

  it('手を上面につくのは H ≥ 0.7 の乗り上がりだけ（低い段差は手を使わずにまたぐ）。乗り越えは常に右手をつく', () => {
    const hasHand = (kind: 'mantle' | 'vault', h: number, span: number): boolean => traverseDef(traverseSpec(kind, h, span)).keys.some((k) => k.gripAt !== undefined && k.gripAt !== null);
    expect(hasHand('mantle', 0.5, 0.95)).toBe(false);
    expect(hasHand('mantle', 0.9, 0.95)).toBe(true);
    expect(hasHand('vault', 0.9, 1.45)).toBe(true);
  });

  it('traverseSpecsFor: 闘技場の低い岩・壁から、乗り上がり（岩・壁）と乗り越え（薄い壁）の仕様が出る。高い柱・箱・段差の低い物は出ない', () => {
    const names = traverseSpecsFor(ARENA_WORLD.obstacles).map(traverseName);
    expect(names.some((n) => n.startsWith('mantle@0.85'))).toBe(true); // 岩
    expect(names.some((n) => n.startsWith('mantle@0.90'))).toBe(true); // 壁
    expect(names.some((n) => n.startsWith('vault@0.90'))).toBe(true); // 薄い壁（厚み 0.6）
    expect(names.some((n) => n.includes('@1.50@'))).toBe(false); // 石の箱は越えられない（登りは M7-3b）
    expect(new Set(names).size).toBe(names.length);
  });
});
