#!/usr/bin/env node
/**
 * キャラクター資産の取り込み（docs/03-asset-pipeline.md, docs/05-asset-automation.md）。
 *
 * 複数の「同一リグ + クリップ 1 本」GLB（Meshy の 3d_rigging 出力）を 1 つの GLB に結合し、
 * ゲームで使える形に正規化する。
 *
 *   node tools/build-character.mjs raw/hero.manifest.json
 *
 * manifest:
 * {
 *   "out": "public/assets/characters/hero.glb",
 *   "textureSize": 2048,            // 省略時 1024
 *   "clips": {                       // name: { file, loop?, keepRootMotion? }
 *     "idle":  { "file": "raw/clips/hero-idle.glb" },
 *     "run":   { "file": "raw/clips/hero-run.glb" },
 *     ...
 *   }
 * }
 *
 * 行うこと:
 *  1. 最初のクリップの GLB を土台にし、他の GLB からアニメーションだけをボーン名で写す
 *     （骨格が一致するか IBM と rest 変換で検証し、違えば中断する）
 *  2. Hips の並進から XZ を除去（ルートモーション除去。keepRootMotion:true で保持）
 *  3. 不要な頂点属性（TANGENT）・重複を削除、キーフレームを再サンプル
 *  4. テクスチャを WebP にし、指定サイズへ縮小
 *  5. meshopt で圧縮して出力。統計を表示
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { NodeIO, Accessor } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { mat4, quat, vec3 } from 'gl-matrix';

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('使い方: node tools/build-character.mjs <manifest.json>');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const clipEntries = Object.entries(manifest.clips);
if (clipEntries.length === 0) throw new Error('clips が空です');

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

// ---------- 1. 土台を読む ----------
const [baseName, baseSpec] = clipEntries[0];
const doc = await io.read(resolve(baseSpec.file));
const root = doc.getRoot();
const targetRig = readRig(doc);
if (!targetRig) throw new Error('土台にスキンがありません');
// 出力の骨格は「バインド姿勢のオフセット + 回転アニメ」に固定する（ボーン伸縮の並進アニメは持ち込まない）
for (const [, e] of targetRig.info) {
  if (e.bindLocalTrans) e.node.setTranslation(e.bindLocalTrans);
  e.node.setScale([1, 1, 1]);
}

// 土台のクリップは参照だけ残し、出力からは外す（全クリップを同じ経路で作り直す）
const baseAnimBackup = root.listAnimations()[0];
if (!baseAnimBackup) throw new Error('土台にクリップがありません');

// ---------- 2. 各クリップを土台の骨格へリターゲットして写す ----------
// Meshy の自動リグはジョブごとに微妙に違う（位置 <0.5cm だが、手・肩・足のロールが数十度違う）。
// ローカル回転をそのまま写すと手足が捻れるので、各ボーンの「バインド姿勢からの世界回転の変化量」を写す。
for (const [name, spec] of clipEntries) {
  const src = name === baseName ? doc : await io.read(resolve(spec.file));
  const srcRig = readRig(src);
  const diff = compareJointNames(targetRig, srcRig);
  if (diff) throw new Error(`骨格が一致しません (${name}): ${diff}`);
  const anims = src.getRoot().listAnimations();
  const srcAnim = name === baseName ? baseAnimBackup : anims[0];
  if (!srcAnim) throw new Error(`${name}: クリップがありません`);
  retargetClip(srcAnim, srcRig, targetRig, name, spec);
}

baseAnimBackup.dispose();

// ---------- 3〜5. 最適化と出力 ----------
const texSize = manifest.textureSize ?? 1024;
const check = (label) => () => console.log(`[${label}] skins=${root.listSkins().length} anims=${root.listAnimations().length}`);
await doc.transform(
  dedup(),
  check('dedup'),
  resample({ tolerance: 1e-4 }),
  check('resample'),
  prune({ keepAttributes: false, keepLeaves: true }),
  check('prune'),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 88, resize: [texSize, texSize] }),
  check('texture'),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  check('meshopt'),
);

const outPath = resolve(manifest.out);
mkdirSync(dirname(outPath), { recursive: true });
await io.write(outPath, doc);

// 統計
const glb = await io.writeBinary(doc);
let tris = 0;
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
console.log(
  JSON.stringify(
    {
      out: manifest.out,
      bytes: glb.byteLength,
      triangles: tris,
      textures: root.listTextures().map((t) => `${t.getMimeType()} ${t.getSize()?.join('x')}`),
      clips: root.listAnimations().map((a) => `${a.getName()} ${animDuration(a).toFixed(2)}s`),
      joints: root.listSkins()[0]?.listJoints().length ?? 0,
    },
    null,
    2,
  ),
);

// ===================== helpers =====================

function animDuration(anim) {
  let max = 0;
  for (const s of anim.listSamplers()) {
    const t = s.getInput().getMax([])[0];
    if (t > max) max = t;
  }
  return max;
}

/** リグ情報: ジョイント名の順序、親子、バインド姿勢の世界回転（IBM の逆行列から）、rest 変換 */
function readRig(d) {
  const skin = d.getRoot().listSkins()[0];
  if (!skin) return null;
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices().getArray();
  const info = new Map();
  const jointSet = new Set(joints);
  joints.forEach((j, i) => {
    const inv = mat4.invert(mat4.create(), ibm.slice(i * 16, i * 16 + 16));
    let bindRot = null;
    if (inv) {
      const r = mat4.getRotation(quat.create(), inv);
      if (Number.isFinite(r[0]) && Number.isFinite(r[3])) bindRot = quat.normalize(r, r);
    }
    info.set(j.getName(), { node: j, parent: null, bindRot, bindWorld: inv, restRot: quat.clone(j.getRotation()), restTrans: vec3.clone(j.getTranslation()), bindLocalTrans: null });
  });
  for (const j of joints) for (const c of j.listChildren()) if (jointSet.has(c)) info.get(c.getName()).parent = j.getName();
  // バインド姿勢でのローカル並進（ボーンのオフセット）。元の node 並進はエクスポート時のポーズなので信用しない
  for (const [name, e] of info) {
    if (!e.bindWorld) continue;
    const p = e.parent ? info.get(e.parent) : null;
    let local = e.bindWorld;
    if (p && p.bindWorld) {
      const invP = mat4.invert(mat4.create(), p.bindWorld);
      local = mat4.multiply(mat4.create(), invP, e.bindWorld);
    }
    e.bindLocalTrans = mat4.getTranslation(vec3.create(), local);
  }
  // 親が先に来る順序
  const order = [];
  const visit = (n) => { const e = info.get(n); if (e.parent && !order.includes(e.parent)) visit(e.parent); if (!order.includes(n)) order.push(n); };
  for (const j of joints) visit(j.getName());
  return { order, info };
}

