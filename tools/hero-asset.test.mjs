import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mat4 } from 'gl-matrix';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * 主人公の資産（public/assets/characters/hero.glb）の、骨と重みの構造の約束（ADR-022）。
 * 骨の位置の補正（tools/recenter-skeleton.mjs）と胴の再スキン（tools/reskin-torso.mjs）を通した資産が満たしているべきこと:
 *  - 骨がメッシュの中心線に対して左右対称で、メッシュの断面の中心にある（回転の中心がずれると、ひねるたびに体の片側が余計に振られて潰れる）
 *  - 四肢（上腕・前腕・大腿・脛）の子の位置が、親のローカル +Y 軸の上にある（手付けの 2 ボーン IK の前提。pose-solver.ts の limb()）
 *  - Hips の位置アニメーションが、バインドの Hips の位置と合っている（ずれるとメッシュが丸ごと滑る）
 *  - 腰・腹の重みに、腕・脚の骨が漏れていない（元のリグは脇腹に腕の重みが 50〜80%、腰に脚の重みが 65% 乗っていた）
 * 変形の崩れ度そのもの（辺の伸び・断面・ひねり）は、ブラウザで全クリップを動かす tools/waist-stress.mjs で測る。
 */

/**
 * asset:
 *  joint … 関節名 → バインド姿勢の位置（cm、ジオメトリ空間）
 *  local … 関節名 → 親から見たローカルの位置（ノードの translation。cm）
 *  names / positions / joints / weights … メッシュ（頂点の位置 m、JOINTS_0、WEIGHTS_0）
 *  hipsTrackFirst … idle の Hips の位置トラックの最初のキー（cm）
 */
let asset;

beforeAll(async () => {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.readBinary(new Uint8Array(readFileSync(new URL('../public/assets/characters/hero.glb', import.meta.url))));
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices().getArray();
  const joint = {};
  const local = {};
  joints.forEach((j, i) => {
    const inv = mat4.invert(mat4.create(), ibm.slice(i * 16, i * 16 + 16));
    joint[j.getName()] = [inv[12] * 100, inv[13] * 100, inv[14] * 100];
    const t = j.getTranslation();
    local[j.getName()] = [t[0], t[1], t[2]];
  });
  const prim = root.listMeshes()[0].listPrimitives()[0];
  const P = prim.getAttribute('POSITION');
  const J = prim.getAttribute('JOINTS_0');
  const W = prim.getAttribute('WEIGHTS_0');
  const n = P.getCount();
  const positions = new Float32Array(n * 3);
  const jj = new Uint16Array(n * 4);
  const ww = new Float32Array(n * 4);
  const tmp3 = [0, 0, 0];
  const tmp4 = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    P.getElement(i, tmp3);
    positions.set(tmp3, i * 3);
    J.getElement(i, tmp4);
    jj.set(tmp4, i * 4);
    W.getElement(i, tmp4);
    ww.set(tmp4, i * 4);
  }
  // Hips の位置トラック（cm。idle の最初のキー）
  let hipsTrackFirst = [0, 0, 0];
  const idle = root.listAnimations().find((a) => a.getName() === 'idle');
  for (const ch of idle.listChannels()) {
    if (ch.getTargetPath() === 'translation' && ch.getTargetNode().getName() === 'Hips') {
      const v = ch.getSampler().getOutput().getElement(0, [0, 0, 0]);
      hipsTrackFirst = [v[0], v[1], v[2]];
    }
  }
  asset = { joint, local, names: joints.map((j) => j.getName()), positions, joints: jj, weights: ww, hipsTrackFirst };
});

const x = (name) => asset.joint[name][0];

