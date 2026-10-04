#!/usr/bin/env node
/**
 * 骨（関節）の位置を、メッシュの断面の中心へ寄せる（docs/05-asset-automation.md「骨の位置の補正」/ ADR-022）。
 *
 *   node tools/recenter-skeleton.mjs <in.glb> <out.glb> [tools/data/hero-joint-offsets.json]
 *
 * Meshy の自動リグは、メッシュに対して骨が全体にずれていた（tools/measure-joint-centers.mjs で測る）:
 * 体の中心線が x = +4.2cm（腕・脚・胴の断面が左右対称になる軸）なのに、骨盤・背骨は x = −3.6cm（7.8cm 右へずれ、体の右の縁の近く）、
 * 股関節は大腿の中心から 6.6〜9.3cm 内側、左肩は肩の中心から 6.8cm 胸の中、膝・足首は 3.4〜4.1cm 右。
 * 関節を軸にして皮膚を回すスキニングでは、回転の中心がずれていると、ひねる・曲げるたびに体の片側が余計に振られて潰れる・伸びる。
 *
 * このツールは、各関節のバインド姿勢の位置を offsets.json の目標（cm、ジオメトリ空間。null の軸は動かさない）へ動かし、次を一貫して書き換える
 * （目標の位置なので、補正済みの GLB にかけても何も変わらない）:
 *  - 逆バインド行列（IBM）= 新しいバインド世界行列の逆
 *  - 骨ノードのローカルの位置（親のローカル座標。Hips は Armature のローカル。単位は元ファイルと同じ）
 *  - 四肢の骨（上腕・前腕・大腿・脛）は、バインド姿勢の向きを、新しい子の位置へ向け直す（最短の回転）。
 *    手付けアニメ（PoseSolver の 2 ボーン IK）は「子の位置は親のローカル +Y 軸の上」を前提に回転を作るので、位置を動かしたら軸も合わせる必要がある。
 *    向け直した分だけ（D = R⁻¹·R'）、その骨と子の回転（ノードの静止回転と全クリップの回転トラック）を共役で直す: Q' = D_親⁻¹ · Q · D。
 *    こうすると、全クリップで「バインドからの世界回転の変化」が元と同じになり、既存の動きの意味は変わらず、回転の中心だけが体の中心に来る
 *  - Hips の位置アニメーション（全キーに同じ差分を足す）
 * メッシュの頂点・テクスチャは触らない。バインド姿勢の見た目は変わらない。
 * 骨の長さは変わる（腕 ±2.5cm、脚 ≤ 1cm 程度）ので、手付けアニメ（PoseSolver）は読み込み時にリグから作り直され、IK はそれに合わせて解く。
 * 手首（LeftHand/RightHand）は動かさない: 剣の握り（HERO.sword）は手ボーンのローカルで調整してあり、手の世界回転は変えない（D = I）。
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mat4, vec3, quat } from 'gl-matrix';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const [inp, out, offsetsPath = resolve(here, 'data/hero-joint-offsets.json')] = args;
if (!inp || !out) {
  console.error('使い方: node tools/recenter-skeleton.mjs <in.glb> <out.glb> [offsets.json]');
  process.exit(1);
}
const spec = JSON.parse(readFileSync(offsetsPath, 'utf8'));
const targets = spec.targetCm;
/** 子の位置へ向け直す骨（親 → 最初の子）。2 ボーン IK の対象（腕・脚）で、子の位置が親のローカル +Y 軸の上にあることを保つ */
const REAIM = spec.reaim ?? {
  LeftArm: 'LeftForeArm',
  LeftForeArm: 'LeftHand',
  RightArm: 'RightForeArm',
  RightForeArm: 'RightHand',
  LeftUpLeg: 'LeftLeg',
  LeftLeg: 'LeftFoot',
  RightUpLeg: 'RightLeg',
  RightLeg: 'RightFoot',
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
const root = doc.getRoot();
const skin = root.listSkins()[0];
if (!skin) throw new Error('スキンがありません');
const joints = skin.listJoints();
const nameOf = joints.map((j) => j.getName());
const index = new Map(joints.map((j, i) => [j, i]));
const byName = new Map(nameOf.map((n, i) => [n, i]));
const ibmAcc = skin.getInverseBindMatrices();
const ibm = ibmAcc.getArray();
for (const name of Object.keys(targets)) if (!byName.has(name)) throw new Error(`骨がありません: ${name}`);
for (const [a, b] of Object.entries(REAIM)) if (!byName.has(a) || !byName.has(b)) throw new Error(`向け直しの骨がありません: ${a} → ${b}`);

// バインド世界行列（ジオメトリ空間、m。線形部分は回転 × 0.01 = 骨の座標系が持つ Armature の拡縮）
const bind = joints.map((_, i) => mat4.invert(mat4.create(), ibm.slice(i * 16, i * 16 + 16)));
const pos = (M) => vec3.fromValues(M[12], M[13], M[14]);
const P = bind.map(pos);
const newP = P.map((p, i) => {
  const t = targets[nameOf[i]] ?? [null, null, null];
  return vec3.fromValues(t[0] === null ? p[0] : t[0] / 100, t[1] === null ? p[1] : t[1] / 100, t[2] === null ? p[2] : t[2] / 100);
});
/** 関節 i の移動量（m） */
const deltaOf = (i) => vec3.sub(vec3.create(), newP[i], P[i]);
const rotOf = (M) => mat4.getRotation(quat.create(), M);

// 向け直し: 世界の回転 dR（古い子の向き → 新しい子の向き）と、骨の座標系での差 D = R⁻¹ · dR · R
const dR = joints.map(() => quat.create());
const D = joints.map(() => quat.create());
let maxReaimDeg = 0;
for (const [a, b] of Object.entries(REAIM)) {
  const i = byName.get(a), c = byName.get(b);
  const oldDir = vec3.normalize(vec3.create(), vec3.sub(vec3.create(), P[c], P[i]));
  const newDir = vec3.normalize(vec3.create(), vec3.sub(vec3.create(), newP[c], newP[i]));
  quat.rotationTo(dR[i], oldDir, newDir);
  const R = rotOf(bind[i]);
  quat.multiply(D[i], quat.invert(quat.create(), R), quat.multiply(quat.create(), dR[i], R));
  quat.normalize(D[i], D[i]);
  maxReaimDeg = Math.max(maxReaimDeg, (2 * Math.acos(Math.min(1, Math.abs(dR[i][3]))) * 180) / Math.PI);
}

// 新しいバインド世界行列: 線形部分を dR で回し、平行移動を新しい位置にする
const moved = bind.map((W, i) => {
  const M = mat4.multiply(mat4.create(), mat4.fromQuat(mat4.create(), dR[i]), W);
  M[12] = newP[i][0];
  M[13] = newP[i][1];
  M[14] = newP[i][2];
  return M;
});

// 骨ノードのローカルの位置: 親の新しいバインド世界行列の線形部分（回転 × 拡縮）の逆で戻した、親から子への差。cm（元ファイルのノードの位置と同じ単位）。
// Hips は親が Armature（骨ではない）で、元ファイルでは Hips ノードの位置は m のまま（位置アニメーションが上書きするので実際には使われない）。同じ単位のまま差分を足す
const linear = (M) => {
  const r = mat4.clone(M);
  r[12] = r[13] = r[14] = 0;
  return r;
};
const vec = (t) => [t[0], t[1], t[2]];
const qOf = (r) => quat.fromValues(r[0], r[1], r[2], r[3]);
const conj = (j) => {
  // 親の D⁻¹（親が骨でなければ I）と、自分の D
  const p = index.get(joints[j].getParentNode());
  return { dpInv: p === undefined ? quat.create() : quat.invert(quat.create(), D[p]), dj: D[j] };
};
let maxLenChange = 0;
joints.forEach((j, i) => {
  const parent = j.getParentNode();
  const pi = index.get(parent);
  if (pi === undefined) {
    const t = vec(j.getTranslation());
    const d = deltaOf(i);
    j.setTranslation([t[0] + d[0], t[1] + d[1], t[2] + d[2]]);
  } else {
    const dWorld = vec3.sub(vec3.create(), pos(moved[i]), pos(moved[pi]));
    const local = vec3.transformMat4(vec3.create(), dWorld, mat4.invert(mat4.create(), linear(moved[pi])));
    const old = vec(j.getTranslation());
    maxLenChange = Math.max(maxLenChange, Math.abs(Math.hypot(local[0], local[1], local[2]) - Math.hypot(...old)));
    j.setTranslation([local[0], local[1], local[2]]);
  }
  // 静止回転: q' = D_親⁻¹ · q · D
  const { dpInv, dj } = conj(i);
  const q = quat.multiply(quat.create(), quat.multiply(quat.create(), dpInv, qOf(j.getRotation())), dj);
  quat.normalize(q, q);
  j.setRotation([q[0], q[1], q[2], q[3]]);
});

// 逆バインド行列
const newIbm = new Float32Array(ibm.length);
moved.forEach((M, i) => newIbm.set(mat4.invert(mat4.create(), M), i * 16));
ibmAcc.setArray(newIbm);

// アニメーション: Hips の位置トラックに差分を足し、全骨の回転トラックを共役で直す
const hipsDelta = Array.from(deltaOf(byName.get('Hips')), (v) => v * 100); // cm
let shiftedPos = 0, fixedRot = 0;
const done = new Set();
for (const anim of root.listAnimations()) {
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode();
    const j = index.get(node);
    if (j === undefined) continue;
    const acc = ch.getSampler().getOutput();
    if (done.has(acc)) throw new Error('サンプラの出力が複数のチャンネルで共有されています（未対応）');
    done.add(acc);
    const path = ch.getTargetPath();
    const arr = Float32Array.from(acc.getArray());
    if (path === 'translation') {
      if (nameOf[j] !== 'Hips') throw new Error(`Hips 以外の位置アニメーションは未対応: ${nameOf[j]}`);
      for (let k = 0; k < arr.length; k += 3) {
        arr[k] += hipsDelta[0];
        arr[k + 1] += hipsDelta[1];
        arr[k + 2] += hipsDelta[2];
      }
      shiftedPos++;
    } else if (path === 'rotation') {
      const { dpInv, dj } = conj(j);
      const q = quat.create();
      for (let k = 0; k < arr.length; k += 4) {
        quat.set(q, arr[k], arr[k + 1], arr[k + 2], arr[k + 3]);
        quat.multiply(q, quat.multiply(quat.create(), dpInv, q), dj);
        quat.normalize(q, q);
        arr[k] = q[0];
        arr[k + 1] = q[1];
        arr[k + 2] = q[2];
        arr[k + 3] = q[3];
      }
      fixedRot++;
    } else if (path === 'scale') throw new Error('scale アニメーションは未対応');
    acc.setArray(arr);
  }
}
console.log(
  `骨 ${joints.length} 本のうち ${Object.keys(targets).length} 本を目標の位置へ、${Object.keys(REAIM).length} 本の向きを子へ向け直した（最大 ${maxReaimDeg.toFixed(1)}°）。` +
    `Hips の位置トラック ${shiftedPos} 本を ${hipsDelta.map((v) => v.toFixed(2)).join(',')} cm ずらし、回転トラック ${fixedRot} 本を共役で直した。骨の長さの最大の変化 ${maxLenChange.toFixed(2)} cm`,
);
await io.write(out, doc);
console.log('→', out);
