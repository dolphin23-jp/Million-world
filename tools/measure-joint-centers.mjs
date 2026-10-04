#!/usr/bin/env node
/**
 * 骨（関節）がメッシュの断面の中心を通っているかを測る（docs/05-asset-automation.md「骨の位置の補正」/ ADR-022）。バインド姿勢の GLB に対して使う。
 *
 *   node tools/measure-joint-centers.mjs <hero.glb>
 *
 * 高さごとの水平な断面を、x 方向の隙間（1.2cm 超）でクラスタに分け、胴・腕・脚の断面の中心を求める（メッシュは左右対称なので、
 * 胴の中心線 = 左右の腕・脚の断面の中心の中点になる）。腕・脚は断面の中心の列に直線をあてはめ、各関節の高さでの中心線の x を出す。
 * 出力: 体の中心線と骨の x のずれ、四肢ごとの断面の中心の列と、各関節の「いまの x → 中心線の x」。
 * tools/data/hero-joint-offsets.json（tools/recenter-skeleton.mjs の目標）の根拠。手首は断面が細く（指の曲がりで中心が内へ寄る）直線の延長が過大になるので、
 * 採用値はこの出力より手前に取ってある（左手首 +4.6 → +3.2cm、右手首は剣の握りを守るため 0）。z・y は測らない（x のずれが桁違いに大きい）。
 * 補正済みの GLB に使うと、ずれが 0 に近いことの確認になる。
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mat4 } from 'gl-matrix';

const file = process.argv[2];
if (!file) {
  console.error('使い方: node tools/measure-joint-centers.mjs <hero.glb>');
  process.exit(1);
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(file);
const root = doc.getRoot();
const skin = root.listSkins()[0];
const joints = skin.listJoints();
const ibm = skin.getInverseBindMatrices().getArray();
/** 関節名 → バインド姿勢の位置（cm） */
const JP = {};
joints.forEach((j, i) => {
  const inv = mat4.invert(mat4.create(), ibm.slice(i * 16, i * 16 + 16));
  JP[j.getName()] = [inv[12] * 100, inv[13] * 100, inv[14] * 100];
});
const prim = root.listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute('POSITION');
const pos = [];
const tmp = [0, 0, 0];
for (let i = 0; i < P.getCount(); i++) {
  P.getElement(i, tmp);
  pos.push([tmp[0] * 100, tmp[1] * 100, tmp[2] * 100]);
}
const hy = JP.Hips[1];

/** Hips からの高さ yRel（cm）の断面を、x の隙間でクラスタに分ける（頂点が 10 未満のものは捨てる） */
function clusters(yRel, half = 0.8) {
  const sel = pos.filter((p) => Math.abs(p[1] - hy - yRel) < half).sort((a, b) => a[0] - b[0]);
  const out = [];
  let cur = [];
  for (const p of sel) {
    if (cur.length && p[0] - cur[cur.length - 1][0] > 1.2) {
      out.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out.filter((c) => c.length >= 10).map((c) => ({ xmin: c[0][0], xmax: c[c.length - 1][0], zmin: Math.min(...c.map((p) => p[2])), zmax: Math.max(...c.map((p) => p[2])) }));
}
const center = (c) => ({ x: (c.xmin + c.xmax) / 2, z: (c.zmin + c.zmax) / 2 });

// 体の中心線: 胴（最も幅の広いクラスタ）の中心を、Hips の −6〜+22cm で平均する
const mids = [];
for (let y = -6; y <= 22; y += 4) {
  const widest = clusters(y).sort((a, b) => b.xmax - b.xmin - (a.xmax - a.xmin))[0];
  mids.push(center(widest).x);
}
const xMid = mids.reduce((s, v) => s + v, 0) / mids.length;
console.log(`体の中心線 x = ${xMid.toFixed(2)}cm（胴の断面の中心の平均。ばらつき ±${Math.max(...mids.map((v) => Math.abs(v - xMid))).toFixed(2)}）。Hips の骨の x = ${JP.Hips[0].toFixed(2)}（ずれ ${(JP.Hips[0] - xMid).toFixed(2)}）`);

/** 四肢の断面の中心を、y を走査して追う（side = +1 左（+x）、−1 右） */
function track(side, y0, y1, startX, step) {
  const pts = [];
  let prev = startX;
  for (let y = y0; step < 0 ? y >= y1 : y <= y1; y += step) {
    const cs = clusters(y).filter((c) => (side > 0 ? center(c).x > xMid + 2.5 : center(c).x < xMid - 2.5));
    if (!cs.length) continue;
    cs.sort((a, b) => Math.abs(center(a).x - prev) - Math.abs(center(b).x - prev));
    const c = center(cs[0]);
    pts.push({ y, x: c.x, w: cs[0].xmax - cs[0].xmin });
    prev = c.x;
  }
  return pts;
}
/** x(y) の直線近似（最小二乗） */
function fit(pts) {
  const m = pts.length;
  const sy = pts.reduce((s, p) => s + p.y, 0);
  const sx = pts.reduce((s, p) => s + p.x, 0);
  const syy = pts.reduce((s, p) => s + p.y * p.y, 0);
  const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
  const d = m * syy - sy * sy;
  const a = (m * sxy - sy * sx) / d;
  const b = (sx - a * sy) / m;
  return (y) => a * y + b;
}
const suggestion = {};
function limb(label, pts, names) {
  console.log(`\n${label}: 断面の中心（Hips からの高さ cm: x cm、幅）`);
  console.log('  ' + pts.map((p) => `${p.y}: ${p.x.toFixed(1)} (w${p.w.toFixed(0)})`).join('   '));
  const f = fit(pts);
  for (const name of names) {
    const cur = JP[name];
    const nx = f(cur[1] - hy);
    console.log(`  ${name.padEnd(13)} 高さ ${(cur[1] - hy).toFixed(1).padStart(6)}cm  x: いま ${cur[0].toFixed(1).padStart(6)} → 中心線 ${nx.toFixed(1).padStart(6)}  （差 ${(nx - cur[0]).toFixed(1)}）`);
    suggestion[name] = [Number(nx.toFixed(2)), null, null];
  }
}
for (const [lab, side, sd] of [['左', 1, 'Left'], ['右', -1, 'Right']]) {
  limb(`${lab}腕（上腕・前腕）`, track(side, 22, -4, xMid + side * 24, -4), [`${sd}Arm`, `${sd}ForeArm`, `${sd}Hand`]);
  limb(`${lab}大腿`, track(side, -26, -40, xMid + side * 11, -4), [`${sd}UpLeg`, `${sd}Leg`]);
  limb(`${lab}すね`, track(side, -50, -90, xMid + side * 14, -5), [`${sd}Foot`, `${sd}ToeBase`]);
}
console.log('\n胴・頭・鎖骨の骨は x = 体の中心線へ（鎖骨・頭の先の骨は親からの相対位置を保つ）:');
for (const name of ['Hips', 'Spine02', 'Spine01', 'Spine', 'neck']) {
  console.log(`  ${name.padEnd(13)} x: いま ${JP[name][0].toFixed(1).padStart(6)} → ${xMid.toFixed(1)}  （差 ${(xMid - JP[name][0]).toFixed(1)}）`);
  suggestion[name] = [Number(xMid.toFixed(2)), null, null];
}
console.log('\n提案（targetCm の形。手首・頭・鎖骨は上の注意のとおり手で調整する）:');
console.log(JSON.stringify(suggestion));
