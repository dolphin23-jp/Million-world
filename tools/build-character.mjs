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
 *   "base": "raw/heroine/base.glb",   // 省略可: メッシュ＋スキンの土台（ウェイト平滑化済み等）
 *   "freezeBones": ["LeftToeBase", "RightToeBase"],   // 省略可: バインド姿勢に固定するボーン
 *   "groundBones": [...], "groundMargin": 0,         // 省略可: 接地補正に使うボーンと余白(m)
 *   "footPitchDeg": 16,             // 省略可: 足・つま先を「つま先を下げる向き」へ回す量(度)。配信元クリップの足の姿勢は
 *                                   //   全クリップで 15〜24° つま先が上がる（docs/05「足の接地」）。その系統的なずれを打ち消す
 *   "headPitchDeg": 0,              // 省略可: 頭を「上を向く向き」へ回す量(度)。クリップごとに上書きできる（例: 待機は 18° うつむくので 16）
 *   "textureSize": 2048,            // 省略時 1024
 *   "clips": {                       // name: { file, loop?, keepRootMotion?, footPitchDeg?, headPitchDeg? }  どちらもそのクリップだけ上書き
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
 *  5. 出力して統計を表示（圧縮はしない。位置の量子化は検査と実機切り分けの妨げになる）
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { NodeIO, Accessor } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress } from '@gltf-transform/functions';
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

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// ---------- 1. 土台を読む ----------
// manifest.base があればそれをメッシュ＋スキンの土台にする（例: Blender でウェイトを平滑化したファイル）。
// 無ければ最初のクリップのファイルが土台になる
const [baseName, baseSpec] = clipEntries[0];
const baseFile = manifest.base ?? baseSpec.file;
const doc = await io.read(resolve(baseFile));
const root = doc.getRoot();
const targetRig = readRig(doc);
if (!targetRig) throw new Error('土台にスキンがありません');
// スキンウェイトの掃除（任意、既定は無効）: 支配ボーンから骨格グラフ上で遠いボーンの影響を落とす。
// 試した限りでは隣接頂点との不連続を生んで悪化したので、manifest.weightMaxHops を明示したときだけ使う
if (manifest.weightMaxHops) cleanupWeights(doc, targetRig, manifest.weightMaxHops);

// テクスチャの差し替え: リグ工程に渡したのが縮小版でも、元の高解像度テクスチャ（同じ UV）を最終出力に使う
// textureFrom は GLB（その 1 枚目のテクスチャ）か、PNG/JPEG/WebP の画像ファイル（tools/clean-texture.py の出力など）
if (manifest.textureFrom) {
  const dstTex = root.listTextures()[0];
  if (/\.(png|jpe?g|webp)$/i.test(manifest.textureFrom)) {
    const ext = manifest.textureFrom.split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    if (dstTex) {
      dstTex.setImage(new Uint8Array(readFileSync(resolve(manifest.textureFrom)))).setMimeType(mime);
      console.log(`[texture] ${manifest.textureFrom} に差し替え`);
    }
  } else {
    const texDoc = await io.read(resolve(manifest.textureFrom));
    const srcTex = texDoc.getRoot().listTextures()[0];
    if (srcTex && dstTex) {
      dstTex.setImage(srcTex.getImage()).setMimeType(srcTex.getMimeType());
      console.log(`[texture] ${manifest.textureFrom} の ${srcTex.getSize()?.join('x')} テクスチャに差し替え`);
    }
  }
}

// 出力の骨格は「バインド姿勢のオフセット + 回転アニメ」に固定する（ボーン伸縮の並進アニメは持ち込まない）
for (const [, e] of targetRig.info) {
  if (e.bindLocalTrans) e.node.setTranslation(e.bindLocalTrans);
  e.node.setScale([1, 1, 1]);
}

// 土台にクリップが入っていれば参照だけ残し、出力からは外す（全クリップを同じ経路で作り直す）
const baseAnimBackup = root.listAnimations()[0] ?? null;

