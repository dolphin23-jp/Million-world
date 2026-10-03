import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { eulerYPR, frameRotation, polarToVector, solveTwoBone, swingTwist, swordRotation, vectorToPolar } from './ik';

const close = (a: Vector3, b: Vector3, eps = 1e-5) => expect(a.distanceTo(b)).toBeLessThan(eps);
const rnd = (() => {
  let s = 12345;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
})();

describe('solveTwoBone', () => {
  it('届く目標には手首がちょうど届き、骨の長さが保たれる', () => {
    const root = new Vector3(0.1, 1.3, 0);
    const E = new Vector3();
    const W = new Vector3();
    for (let i = 0; i < 50; i++) {
      const target = new Vector3(root.x + rnd() * 0.3, root.y + rnd() * 0.3, root.z + rnd() * 0.3);
      const pole = new Vector3(rnd(), rnd(), rnd());
      const r = solveTwoBone(root, target, 0.23, 0.21, pole, E, W);
      if (r.clamped) continue;
      close(W, target);
      expect(E.distanceTo(root)).toBeCloseTo(0.23, 5);
      expect(W.distanceTo(E)).toBeCloseTo(0.21, 5);
    }
  });

  it('肘は pole の側へ出る', () => {
    const E = new Vector3();
    const W = new Vector3();
    solveTwoBone(new Vector3(0, 0, 0), new Vector3(0, 0, 0.3), 0.23, 0.21, new Vector3(0, -1, 0), E, W);
    expect(E.y).toBeLessThan(-0.05);
    solveTwoBone(new Vector3(0, 0, 0), new Vector3(0, 0, 0.3), 0.23, 0.21, new Vector3(1, 0, 0), E, W);
    expect(E.x).toBeGreaterThan(0.05);
  });

  it('遠すぎる目標は伸び切り（clamped）、手首は目標方向の最大到達点', () => {
    const E = new Vector3();
    const W = new Vector3();
    const r = solveTwoBone(new Vector3(), new Vector3(2, 0, 0), 0.23, 0.21, new Vector3(0, 1, 0), E, W);
    expect(r.clamped).toBe(true);
    expect(W.length()).toBeCloseTo(0.44, 2);
    expect(W.y).toBeCloseTo(0, 5);
    // 伸び切りでも蝶番軸が定まる（pole × 方向）
    expect(r.hinge.length()).toBeCloseTo(1, 5);
  });

  it('蝶番軸 = cross(上腕, 前腕) の向き（肘が曲がっているとき）', () => {
    const E = new Vector3();
    const W = new Vector3();
    const r = solveTwoBone(new Vector3(), new Vector3(0.1, -0.2, 0.25), 0.23, 0.21, new Vector3(0, -1, 0.3), E, W);
    const up = E.clone();
    const fore = W.clone().sub(E);
    const n = new Vector3().crossVectors(up, fore).normalize();
    expect(n.dot(r.hinge)).toBeGreaterThan(0.999);
  });
});

describe('frameRotation', () => {
  it('局所の (y, h) を世界の (y, h) へ写す', () => {
    for (let i = 0; i < 30; i++) {
      const yl = new Vector3(rnd(), rnd(), rnd()).normalize();
      const hl = new Vector3(rnd(), rnd(), rnd());
      hl.addScaledVector(yl, -hl.dot(yl)).normalize();
      const yw = new Vector3(rnd(), rnd(), rnd()).normalize();
      const hw = new Vector3(rnd(), rnd(), rnd());
      hw.addScaledVector(yw, -hw.dot(yw)).normalize();
      const q = frameRotation(yl, hl, yw, hw, new Quaternion());
      close(yl.clone().applyQuaternion(q), yw);
      close(hl.clone().applyQuaternion(q), hw);
    }
  });
});

describe('swingTwist', () => {
  it('swing · twist = q で、twist は軸まわりだけ', () => {
    const axis = new Vector3(0, 1, 0);
    for (let i = 0; i < 30; i++) {
      const q = new Quaternion(rnd(), rnd(), rnd(), rnd()).normalize();
      const s = new Quaternion();
      const t = new Quaternion();
      swingTwist(q, axis, s, t);
      const back = s.clone().multiply(t);
      expect(Math.abs(back.dot(q))).toBeGreaterThan(0.99999);
      // twist のベクトル部は軸方向のみ
      expect(Math.abs(t.x)).toBeLessThan(1e-6);
      expect(Math.abs(t.z)).toBeLessThan(1e-6);
      // 軸は swing で動かない側ではなく twist では動かない
      close(axis.clone().applyQuaternion(t), axis);
    }
  });
});

describe('swordRotation', () => {
  it('局所 +Y = 刃、+Z = 面の法線（ヒントを刃に垂直化）、+X = 刃 × 法線', () => {
    const blade = new Vector3(0.2, -0.6, 0.7).normalize();
    const face = new Vector3(-1, 0.3, 0);
    const q = swordRotation(blade, face, new Quaternion());
    close(new Vector3(0, 1, 0).applyQuaternion(q), blade);
    const z = new Vector3(0, 0, 1).applyQuaternion(q);
    expect(Math.abs(z.dot(blade))).toBeLessThan(1e-6);
    expect(z.dot(face.clone().normalize())).toBeGreaterThan(0.8);
    const x = new Vector3(1, 0, 0).applyQuaternion(q);
    close(x, new Vector3().crossVectors(blade, z));
  });
});

describe('座標・角度の規約', () => {
  it('極座標: 正面 = +Z、右 = −X、上 = +Y。往復で一致', () => {
    const v = new Vector3();
    close(polarToVector(0, 0, 1, v), new Vector3(0, 0, 1));
    close(polarToVector(Math.PI / 2, 0, 1, v), new Vector3(-1, 0, 0));
    close(polarToVector(0, Math.PI / 2, 1, v), new Vector3(0, 1, 0));
    const p = vectorToPolar(new Vector3(-0.3, 0.4, 0.5));
    close(polarToVector(p.az, p.el, p.r, v), new Vector3(-0.3, 0.4, 0.5));
  });

  it('eulerYPR: yaw 正 = 右へ、pitch 正 = 前傾、roll 正 = 右へ傾く', () => {
    const q = new Quaternion();
    const f = new Vector3(0, 0, 1);
    const up = new Vector3(0, 1, 0);
    close(f.clone().applyQuaternion(eulerYPR(Math.PI / 2, 0, 0, q)), new Vector3(-1, 0, 0));
    close(up.clone().applyQuaternion(eulerYPR(0, Math.PI / 2, 0, q)), new Vector3(0, 0, 1));
    close(up.clone().applyQuaternion(eulerYPR(0, 0, Math.PI / 2, q)), new Vector3(-1, 0, 0));
  });
});