describe('hero.glb: 骨の位置', () => {
  it('骨が体の中心線に対して左右対称（股関節の中点が中心線）', () => {
    const mid = (x('LeftUpLeg') + x('RightUpLeg')) / 2;
    for (const n of ['Hips', 'Spine02', 'Spine01', 'Spine', 'neck']) expect(Math.abs(x(n) - mid)).toBeLessThan(0.8);
    for (const n of ['UpLeg', 'Leg', 'Foot', 'ToeBase']) expect(Math.abs((x(`Left${n}`) + x(`Right${n}`)) / 2 - mid)).toBeLessThan(0.8);
    expect(Math.abs((x('LeftArm') + x('RightArm')) / 2 - mid)).toBeLessThan(1.2);
  });

  it('骨の中心線が、メッシュの腰まわりの断面の中心（左右の端の中央）と合っている', () => {
    const mid = (x('LeftUpLeg') + x('RightUpLeg')) / 2;
    const hipsY = asset.joint.Hips[1];
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < asset.positions.length / 3; i++) {
      const y = asset.positions[i * 3 + 1] * 100 - hipsY;
      const px = asset.positions[i * 3] * 100;
      // Hips の +8〜+16cm（素肌の帯）。腕は横に 18cm 以上離れているので、中心線から 15cm 以内だけ見る
      if (y < 8 || y > 16 || Math.abs(px - mid) > 15) continue;
      lo = Math.min(lo, px);
      hi = Math.max(hi, px);
    }
    expect(Math.abs((lo + hi) / 2 - mid)).toBeLessThan(1.0);
  });

  it('四肢の子の位置が、親のローカル +Y 軸の上にある（2 ボーン IK の前提）', () => {
    for (const side of ['Left', 'Right']) {
      for (const child of [`${side}ForeArm`, `${side}Hand`, `${side}Leg`, `${side}Foot`]) {
        const t = asset.local[child];
        expect(Math.abs(t[0]), `${child} の x`).toBeLessThan(0.05);
        expect(Math.abs(t[2]), `${child} の z`).toBeLessThan(0.05);
        expect(t[1], `${child} の y`).toBeGreaterThan(15);
      }
    }
  });

  it('腕・脚の長さが、左右でほぼ同じ（メッシュは左右対称）で、補正前の範囲に収まる', () => {
    const len = (a, b) => Math.hypot(...asset.joint[a].map((v, k) => v - asset.joint[b][k]));
    const arm = (s) => len(`${s}Arm`, `${s}ForeArm`) + len(`${s}ForeArm`, `${s}Hand`);
    const leg = (s) => len(`${s}UpLeg`, `${s}Leg`) + len(`${s}Leg`, `${s}Foot`);
    expect(Math.abs(arm('Left') - arm('Right'))).toBeLessThan(2);
    expect(arm('Left')).toBeGreaterThan(44);
    expect(arm('Left')).toBeLessThan(50);
    expect(Math.abs(leg('Left') - leg('Right'))).toBeLessThan(2);
  });

  it('Hips の位置アニメーションが、バインドの Hips と x が合っている（ずれるとメッシュが丸ごと滑る）', () => {
    expect(Math.abs(asset.hipsTrackFirst[0] - asset.joint.Hips[0])).toBeLessThan(1.0);
  });
});

describe('hero.glb: 重み', () => {
  const idx = (name) => asset.names.indexOf(name);
  /** 頂点 i の、骨のグループへの重みの合計 */
  const shareOf = (i, set) => {
    let s = 0;
    for (let k = 0; k < 4; k++) if (set.has(asset.joints[i * 4 + k])) s += asset.weights[i * 4 + k];
    return s;
  };

  it('どの頂点も、重みの合計が 1', () => {
    for (let i = 0; i < asset.weights.length / 4; i++) {
      const s = asset.weights[i * 4] + asset.weights[i * 4 + 1] + asset.weights[i * 4 + 2] + asset.weights[i * 4 + 3];
      expect(Math.abs(s - 1)).toBeLessThan(2e-3);
    }
  });

  it('素肌の帯（Hips の +10〜+19cm）とショーツ（+2〜+8cm）の胴は、腕・脚の骨の重みが 0 で、胴の骨だけが支配する', () => {
    const mid = (x('LeftUpLeg') + x('RightUpLeg')) / 2;
    const hipsY = asset.joint.Hips[1];
    const arms = new Set(['LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand'].map(idx));
    const legs = new Set(['LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'].map(idx));
    const trunk = new Set(['Hips', 'Spine02', 'Spine01', 'Spine'].map(idx));
    let checked = 0;
    for (let i = 0; i < asset.positions.length / 3; i++) {
      const y = asset.positions[i * 3 + 1] * 100 - hipsY;
      const dx = Math.abs(asset.positions[i * 3] * 100 - mid);
      const midriff = y >= 10 && y <= 19 && dx <= 10;
      const shorts = y >= 2 && y <= 8 && dx <= 13;
      if (!midriff && !shorts) continue;
      checked++;
      expect(shareOf(i, arms)).toBeLessThan(2e-3);
      expect(shareOf(i, legs)).toBeLessThan(2e-3);
      expect(shareOf(i, trunk)).toBeGreaterThan(0.996);
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('ショーツ（Hips の +2〜+8cm）は Hips が支配し、胸（+26〜+28cm、背骨の近く）は Spine（胸の骨）が支配する', () => {
    const mid = (x('LeftUpLeg') + x('RightUpLeg')) / 2;
    const hipsY = asset.joint.Hips[1];
    const hips = new Set([idx('Hips')]);
    const spine = new Set([idx('Spine')]);
    let nHips = 0;
    let nSpine = 0;
    for (let i = 0; i < asset.positions.length / 3; i++) {
      const y = asset.positions[i * 3 + 1] * 100 - hipsY;
      const dx = Math.abs(asset.positions[i * 3] * 100 - mid);
      if (y >= 2 && y <= 8 && dx <= 13) {
        nHips++;
        expect(shareOf(i, hips)).toBeGreaterThan(0.97);
      }
      if (y >= 26 && y <= 28 && dx <= 6) {
        nSpine++;
        expect(shareOf(i, spine)).toBeGreaterThan(0.75);
      }
    }
    expect(nHips).toBeGreaterThan(300);
    expect(nSpine).toBeGreaterThan(30);
  });
});
