#!/usr/bin/env node
/**
 * 位置（と UV）で頂点を結合する。FBX 経由で三角形ごとに分かれてしまった頂点（triangle soup）を、
 * 隣接三角形が辺を共有するインデックス付きメッシュに戻す。法線とスキンウェイトは平均する。
 *
 *   node tools/weld-by-position.mjs <in.glb> <out.glb> [--pos 1e-4] [--uv 1e-3] [--drop-skin-weights]
 *
 * --drop-skin-weights: ウェイトを全部ジョイント 0 に置き換える（Blender で付け直す前提のとき）
 */
import { NodeIO, Accessor } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const args = process.argv.slice(2);
const [inp, out] = args.filter((a) => !a.startsWith('--') && !/^[0-9.e-]+$/.test(a));
const opt = (name, def) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : def);
const posTol = opt('--pos', 1e-4);
const uvTol = opt('--uv', 1e-3);
const dropWeights = args.includes('--drop-skin-weights');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
const root = doc.getRoot();

for (const node of root.listNodes()) {
  if (/icosphere/i.test(node.getName()) || /icosphere/i.test(node.getMesh()?.getName() ?? '')) { node.getMesh()?.dispose(); node.dispose(); }
}

for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const nrm = prim.getAttribute('NORMAL');
    const uv = prim.getAttribute('TEXCOORD_0');
    const jnt = prim.getAttribute('JOINTS_0');
    const wgt = prim.getAttribute('WEIGHTS_0');
    const idx = prim.getIndices();
    const n = pos.getCount();
    const I = idx ? Array.from(idx.getArray()) : Array.from({ length: n }, (_, i) => i);

    const key = new Map();
    const remap = new Int32Array(n);
    const groups = [];
    const p = [0, 0, 0], t = [0, 0];
    for (let i = 0; i < n; i++) {
      pos.getElement(i, p);
      if (uv) uv.getElement(i, t); else { t[0] = 0; t[1] = 0; }
      const k = `${Math.round(p[0] / posTol)},${Math.round(p[1] / posTol)},${Math.round(p[2] / posTol)},${Math.round(t[0] / uvTol)},${Math.round(t[1] / uvTol)}`;
      let g = key.get(k);
      if (g === undefined) { g = groups.length; key.set(k, g); groups.push([]); }
      groups[g].push(i);
      remap[i] = g;
    }
    const m = groups.length;
    const P = new Float32Array(m * 3), N = nrm ? new Float32Array(m * 3) : null, T = uv ? new Float32Array(m * 2) : null;
    const J = jnt ? new Uint16Array(m * 4) : null, W = wgt ? new Float32Array(m * 4) : null;
    const v3 = [0, 0, 0], v2 = [0, 0], j4 = [0, 0, 0, 0], w4 = [0, 0, 0, 0];
    for (let g = 0; g < m; g++) {
      const members = groups[g];
      const acc = [0, 0, 0], accN = [0, 0, 0], accT = [0, 0];
      const wmap = new Map();
      for (const i of members) {
        pos.getElement(i, v3); acc[0] += v3[0]; acc[1] += v3[1]; acc[2] += v3[2];
        if (nrm) { nrm.getElement(i, v3); accN[0] += v3[0]; accN[1] += v3[1]; accN[2] += v3[2]; }
        if (uv) { uv.getElement(i, v2); accT[0] += v2[0]; accT[1] += v2[1]; }
        if (jnt && wgt) { jnt.getElement(i, j4); wgt.getElement(i, w4); for (let k = 0; k < 4; k++) if (w4[k] > 0) wmap.set(j4[k], (wmap.get(j4[k]) ?? 0) + w4[k]); }
      }
      const c = members.length;
      P[g * 3] = acc[0] / c; P[g * 3 + 1] = acc[1] / c; P[g * 3 + 2] = acc[2] / c;
      if (N) { const l = Math.hypot(accN[0], accN[1], accN[2]) || 1; N[g * 3] = accN[0] / l; N[g * 3 + 1] = accN[1] / l; N[g * 3 + 2] = accN[2] / l; }
      if (T) { T[g * 2] = accT[0] / c; T[g * 2 + 1] = accT[1] / c; }
      if (J && W) {
        if (dropWeights) { J[g * 4] = 0; W[g * 4] = 1; }
        else {
          const top = [...wmap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
          const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
          top.forEach(([j, w], k) => { J[g * 4 + k] = j; W[g * 4 + k] = w / sum; });
        }
      }
    }
    // 退化した三角形（結合で 2 頂点以上が同じになったもの）を除く
    const newIdx = [];
    for (let f = 0; f < I.length; f += 3) {
      const a = remap[I[f]], b = remap[I[f + 1]], cc = remap[I[f + 2]];
      if (a === b || b === cc || a === cc) continue;
      newIdx.push(a, b, cc);
    }
    const mk = (name, type, arr) => doc.createAccessor(name).setType(type).setArray(arr);
    prim.setAttribute('POSITION', mk('POSITION', Accessor.Type.VEC3, P));
    if (N) prim.setAttribute('NORMAL', mk('NORMAL', Accessor.Type.VEC3, N));
    if (T) prim.setAttribute('TEXCOORD_0', mk('TEXCOORD_0', Accessor.Type.VEC2, T));
    if (J && W) { prim.setAttribute('JOINTS_0', mk('JOINTS_0', Accessor.Type.VEC4, J)); prim.setAttribute('WEIGHTS_0', mk('WEIGHTS_0', Accessor.Type.VEC4, W)); }
    for (const sem of prim.listSemantics()) if (!['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'].includes(sem)) prim.setAttribute(sem, null);
    prim.setIndices(mk('indices', Accessor.Type.SCALAR, m > 65535 ? new Uint32Array(newIdx) : new Uint16Array(newIdx)));
    console.log(`${mesh.getName()}: vertices ${n} → ${m}, triangles ${I.length / 3} → ${newIdx.length / 3}`);
  }
}
await doc.transform(prune());
await io.write(out, doc);
console.log('→', out);
