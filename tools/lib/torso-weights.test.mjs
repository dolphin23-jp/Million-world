import { describe, expect, it } from 'vitest';
import { DEFAULTS, reskinTorso, spinePhi, spineWeights } from './torso-weights.mjs';

/**
 * 胴の重みの作り直し（tools/lib/torso-weights.mjs）の性質。合成した小さなリグ（hero.glb の骨の位置、m）に頂点を置いて調べる。
 * 実際の資産（hero.glb）への効果は src/character/hero-asset.test.ts と tools/waist-stress.mjs で見る。
 */

const names = ['Hips', 'Spine02', 'Spine01', 'Spine', 'neck', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand'];
const ix = Object.fromEntries(names.map((n, i) => [n, i]));
const jointPos = {
  Hips: [0.0421, 0.9871, 0.0051],
  Spine02: [0.0421, 1.0893, 0.0087],
  Spine01: [0.0421, 1.1914, 0.0123],
  Spine: [0.0421, 1.2967, 0.016],
  neck: [0.0421, 1.3621, 0.0184],
  LeftUpLeg: [0.1442, 0.9026, 0.0051],
  RightUpLeg: [-0.06, 0.9026, 0.0051],
  LeftLeg: [0.1587, 0.576, -0.0194],
  RightLeg: [-0.076, 0.5575, -0.0178],
  LeftArm: [0.1695, 1.3402, -0.024],
  LeftForeArm: [0.2627, 1.1453, -0.0218],
  LeftHand: [0.3601, 0.9142, -0.0223],
  RightArm: [-0.0752, 1.3209, -0.0242],
  RightForeArm: [-0.1958, 1.1154, -0.0228],
  RightHand: [-0.3188, 0.9287, -0.0239],
};
const hipsY = jointPos.Hips[1];
const xMid = (jointPos.LeftUpLeg[0] + jointPos.RightUpLeg[0]) / 2;

/** 頂点 1 つ: 位置（Hips の y からの高さ・中心線からの横・前後）と元の重み（骨名 → 重み）。結果の重み（骨名 → 重み）を返す */
function run(vertices) {
  const n = vertices.length;
  const pos = new Float32Array(n * 3);
  const joints = new Uint16Array(n * 4);
  const weights = new Float32Array(n * 4);
  vertices.forEach((v, i) => {
    pos.set([xMid + v.dx, hipsY + v.dy, v.z ?? 0.0], i * 3);
    Object.entries(v.w).slice(0, 4).forEach(([name, w], k) => {
      joints[i * 4 + k] = ix[name];
      weights[i * 4 + k] = w;
    });
  });
  const out = reskinTorso({ pos, joints, weights, names, jointPos });
  return vertices.map((_, i) => {
    const r = {};
    for (let k = 0; k < 4; k++) {
      const w = out.weights[i * 4 + k];
      if (w > 0) r[names[out.joints[i * 4 + k]]] = (r[names[out.joints[i * 4 + k]]] ?? 0) + w;
    }
    return r;
  });
}
const share = (r, ...list) => list.reduce((s, n) => s + (r[n] ?? 0), 0);

describe('spineWeights / spinePhi', () => {
  it('隣り合う 2 本だけに配り、合計は 1', () => {
    for (let i = 0; i <= 100; i++) {
      const w = spineWeights(i / 100);
      expect(w.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
      expect(w.filter((v) => v > 0).length).toBeLessThanOrEqual(2);
    }
    expect(spineWeights(0)).toEqual([1, 0, 0, 0]);
    expect(spineWeights(1)).toEqual([0, 0, 0, 1]);
    expect(spineWeights(1 / 3)[1]).toBeCloseTo(1, 12);
    expect(spineWeights(2 / 3)[2]).toBeCloseTo(1, 12);
  });

  it('ウエストの上端までは 0、胸の下端から上は 1、間は単調に増える', () => {
    expect(spinePhi(DEFAULTS.y0 - 0.01)).toBe(0);
    expect(spinePhi(DEFAULTS.y1 + 0.01)).toBe(1);
    let prev = -1;
    for (let y = DEFAULTS.y0; y <= DEFAULTS.y1; y += 0.005) {
      const v = spinePhi(y);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('reskinTorso', () => {
  it('ショーツ（ウエストの上端まで）は Hips 100%、胸は Spine 100%、素肌の帯は Hips → Spine02 → Spine01 → Spine へ連続的に移る', () => {
    const [pelvis, belly, midriff, ribs, chest] = run([
      { dx: 0.05, dy: 0.05, w: { Hips: 0.5, LeftUpLeg: 0.3, Spine02: 0.2 } },
      { dx: 0.0, dy: 0.1, w: { Hips: 0.5, Spine02: 0.5 } },
      { dx: -0.05, dy: 0.165, w: { Spine02: 0.6, LeftArm: 0.4 } },
      { dx: 0.05, dy: 0.22, w: { Spine01: 0.8, LeftArm: 0.2 } },
      { dx: 0.0, dy: 0.29, w: { Spine01: 0.8, Spine02: 0.2 } },
    ]);
    expect(pelvis.Hips).toBeCloseTo(1, 5);
    expect(chest.Spine).toBeCloseTo(1, 5);
    // 帯の中: 高さとともに、回転の割合 φ = Σ w·(骨の番号/3) が増える
    const phi = (r) => ((r.Spine02 ?? 0) * 1 + (r.Spine01 ?? 0) * 2 + (r.Spine ?? 0) * 3) / 3;
    const phis = [pelvis, belly, midriff, ribs, chest].map(phi);
    for (let i = 1; i < phis.length; i++) expect(phis[i]).toBeGreaterThan(phis[i - 1]);
  });

  it('脇腹・腹に漏れていた腕の骨・脚の骨の重みを 0 にする', () => {
    const [flank, belly, waistband] = run([
      { dx: 0.093, dy: 0.17, w: { LeftArm: 0.7, Spine02: 0.1, Hips: 0.1, LeftUpLeg: 0.1 } },
      { dx: -0.03, dy: 0.12, w: { LeftUpLeg: 0.3, LeftArm: 0.3, Hips: 0.2, Spine02: 0.2 } },
      { dx: 0.14, dy: 0.08, w: { LeftUpLeg: 0.65, Hips: 0.21, LeftArm: 0.1, Spine02: 0.04 } },
    ]);
    for (const r of [flank, belly, waistband]) {
      expect(share(r, 'LeftArm', 'RightArm', 'LeftUpLeg', 'RightUpLeg')).toBeLessThan(1e-3);
      expect(share(r, 'Hips', 'Spine02', 'Spine01', 'Spine')).toBeCloseTo(1, 5);
    }
    expect(waistband.Hips).toBeGreaterThan(0.9);
  });

  it('左右対称に作る（中心線について鏡の位置の頂点は、脚の骨を左右入れ替えた同じ重みになる）', () => {
    const w = { Hips: 0.4, LeftUpLeg: 0.3, RightUpLeg: 0.3 };
    const [l, r] = run([
      { dx: 0.09, dy: -0.07, z: -0.08, w },
      { dx: -0.09, dy: -0.07, z: -0.08, w },
    ]);
    // 左右の大腿の向きがわずかに違う（メッシュ自体が完全には対称でない）ので、許容は 0.02
    const near = (a, b) => expect(Math.abs((a ?? 0) - (b ?? 0))).toBeLessThan(0.02);
    near(l.LeftUpLeg, r.RightUpLeg);
    near(l.RightUpLeg, r.LeftUpLeg);
    near(l.Hips, r.Hips);
    // 中心線の上は 50/50
    const [c] = run([{ dx: 0, dy: -0.1, z: -0.1, w }]);
    near(c.LeftUpLeg, c.RightUpLeg);
  });

  it('尻の上の方は Hips、股関節より下の大腿は脚の骨が支配する（脚の重みが腰まで漏れない）', () => {
    const [upper, hip, thigh] = run([
      { dx: 0.09, dy: 0.0, z: -0.09, w: { Hips: 0.4, LeftUpLeg: 0.6 } },
      { dx: 0.12, dy: -0.085, z: 0.0, w: { Hips: 0.5, LeftUpLeg: 0.5 } },
      { dx: 0.1, dy: -0.2, z: 0.0, w: { Hips: 0.1, LeftUpLeg: 0.9 } },
    ]);
    expect(upper.Hips).toBeGreaterThan(0.9);
    expect(hip.LeftUpLeg).toBeGreaterThan(0.3);
    expect(hip.LeftUpLeg).toBeLessThan(0.7);
    expect(thigh.LeftUpLeg).toBeGreaterThan(0.85);
  });

  it('腕・手・指（体の中心線から横に 23cm 以上）と、膝に近い大腿・脛は元の重みのまま', () => {
    const hand = { dx: 0.33, dy: -0.1, w: { LeftHand: 0.9, LeftForeArm: 0.1 } };
    const finger = { dx: 0.3, dy: 0.05, w: { LeftHand: 1 } };
    const knee = { dx: 0.1, dy: -0.4, w: { LeftLeg: 0.5, LeftUpLeg: 0.5 } };
    const [h, f, k] = run([hand, finger, knee]);
    expect(h.LeftHand).toBeCloseTo(0.9, 5);
    expect(f.LeftHand).toBeCloseTo(1, 5);
    expect(k.LeftLeg).toBeCloseTo(0.5, 5);
    expect(k.LeftUpLeg).toBeCloseTo(0.5, 5);
  });

  it('腕の皮膚（腕の軸に近い）は元の腕の重みを保つ', () => {
    // 左上腕の軸の上（肩から肘へ 40%）の頂点: 腕の骨の重みはそのまま
    const [armSkin] = run([{ dx: 0.2068 - xMid, dy: 1.2622 - hipsY, z: -0.0231, w: { LeftArm: 0.9, Spine: 0.1 } }]);
    expect(armSkin.LeftArm).toBeCloseTo(0.9, 2);
  });

  it('位置が同じ頂点（UV の継ぎ目の複製）には同じ重みを与え、重みの合計は 1、影響は 4 本まで', () => {
    const n = 3;
    const pos = new Float32Array([xMid + 0.05, hipsY + 0.16, 0, xMid + 0.05, hipsY + 0.16, 0, xMid - 0.02, hipsY + 0.2, 0.01]);
    const joints = new Uint16Array([ix.Spine02, ix.LeftArm, 0, 0, ix.Spine01, ix.Hips, ix.LeftArm, 0, ix.Spine, 0, 0, 0]);
    const weights = new Float32Array([0.7, 0.3, 0, 0, 0.5, 0.2, 0.3, 0, 1, 0, 0, 0]);
    const out = reskinTorso({ pos, joints, weights, names, jointPos });
    for (let k = 0; k < 4; k++) {
      expect(out.joints[k]).toBe(out.joints[4 + k]);
      expect(out.weights[k]).toBeCloseTo(out.weights[4 + k], 6);
    }
    for (let i = 0; i < n; i++) expect(out.weights.slice(i * 4, i * 4 + 4).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 5);
  });
});