// 足裏の代表点（接地補正用）。メッシュの足裏の頂点を、支配ボーンのローカル座標で持っておく。
// ジョイントの高さだけでは靴底が床にめり込むのを検出できない（靴底はジョイントの 16cm 下）
const soleProbes = buildSoleProbes(doc, targetRig);
console.log(soleProbes ? `[sole] 足裏の接地点 ${soleProbes.length} 個` : '[sole] 足裏の接地点を作れないのでジョイントで接地補正する');

// ---------- 2. 各クリップを土台の骨格へリターゲットして写す ----------
// Meshy の自動リグはジョブごとに微妙に違う（位置 <0.5cm だが、手・肩・足のロールが数十度違う）。
// ローカル回転をそのまま写すと手足が捻れるので、各ボーンの「バインド姿勢からの世界回転の変化量」を写す。
for (const [name, spec] of clipEntries) {
  const sameAsBase = resolve(spec.file) === resolve(baseFile) && baseAnimBackup;
  const src = sameAsBase ? doc : await io.read(resolve(spec.file));
  const srcRig = readRig(src);
  const diff = compareJointNames(targetRig, srcRig);
  if (diff) throw new Error(`骨格が一致しません (${name}): ${diff}`);
  const anims = src.getRoot().listAnimations();
  const srcAnim = sameAsBase ? baseAnimBackup : anims[0];
  if (!srcAnim) throw new Error(`${name}: クリップがありません`);
  retargetClip(srcAnim, srcRig, targetRig, name, spec);
}

if (baseAnimBackup) baseAnimBackup.dispose();

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
  // meshopt/quantize は使わない: 位置が量子化されると IBM に逆変換が畳み込まれ、検査ツールや
  // 実機での切り分けが難しくなる。サイズより単純さを優先する（ADR-010 の方針）
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
  const ka = [...a.order].sort().join('|'), kb = [...b.order].sort().join('|');
  if (ka !== kb) {
    const onlyA = a.order.filter((n) => !b.order.includes(n)), onlyB = b.order.filter((n) => !a.order.includes(n));
    return `ジョイントが違う: 土台のみ ${onlyA.join(',')} / クリップのみ ${onlyB.join(',')}`;
  }
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

/** 支配ボーンから maxHops より遠いボーンの影響を落として正規化する */
function cleanupWeights(d, rig, maxHops) {
  const skin = d.getRoot().listSkins()[0];
  const joints = skin.listJoints();
  const nameOf = joints.map((j) => j.getName());
  // 隣接（親子）
  const adj = new Map(nameOf.map((n) => [n, new Set()]));
  for (const n of nameOf) { const p = rig.info.get(n)?.parent; if (p && adj.has(p)) { adj.get(n).add(p); adj.get(p).add(n); } }
  const hops = new Map();
  for (const a of nameOf) {
    const dist = new Map([[a, 0]]); const q = [a];
    while (q.length) { const x = q.shift(); for (const y of adj.get(x)) if (!dist.has(y)) { dist.set(y, dist.get(x) + 1); q.push(y); } }
    hops.set(a, dist);
  }
  let changed = 0, total = 0;
  for (const mesh of d.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
    if (!J || !W) continue;
    const j = [0, 0, 0, 0], w = [0, 0, 0, 0];
    const n = W.getCount();
    const Warr = W.getArray().slice();
    for (let i = 0; i < n; i++) {
      J.getElement(i, j); W.getElement(i, w);
      let dom = 0; for (let k = 1; k < 4; k++) if (w[k] > w[dom]) dom = k;
      const domName = nameOf[j[dom]];
      let sum = 0, touched = false;
      for (let k = 0; k < 4; k++) {
        if (w[k] <= 0) continue;
        const h = hops.get(domName)?.get(nameOf[j[k]]);
        if (h !== undefined && h > maxHops) { w[k] = 0; touched = true; }
        sum += w[k];
      }
      total++;
      if (touched) { changed++; for (let k = 0; k < 4; k++) Warr[i * 4 + k] = sum > 0 ? w[k] / sum : (k === dom ? 1 : 0); }
    }
    W.setArray(Warr);
  }
  console.log(`[weights] 遠いボーンの影響を除去: ${changed}/${total} 頂点`);
}