function compareJointNames(a, b) {
  if (!a || !b) return 'スキンがない';
  const ka = a.order.join('|'), kb = b.order.join('|');
  if (ka !== kb) return `ジョイントが違う: ${a.order.length} vs ${b.order.length}`;
  return null;
}

/** チャンネルのサンプラ（線形補間。回転は slerp） */
function makeSampler(channel) {
  const s = channel.getSampler();
  const times = s.getInput().getArray();
  const values = s.getOutput().getArray();
  const size = s.getOutput().getElementSize();
  const n = times.length;
  const isQuat = size === 4;
  const a = isQuat ? quat.create() : vec3.create();
  const b = isQuat ? quat.create() : vec3.create();
  return {
    times,
    sample(t, out) {
      if (t <= times[0]) { for (let k = 0; k < size; k++) out[k] = values[k]; return out; }
      if (t >= times[n - 1]) { for (let k = 0; k < size; k++) out[k] = values[(n - 1) * size + k]; return out; }
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
      const u = (t - times[lo]) / (times[hi] - times[lo]);
      for (let k = 0; k < size; k++) { a[k] = values[lo * size + k]; b[k] = values[hi * size + k]; }
      if (isQuat) quat.slerp(out, a, b, u); else vec3.lerp(out, a, b, u);
      return out;
    },
  };
}

/** バインド姿勢でのローカル回転 inv(Bparent) * Bself */
function bindLocalRot(rig, name) {
  const e = rig.info.get(name);
  const p = e.parent ? rig.info.get(e.parent) : null;
  if (!p || !p.bindRot) return quat.clone(e.bindRot);
  const inv = quat.invert(quat.create(), p.bindRot);
  return quat.multiply(quat.create(), inv, e.bindRot);
}

