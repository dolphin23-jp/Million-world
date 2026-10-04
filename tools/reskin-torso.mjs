#!/usr/bin/env node
/**
 * 胴（骨盤〜胸）のスキンウェイトを位置から作り直して GLB に書き戻す（docs/05-asset-automation.md「腰まわりの再スキン」/ ADR-022）。
 * 腕・頭・髪・膝から下の重みは元のまま。アニメーション・テクスチャ・メッシュには触らない。
 *
 *   node tools/reskin-torso.mjs <in.glb> <out.glb> [--set y0=0.085 --set armRadius=0.075,0.11 …]
 *
 * アルゴリズムとパラメータは tools/lib/torso-weights.mjs。入力は「元の重み」（Meshy の自動リグ → tools/smooth-weights.mjs の出力を結合した
 * public/assets/characters/hero.glb の最初の版）を使うこと。作り直した結果をもう一度かけても、胴の重みは位置だけで決まるのでほぼ同じになるが、
 * 腕との境目（元の重みを混ぜる帯）だけは元の重みを使うので、混ぜ具合が変わる。
 *
 * build-character.mjs を raw から通し直すときは、その出力にこのツールをかける（raw は git に入っていないので、今は hero.glb を直接処理している）。
 */
import { readFileSync } from 'node:fs';
import { NodeIO, Accessor } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mat4 } from 'gl-matrix';
import { DEFAULTS, reskinTorso } from './lib/torso-weights.mjs';

const args = process.argv.slice(2);
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--set');
const [inp, out] = files;
if (!inp || !out) {
  console.error('使い方: node tools/reskin-torso.mjs <in.glb> <out.glb> [--set name=値 …]');
  process.exit(1);
}
const params = {};
args.forEach((a, i) => {
  if (a !== '--set') return;
  const [k, v] = args[i + 1].split('=');
  if (!(k in DEFAULTS)) throw new Error(`パラメータがありません: ${k}（${Object.keys(DEFAULTS).join(', ')}）`);
  params[k] = v.includes(',') ? v.split(',').map(Number) : Number(v);
});

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
const root = doc.getRoot();
const skin = root.listSkins()[0];
if (!skin) throw new Error('スキンがありません');
const joints = skin.listJoints();
const names = joints.map((j) => j.getName());
const ibm = skin.getInverseBindMatrices().getArray();
const jointPos = {};
joints.forEach((j, i) => {
  const inv = mat4.invert(mat4.create(), ibm.slice(i * 16, i * 16 + 16));
  jointPos[j.getName()] = [inv[12], inv[13], inv[14]];
});

let total = 0;
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0'), P = prim.getAttribute('POSITION');
    if (!J || !W) continue;
    const n = P.getCount();
    const pos = new Float32Array(n * 3);
    const tmp = [0, 0, 0];
    for (let i = 0; i < n; i++) { P.getElement(i, tmp); pos.set(tmp, i * 3); }
    const j4 = new Uint16Array(n * 4), w4 = new Float32Array(n * 4);
    const a4 = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) { J.getElement(i, a4); j4.set(a4, i * 4); W.getElement(i, a4); w4.set(a4, i * 4); }
    const r = reskinTorso({ pos, joints: j4, weights: w4, names, jointPos }, params);
    prim.setAttribute('JOINTS_0', doc.createAccessor('JOINTS_0').setType(Accessor.Type.VEC4).setArray(r.joints));
    prim.setAttribute('WEIGHTS_0', doc.createAccessor('WEIGHTS_0').setType(Accessor.Type.VEC4).setArray(r.weights));
    // 置き換えた古いアクセサを残すと、ファイルに二重に書き出される（+1.1MB）。ほかから使われていなければ捨てる
    for (const old of [J, W]) if (old.listParents().filter((x) => x.propertyType !== 'Root').length === 0) old.dispose();
    console.log(`${mesh.getName() || 'mesh'}: 頂点 ${n}（位置グループ ${r.stats.groups}）、重みを変えたグループ ${r.stats.changed}（うち全面的に作り直し ${r.stats.replaced}）`);
    total += r.stats.changed;
  }
}
if (total === 0) throw new Error('重みが 1 つも変わっていません（骨の名前・座標系を確認）');
await io.write(out, doc);
console.log('→', out, readFileSync(out).length, 'bytes');