/** ジョイント階層の根の親（Armature）のスケール。ジョイントのローカル単位 → world の係数 */
function rootScaleOf(rig) {
  const rootName = rig.order[0];
  const rootNode = rig.info.get(rootName).node;
  const parent = rootNode.listParents().find((p) => p.propertyType === 'Node');
  return parent ? parent.getScale()[1] : 1;
}

/** フレーム i の全ボーンの world 行列（Hips の並進は outTrans、他はバインドのオフセット） */
function fkWorld(rig, outRot, outTrans, i) {
  const world = new Map();
  const q = quat.create(), tv = vec3.create();
  const rootName = rig.order[0];
  const rootNode = rig.info.get(rootName).node;
  const parent = rootNode.listParents().find((p) => p.propertyType === 'Node');
  const base = parent ? mat4.fromRotationTranslationScale(mat4.create(), parent.getRotation(), parent.getTranslation(), parent.getScale()) : mat4.create();
  for (const b of rig.order) {
    const e = rig.info.get(b);
    const r = outRot.get(b);
    quat.set(q, r[i * 4], r[i * 4 + 1], r[i * 4 + 2], r[i * 4 + 3]);
    if (b === 'Hips' && outTrans) vec3.set(tv, outTrans[i * 3], outTrans[i * 3 + 1], outTrans[i * 3 + 2]);
    else vec3.copy(tv, e.node.getTranslation());
    const local = mat4.fromRotationTranslation(mat4.create(), q, tv);
    world.set(b, mat4.multiply(mat4.create(), e.parent ? world.get(e.parent) : base, local));
  }
  return world;
}

/** フレーム i の world 空間で、指定ボーンのうち最も低い y（m） */
function lowestJointY(rig, outRot, outTrans, i, bones) {
  const world = fkWorld(rig, outRot, outTrans, i);
  let minY = Infinity;
  for (const b of bones) { const y = world.get(b)[13]; if (y < minY) minY = y; }
  return minY;
}

/** フレーム i の足裏の最低高さ（m）。probes は buildSoleProbes の結果 */
function lowestSoleY(rig, outRot, outTrans, i, probes) {
  const world = fkWorld(rig, outRot, outTrans, i);
  let minY = Infinity;
  for (const pr of probes) {
    const m = world.get(pr.bone);
    const y = m[1] * pr.p[0] + m[5] * pr.p[1] + m[9] * pr.p[2] + m[13];
    if (y < minY) minY = y;
  }
  return minY;
}

/**
 * 足裏の頂点（足・つま先ボーンが支配的で、バインド姿勢の高さが最低点から 2cm 以内）を、支配ボーンのローカル座標で返す。
 * 返り値 { length, ... } は配列（各要素 { bone, p:[x,y,z] }）。作れなければ null
 */
