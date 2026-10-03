#!/usr/bin/env node
/**
 * スキンウェイトをメッシュの隣接関係に沿って平滑化する（Blender を使わない自前版）。
 * 位置が一致する頂点（UV シームの複製）は同じ頂点として扱い、最後に同じウェイトを与えるので割れない。
 *
 *   node tools/smooth-weights.mjs <in.glb> <out.glb> [--factor 0.5] [--repeat 3] [--max 4]
 */
import { NodeIO, Accessor } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--') && !/^[0-9.]+$/.test(a));
const [inp, out] = files;
const opt = (name, def) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : def);
const factor = opt('--factor', 0.5);
const repeat = opt('--repeat', 3);
const maxInf = opt('--max', 4);
if (!inp || !out) { console.error('使い方: node tools/smooth-weights.mjs <in.glb> <out.glb> [--factor 0.5] [--repeat 3]'); process.exit(1); }

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0'), idx = prim.getIndices();
    if (!J || !W) continue;
    const n = pos.getCount();
    const I = idx ? idx.getArray() : Uint32Array.from({ length: n }, (_, i) => i);
    // 位置でグループ化
    const p = [0, 0, 0];
    const groupOf = new Int32Array(n);
    const key = new Map();
    const groups = [];
    for (let i = 0; i < n; i++) {
      pos.getElement(i, p);
      const k = `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
      let g = key.get(k);
      if (g === undefined) { g = groups.length; key.set(k, g); groups.push([]); }
      groups[g].push(i); groupOf[i] = g;
    }
    const m = groups.length;
    // 隣接（グループ単位）
    const adj = Array.from({ length: m }, () => new Set());
    for (let f = 0; f < I.length; f += 3) {
      const a = groupOf[I[f]], b = groupOf[I[f + 1]], c = groupOf[I[f + 2]];
      if (a !== b) { adj[a].add(b); adj[b].add(a); }
      if (b !== c) { adj[b].add(c); adj[c].add(b); }
      if (a !== c) { adj[a].add(c); adj[c].add(a); }
    }
    // グループごとのウェイト辞書（複製頂点の平均）
    const j4 = [0, 0, 0, 0], w4 = [0, 0, 0, 0];
    let weights = groups.map((members) => {
      const d = new Map();
      for (const i of members) { J.getElement(i, j4); W.getElement(i, w4); for (let k = 0; k < 4; k++) if (w4[k] > 0) d.set(j4[k], (d.get(j4[k]) ?? 0) + w4[k] / members.length); }
      return d;
    });
    for (let r = 0; r < repeat; r++) {
      const next = new Array(m);
      for (let g = 0; g < m; g++) {
        const nb = adj[g];
        if (nb.size === 0) { next[g] = weights[g]; continue; }
        const avg = new Map();
        for (const h of nb) for (const [j, w] of weights[h]) avg.set(j, (avg.get(j) ?? 0) + w / nb.size);
        const d = new Map();
        for (const [j, w] of weights[g]) d.set(j, w * (1 - factor));
        for (const [j, w] of avg) d.set(j, (d.get(j) ?? 0) + w * factor);
        next[g] = d;
      }
      weights = next;
    }
    // 上位 maxInf 本に制限して正規化し、書き戻す
    const Jout = new Uint16Array(n * 4), Wout = new Float32Array(n * 4);
    for (let g = 0; g < m; g++) {
      const top = [...weights[g].entries()].sort((a, b) => b[1] - a[1]).slice(0, maxInf);
      const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
      for (const i of groups[g]) top.forEach(([j, w], k) => { Jout[i * 4 + k] = j; Wout[i * 4 + k] = w / sum; });
    }
    prim.setAttribute('JOINTS_0', doc.createAccessor('JOINTS_0').setType(Accessor.Type.VEC4).setArray(Jout));
    prim.setAttribute('WEIGHTS_0', doc.createAccessor('WEIGHTS_0').setType(Accessor.Type.VEC4).setArray(Wout));
    console.log(`${mesh.getName()}: vertices ${n}, position groups ${m}, smoothed ×${repeat} (factor ${factor})`);
  }
}
await io.write(out, doc);
console.log('→', out);