function retargetClip(srcAnim, srcRig, dstRig, name, spec) {
  const frozen = new Set(manifest.freezeBones ?? []);
  // ボーンごとの回転チャンネルと Hips の並進チャンネルを集める
  const rotCh = new Map();
  let hipsTrans = null;
  for (const ch of srcAnim.listChannels()) {
    const nodeName = ch.getTargetNode()?.getName();
    if (!nodeName || !srcRig.info.has(nodeName)) continue;
    if (ch.getTargetPath() === 'rotation') rotCh.set(nodeName, makeSampler(ch));
    else if (ch.getTargetPath() === 'translation' && nodeName === 'Hips') hipsTrans = makeSampler(ch);
  }
  // キー時刻: 全回転チャンネルの和集合
  const tset = new Set();
  for (const smp of rotCh.values()) for (const t of smp.times) tset.add(Math.round(t * 1e5) / 1e5);
  if (hipsTrans) for (const t of hipsTrans.times) tset.add(Math.round(t * 1e5) / 1e5);
  const times = Float32Array.from([...tset].sort((x, y) => x - y));
  const n = times.length;

  const order = dstRig.order;
  const outRot = new Map(order.map((b) => [b, new Float32Array(n * 4)]));
  const outTrans = hipsTrans ? new Float32Array(n * 3) : null;
  const Ws = new Map(), Wt = new Map();
  const tmpL = quat.create(), tmpD = quat.create(), tmpInv = quat.create(), tmpW = quat.create(), tmpLt = quat.create(), tmpT = vec3.create();
  const prev = new Map(order.map((b) => [b, null]));

  for (let i = 0; i < n; i++) {
    const t = times[i];
    for (const b of order) {
      const si = srcRig.info.get(b), di = dstRig.info.get(b);
      const smp = rotCh.get(b);
      if (smp) smp.sample(t, tmpL); else quat.copy(tmpL, si.restRot);
      // 元リグの世界回転
      const ws = Ws.get(b) ?? quat.create();
      if (si.parent) quat.multiply(ws, Ws.get(si.parent), tmpL); else quat.copy(ws, tmpL);
      Ws.set(b, ws);
      // 先リグの世界回転: delta = Ws * inv(Bs), Wt = delta * Bt
      const wt = Wt.get(b) ?? quat.create();
      if (si.bindRot && di.bindRot) {
        quat.invert(tmpInv, si.bindRot);
        quat.multiply(tmpD, ws, tmpInv);
        quat.multiply(wt, tmpD, di.bindRot);
      } else if (di.parent) {
        quat.multiply(wt, Wt.get(di.parent), tmpL);
      } else quat.copy(wt, tmpL);
      Wt.set(b, wt);
      // 凍結ボーン（つま先など、リグのボーン長が異常で回すと皮膚が伸びるもの）はバインド姿勢に固定する
      if (frozen.has(b) && di.bindRot) {
        if (di.parent) quat.copy(wt, Wt.get(di.parent)), quat.multiply(wt, wt, bindLocalRot(dstRig, b)); else quat.copy(wt, di.bindRot);
        Wt.set(b, wt);
      }
      // ローカルへ
      if (di.parent) { quat.invert(tmpInv, Wt.get(di.parent)); quat.multiply(tmpLt, tmpInv, wt); } else quat.copy(tmpLt, wt);
      quat.normalize(tmpLt, tmpLt);
      // 符号の連続性
      const p = prev.get(b);
      if (p && quat.dot(p, tmpLt) < 0) quat.scale(tmpLt, tmpLt, -1);
      prev.set(b, quat.clone(tmpLt));
      const arr = outRot.get(b);
      arr[i * 4] = tmpLt[0]; arr[i * 4 + 1] = tmpLt[1]; arr[i * 4 + 2] = tmpLt[2]; arr[i * 4 + 3] = tmpLt[3];
    }
    if (hipsTrans) { hipsTrans.sample(t, tmpT); outTrans[i * 3] = tmpT[0]; outTrans[i * 3 + 1] = tmpT[1]; outTrans[i * 3 + 2] = tmpT[2]; }
  }

  // ルートモーション除去: Hips の XZ を先頭に固定
  if (outTrans && !spec.keepRootMotion) {
    const x0 = outTrans[0], z0 = outTrans[2];
    for (let i = 0; i < n; i++) { outTrans[i * 3] = x0; outTrans[i * 3 + 2] = z0; }
  }

  const dst = doc.createAnimation(name);
  const input = doc.createAccessor(`${name}_t`).setType(Accessor.Type.SCALAR).setArray(times);
  for (const b of order) {
    const output = doc.createAccessor(`${name}_${b}_r`).setType(Accessor.Type.VEC4).setArray(outRot.get(b));
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    const channel = doc.createAnimationChannel().setTargetNode(dstRig.info.get(b).node).setTargetPath('rotation').setSampler(sampler);
    dst.addSampler(sampler).addChannel(channel);
  }
  if (outTrans) {
    const output = doc.createAccessor(`${name}_Hips_p`).setType(Accessor.Type.VEC3).setArray(outTrans);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    const channel = doc.createAnimationChannel().setTargetNode(dstRig.info.get('Hips').node).setTargetPath('translation').setSampler(sampler);
    dst.addSampler(sampler).addChannel(channel);
  }
}