function buildSoleProbes(d, rig) {
  const skin = d.getRoot().listSkins()[0];
  const prim = d.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).find((p) => p.getAttribute('JOINTS_0'));
  if (!skin || !prim) return null;
  const names = skin.listJoints().map((j) => j.getName());
  const P = prim.getAttribute('POSITION'), J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
  const feet = new Map([['LeftFoot', 'L'], ['LeftToeBase', 'L'], ['RightFoot', 'R'], ['RightToeBase', 'R']]);
  const v = [0, 0, 0], j = [0, 0, 0, 0], w = [0, 0, 0, 0];
  const cand = { L: [], R: [] };
  for (let i = 0; i < P.getCount(); i++) {
    J.getElement(i, j); W.getElement(i, w);
    let dom = 0; for (let k = 1; k < 4; k++) if (w[k] > w[dom]) dom = k;
    const bone = names[j[dom]];
    const side = feet.get(bone);
    if (!side) continue;
    P.getElement(i, v);
    cand[side].push({ bone, p: [v[0], v[1], v[2]] });
  }
  const out = [];
  for (const side of ['L', 'R']) {
    const c = cand[side];
    if (c.length === 0) return null;
    let minY = Infinity; for (const x of c) minY = Math.min(minY, x.p[1]);
    for (const x of c) {
      if (x.p[1] >= minY + 0.02) continue;
      const e = rig.info.get(x.bone);
      if (!e.bindWorld) return null;
      const ibm = mat4.invert(mat4.create(), e.bindWorld);
      const l = vec3.transformMat4(vec3.create(), x.p, ibm);
      out.push({ bone: x.bone, p: [l[0], l[1], l[2]] });
    }
  }
  return out.length ? out : null;
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
  // バインド姿勢の横軸（世界 +X）まわりの回転量（ラジアン）。正 = 前方が下を向く向き
  const footPitchRad = (((spec.footPitchDeg ?? manifest.footPitchDeg) ?? 0) * Math.PI) / 180;
  const headPitchRad = (((spec.headPitchDeg ?? manifest.headPitchDeg) ?? 0) * Math.PI) / 180;
  const footBones = new Set(manifest.footBones ?? ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']);
  const headBones = new Set(manifest.headBones ?? ['Head', 'head_end', 'headfront']);
  const biasOf = (b) => (footBones.has(b) ? footPitchRad : headBones.has(b) ? -headPitchRad : 0); // 頭は「上を向く」を正にするので符号を反転
  const tmpAxis = vec3.create(), tmpBias = quat.create();

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
      // 足・頭の姿勢の補正: バインド姿勢の横軸（世界 +X）まわりに回す。
      // 足とつま先（頭と頭の子）には同じ世界回転を掛けるので、親に対する子の相対角は変わらない
      const bias = biasOf(b);
      if (bias !== 0 && di.bindRot) {
        quat.invert(tmpInv, di.bindRot);
        vec3.transformQuat(tmpAxis, [1, 0, 0], tmpInv);
        quat.setAxisAngle(tmpBias, tmpAxis, bias);
        quat.multiply(wt, wt, tmpBias);
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
  // 接地補正: 配信元のクリップは別の骨格の寸法で作られており、ボーン長を固定すると足が床を貫く。
  // 各フレームで最も低いジョイント（足・つま先）が床（y=0）を下回っていたら Hips を持ち上げる。
  // 持ち上げる方向にしか補正しない（浮いているフレームは触らない）
  if (outTrans && spec.groundClamp !== false) {
    let maxLift = 0, soleMin = Infinity;
    if (soleProbes) {
      // 足裏の最低点が床（y=0 + 余白）を下回るフレームだけ、Hips を持ち上げる
      const target = manifest.groundMargin ?? 0.0;
      for (let i = 0; i < n; i++) {
        const minY = lowestSoleY(dstRig, outRot, outTrans, i, soleProbes);
        soleMin = Math.min(soleMin, minY);
        const lift = target - minY;
        if (lift > 0) { outTrans[i * 3 + 1] += lift / rootScaleOf(dstRig); maxLift = Math.max(maxLift, lift); }
      }
    } else {
      const groundBones = (manifest.groundBones ?? ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']).filter((b) => dstRig.info.has(b));
      // 基準はバインド姿勢（A ポーズで接地している）での同じボーン群の最低 y。つま先ボーンが床下にあるリグでも破綻しない
      let bindMinY = Infinity;
      for (const b of groundBones) { const bw = dstRig.info.get(b).bindWorld; if (bw) bindMinY = Math.min(bindMinY, bw[13]); }
      if (!Number.isFinite(bindMinY)) bindMinY = 0;
      const target = bindMinY + (manifest.groundMargin ?? 0.0);
      for (let i = 0; i < n; i++) {
        const minY = lowestJointY(dstRig, outRot, outTrans, i, groundBones);
        const lift = target - minY;
        if (lift > 0) { outTrans[i * 3 + 1] += lift / rootScaleOf(dstRig); maxLift = Math.max(maxLift, lift); }
      }
    }
    if (maxLift > 0) console.log(`[${name}] 接地補正: 最大 ${(maxLift * 100).toFixed(1)}cm 持ち上げ` + (Number.isFinite(soleMin) ? `（補正前の足裏最低 ${(soleMin * 100).toFixed(1)}cm）` : ''));
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
