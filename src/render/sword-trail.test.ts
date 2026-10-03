import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SwordTrail } from './sword-trail';

const DT = 1 / 60;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** 半径 r の円弧上を角度 a（rad）に置いた先端側（y = 1.1）と根元側（y = 0.3）の点 */
const arc = (a: number, r = 1.5) => ({ tip: v(Math.sin(a) * r, 1.1, Math.cos(a) * r), base: v(Math.sin(a) * r * 0.4, 0.3, Math.cos(a) * r * 0.4) });

function swing(trail: SwordTrail, frames: number, a0 = -1, step = 0.45) {
  for (let i = 0; i < frames; i++) {
    const p = arc(a0 + i * step);
    trail.update(DT, true, p.base, p.tip);
  }
}

describe('SwordTrail', () => {
  it('記録した点が 1 つのうちは描かず、2 つ以上で四角形を描く', () => {
    const t = new SwordTrail();
    swing(t, 1);
    expect(t.drawnIndices).toBe(0);
    swing(t, 1);
    expect(t.drawnIndices).toBeGreaterThan(0);
    expect(t.drawnIndices % 6).toBe(0);
  });

  it('点の間は補間され、記録した点の数より多い区間に分かれる', () => {
    const t = new SwordTrail();
    swing(t, 5);
    // 5 点 → 4 区間 × 4 分割 = 16 四角形
    expect(t.drawnIndices / 6).toBe(16);
  });

  it('補間した曲線は円弧に沿う（直線でつないだ弦より外側 = 半径に近い）', () => {
    const t = new SwordTrail();
    swing(t, 3, -1, 0.9); // 点どうしの角度が大きい
    const pos = (t.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const quads = t.drawnIndices / 6;
    let minR = Infinity;
    // 先端側の頂点（偶数番）の水平半径。弦だけなら中点で半径が大きく落ちる
    for (let i = 0; i <= quads; i++) minR = Math.min(minR, Math.hypot(pos[i * 6]!, pos[i * 6 + 2]!));
    const chordMid = Math.cos(0.45) * 1.5; // 角度差 0.9 の弦の中点の半径
    expect(minR).toBeGreaterThan(chordMid + 0.02);
  });

  it('寿命を過ぎた点は取り除かれ、記録が止まれば最後は何も描かない', () => {
    const t = new SwordTrail(16, 0.2);
    swing(t, 6);
    const p = arc(2);
    for (let i = 0; i < 30; i++) t.update(DT, false, p.base, p.tip);
    expect(t.sampleCount).toBe(0);
    expect(t.drawnIndices).toBe(0);
  });

  it('dt = 0（ヒットストップ）のあいだは記録も老化もしない', () => {
    const t = new SwordTrail();
    swing(t, 4);
    const n = t.sampleCount;
    const idx = t.drawnIndices;
    const p = arc(3);
    for (let i = 0; i < 20; i++) t.update(0, true, p.base, p.tip);
    expect(t.sampleCount).toBe(n);
    expect(t.drawnIndices).toBe(idx);
  });

  it('ストロークの切れ目では前の剣筋とつながない', () => {
    const t = new SwordTrail(16, 0.5);
    swing(t, 3);
    const one = t.drawnIndices;
    const p = arc(0);
    t.update(DT, false, p.base, p.tip); // 区間の外（切れ目）
    t.update(DT, false, p.base, p.tip);
    swing(t, 1, 1.2); // 新しいストロークの最初の点
    // 新しい点は前の点と四角形でつながれない（描く数は増えない）
    expect(t.drawnIndices).toBe(one);
    swing(t, 1, 1.65);
    expect(t.drawnIndices).toBeGreaterThan(one);
  });

  it('記録の点数は上限を超えない（古い点から捨てる）', () => {
    const t = new SwordTrail(8, 5);
    swing(t, 40);
    expect(t.sampleCount).toBe(8);
  });

  it('頂点の色の不透明度は、新しい点ほど濃く、根元側は先端側より薄い', () => {
    const t = new SwordTrail(16, 0.3);
    swing(t, 8);
    const col = (t.mesh.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
    const quads = t.drawnIndices / 6;
    const lastTip = col[quads * 2 * 4 + 3]!;
    const firstTip = col[3]!;
    const lastBase = col[(quads * 2 + 1) * 4 + 3]!;
    expect(lastTip).toBeGreaterThan(firstTip);
    expect(lastBase).toBeLessThan(lastTip);
  });
});
