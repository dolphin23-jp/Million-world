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

  it('登り: 体は縁へ跳びつき、ぶら下がって、上面の高さまで上がる（沈みは 6cm 未満）。前進量は仕様どおり。時間は乗り上がりより長い', () => {
    for (const h of [1.3, 1.5, 2.2]) {
      const spec = traverseSpec('climb', h, 0.95);
      const def = traverseDef(spec);
      const y = rootYCurve(def);
      const z = rootZCurve(def);
      expect(traverseName(spec)).toBe(`climb@${h.toFixed(2)}@0.95`);
      expect(def.duration).toBeGreaterThan(0.9);
      expect(def.duration).toBeLessThan(1.2);
      expect(y(0)).toBe(0);
      expect(y(def.duration)).toBeCloseTo(spec.height, 9);
      expect(z(def.duration)).toBeCloseTo(spec.span, 9);
      let peak = 0;
      let sag = 0;
      for (let t = 0; t <= def.duration; t += 0.01) {
        peak = Math.max(peak, y(t));
        sag = Math.max(sag, peak - y(t));
      }
      expect(sag).toBeLessThan(0.06);
      // 縁を越える（面の位置を過ぎる）のは、体が上面の近くまで上がってから
      for (let t = 0; t <= def.duration; t += 0.01) if (z(t) > TRAVERSE.faceZ) expect(y(t)).toBeGreaterThan(spec.height * 0.6);
    }
  });

  it('登り: 縁を掴む手は、上面の高さに世界座標で付く。掴む前（構え）と離したあとは付けない（k = 0）。高いほど跳びつく（掴むときの足元が上がる）', () => {
    const def = traverseDef(traverseSpec('climb', 2.2, 0.95));
    const hands = def.keys.filter((k) => k.gripAt !== undefined);
    const grabs = hands.filter((k) => k.gripAt !== null);
    expect(grabs.length).toBeGreaterThanOrEqual(2);
    for (const k of grabs) expect(k.gripAt![1]).toBeCloseTo(2.2 + 0.03, 6);
    expect(hands[0]!.gripAt).toBeNull(); // 構えが終わるまで手を寄せない
    expect(hands[hands.length - 1]!.gripAt).toBeNull(); // 引き上げたら離す
    const low = rootYCurve(traverseDef(traverseSpec('climb', 1.3, 0.95)));
    const high = rootYCurve(traverseDef(traverseSpec('climb', 2.2, 0.95)));
    expect(high(0.25)).toBeGreaterThan(low(0.25) + 0.3); // 掴む前後の高さ
  });

  it('traverseSpecsFor: 闘技場の低い岩・壁から、乗り上がり（岩・壁）と乗り越え（薄い壁）の仕様が出る。登れる箱・壇には登りが出る。登れない高い柱・段差の低い物は出ない', () => {
    const names = traverseSpecsFor(ARENA_WORLD.obstacles).map(traverseName);
    expect(names.some((n) => n.startsWith('mantle@0.85'))).toBe(true); // 岩
    expect(names.some((n) => n.startsWith('mantle@0.90'))).toBe(true); // 壁
    expect(names.some((n) => n.startsWith('vault@0.90'))).toBe(true); // 薄い壁（厚み 0.6）
    expect(names.some((n) => n.startsWith('climb@1.50@'))).toBe(true); // 石の箱（登れる縁）
    expect(names.some((n) => n.startsWith('climb@2.20@'))).toBe(true); // 石の壇（登れる縁）
    expect(names.some((n) => n.startsWith('mantle@1.50') || n.startsWith('vault@1.50'))).toBe(false); // 高い縁は乗り上がりにならない
    expect(names.some((n) => n.startsWith('climb@3.20') || n.startsWith('climb@4.50'))).toBe(false); // 柱は登れない
    expect(new Set(names).size).toBe(names.length);
    // 登れる縁でなければ、同じ高さでも登りの仕様は出ない
    const plain = traverseSpecsFor([{ kind: 'box', x: 0, z: 5, hx: 1, hz: 1, yaw: 0, top: 1.5 }]).map(traverseName);
    expect(plain.length).toBe(0);
  });
});
