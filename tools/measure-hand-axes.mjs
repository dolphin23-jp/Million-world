#!/usr/bin/env node
/**
 * 両手のメッシュの座標系（指の向き f・親指側 t・手の甲側 d）と中心を、頂点の主成分分析で求める（HERO.handFrames の元。ADR-023）。
 *
 *   node tools/measure-hand-axes.mjs <hero.glb>
 *
 * 手ボーンの重みが 0.5 を超える頂点を、手ボーンのローカル空間（cm）へ戻して分散の大きい順に 3 軸を取る
 * （f = 最大分散 = 指の向き、t = 親指側、d = 手の甲側。符号: f は手首（ボーンの原点）から手の中心へ向く側、
 *  右手の t は HERO.hand.right.t に合わせ、左手は右手の鏡像（ボーンのバインド姿勢の世界回転と x の反転で写した向き）に近い側を取る。
 *  d は右手 = f × t、左手 = −f × t（鏡像は手系が逆）。手の甲側が d）。
 * 手のメッシュは左右の鏡像だが完全ではない（左手の指の向きは、右手を骨の向きで鏡に写したものから約 20° 違う）ので、
 * 両手持ちの左手の握り（src/character/mirror-grip.ts）は、骨の向きではなくこの座標系に対して右手の握りを写して作る。
 * 出力は HERO.handFrames に貼る形（m でなく cm のまま。コード側で 0.01 倍する）。
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mat4, vec3, quat } from 'gl-matrix';

const file = process.argv[2] ?? 'public/assets/characters/hero.glb';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(file);
const root = doc.getRoot();
const skin = root.listSkins()[0];
const joints = skin.listJoints();
const ibm = skin.getInverseBindMatrices().getArray();
const prim = root.listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute('POSITION');
const J = prim.getAttribute('JOINTS_0');
const W = prim.getAttribute('WEIGHTS_0');
const idx = (n) => joints.findIndex((j) => j.getName() === n);
const bindWorld = (i) => mat4.invert(mat4.create(), ibm.slice(i * 16, i * 16 + 16));

function handPoints(name) {
  const i = idx(name);
  const m = ibm.slice(i * 16, i * 16 + 16);
  const pts = [];
  const p = [0, 0, 0], j = [0, 0, 0, 0], w = [0, 0, 0, 0];
  for (let v = 0; v < P.getCount(); v++) {
    P.getElement(v, p);
    J.getElement(v, j);
    W.getElement(v, w);
    let s = 0;
    for (let k = 0; k < 4; k++) if (j[k] === i) s += w[k];
    if (s > 0.5) pts.push(vec3.transformMat4(vec3.create(), p, m)); // 手ボーンのローカル（cm）
  }
  return pts;
}

/** 3x3 対称行列の固有分解（Jacobi 法）。固有値の大きい順に [値, ベクトル] */
function eigenSym(A) {
  const a = A.map((r) => r.slice());
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-14) continue;
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
        for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
        for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
      }
    }
  }
  return [0, 1, 2].map((i) => [a[i][i], [V[0][i], V[1][i], V[2][i]]]).sort((x, y) => y[0] - x[0]);
}

function pca(pts) {
  const n = pts.length;
  const c = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) c[k] += p[k] / n;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += ((p[a] - c[a]) * (p[b] - c[b])) / n;
  const e = eigenSym(C);
  return { n, center: c, axes: e.map(([, v]) => vec3.normalize(vec3.create(), v)), sigma: e.map(([l]) => Math.sqrt(l)) };
}

const rot = (M) => mat4.getRotation(quat.create(), M);
const rb = rot(bindWorld(idx('RightHand')));
const lb = rot(bindWorld(idx('LeftHand')));
const lbInv = quat.invert(quat.create(), lb);
/** 右手ボーンのローカルのベクトルを、左右の鏡（x の反転）を通して左手ボーンのローカルへ（骨の向きだけを使った写し。符号の判定用） */
const mirrorByBone = (v) => {
  const w = vec3.transformQuat(vec3.create(), v, rb);
  w[0] = -w[0];
  return vec3.transformQuat(vec3.create(), w, lbInv);
};

const right = pca(handPoints('RightHand'));
const left = pca(handPoints('LeftHand'));
const HERO_RIGHT = { f: [0.2109, 0.9277, -0.3079], t: [-0.6494, 0.3682, 0.6654], d: [0.7307, 0.0596, 0.6801] };
const toward = (v, ref) => (vec3.dot(v, ref) < 0 ? vec3.negate(vec3.create(), v) : v);
const cross = (a, b) => vec3.cross(vec3.create(), a, b);
const neg = (v) => vec3.negate(vec3.create(), v);

// 右手: f = 最大分散の軸（手首 → 中心の側）、t は HERO.hand.right.t に近い側、d = f × t
const fR = toward(right.axes[0], right.center);
const tR = toward(right.axes[1], HERO_RIGHT.t);
const dR = cross(fR, tR);
// 左手: f は手首 → 中心の側、t は右手の t の鏡像（骨で写したもの）に近い側、d = −f × t（手の甲側）
const fL = toward(left.axes[0], left.center);
const tL = toward(left.axes[1], mirrorByBone(tR));
const dL = neg(cross(fL, tL));

const ang = (a, b) => (Math.acos(Math.max(-1, Math.min(1, vec3.dot(a, b)))) * 180) / Math.PI;
const fmt = (v) => `[${[...v].map((x) => x.toFixed(4)).join(', ')}]`;
console.error(`頂点数 右 ${right.n} / 左 ${left.n}、分散の平方根（cm）右 ${right.sigma.map((x) => x.toFixed(2)).join('/')} 左 ${left.sigma.map((x) => x.toFixed(2)).join('/')}`);
console.error(`右手の軸と HERO.hand.right のずれ: f ${ang(fR, HERO_RIGHT.f).toFixed(1)}° t ${ang(tR, HERO_RIGHT.t).toFixed(1)}° d ${ang(dR, HERO_RIGHT.d).toFixed(1)}°`);
console.error(`左手の軸と、右手を骨の向きで写したもののずれ: f ${ang(fL, mirrorByBone(fR)).toFixed(1)}° t ${ang(tL, mirrorByBone(tR)).toFixed(1)}° d ${ang(dL, mirrorByBone(dR)).toFixed(1)}°（0 でなければ左右のメッシュの手の形が違う）`);
console.log(`  handFrames: {
    // tools/measure-hand-axes.mjs の出力（手ボーンのローカル。center は cm。指の向き f・親指側 t・手の甲側 d）
    right: { center: ${fmt(right.center)}, f: ${fmt(fR)}, t: ${fmt(tR)}, d: ${fmt(dR)} },
    left: { center: ${fmt(left.center)}, f: ${fmt(fL)}, t: ${fmt(tL)}, d: ${fmt(dL)} },
  },`);
