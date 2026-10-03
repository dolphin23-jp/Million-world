#!/usr/bin/env node
/**
 * メッシュそのものの欠陥を数値で検査する（アニメーションに依らない静的検査）。
 *
 *   node tools/mesh-check.mjs <model.glb> [--json]
 *
 * 検査項目:
 *  - 穴（開いた辺）/ 非多様体辺 / 縮退三角形 / 面の向きの不整合（隣接面で巻き方向が逆）
 *  - 法線と面の向きの食い違い（裏返り）/ 全体の符号付き体積（裏表）
 *  - 孤立した浮き島（位置結合した連結成分、面積が小さいもの）
 *  - UV: 範囲外、UV 面積/3D 面積のテクセル密度（低い領域＝ぼやける）、部位ごとの分布、
 *    テクスチャの継ぎ目（UV だけ分かれている辺）の長さ
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const file = process.argv[2];
const asJson = process.argv.includes('--json');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(file);
const root = doc.getRoot();

const out = { file, meshes: [] };
const q = (v, s) => Math.round(v / s);

for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION').getArray();
    const nor = prim.getAttribute('NORMAL')?.getArray();
    const uv = prim.getAttribute('TEXCOORD_0')?.getArray();
    const idx = prim.getIndices()?.getArray() ?? Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
    const nV = pos.length / 3, nT = idx.length / 3;

    // 位置結合（見た目上同じ位置の頂点を同一視）
    const tol = 1e-5; // m（モデルは m 単位）
    const key = (i) => `${q(pos[i * 3], tol)},${q(pos[i * 3 + 1], tol)},${q(pos[i * 3 + 2], tol)}`;
    const posId = new Int32Array(nV); const map = new Map(); let nP = 0;
    for (let i = 0; i < nV; i++) { const k = key(i); let id = map.get(k); if (id === undefined) { id = nP++; map.set(k, id); } posId[i] = id; }

    const edges = new Map(); // "a_b"(a<b) -> {count, fwd, bwd}
    let degenerate = 0, areaTotal = 0, uvAreaTotal = 0;
    const triArea = new Float64Array(nT), triUvArea = new Float64Array(nT), triC = new Float32Array(nT * 3);
    const triFlip = new Uint8Array(nT);
    let flipped = 0, signedVol = 0;
    const parent = Int32Array.from({ length: nP }, (_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };

    for (let t = 0; t < nT; t++) {
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      const A = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]], B = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]], C = [pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]];
      const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const area = Math.hypot(...n) / 2; triArea[t] = area; areaTotal += area;
      triC[t * 3] = (A[0] + B[0] + C[0]) / 3; triC[t * 3 + 1] = (A[1] + B[1] + C[1]) / 3; triC[t * 3 + 2] = (A[2] + B[2] + C[2]) / 3;
      const pa = posId[a], pb = posId[b], pc = posId[c];
      if (area < 1e-10 || pa === pb || pb === pc || pa === pc) degenerate++;
      signedVol += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
      if (nor && area > 1e-10) {
        const nx = nor[a * 3] + nor[b * 3] + nor[c * 3], ny = nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1], nz = nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2];
        const d = (n[0] * nx + n[1] * ny + n[2] * nz) / (Math.hypot(...n) * Math.hypot(nx, ny, nz) + 1e-12);
        if (d < -0.2) { triFlip[t] = 1; flipped++; }
      }
      if (uv) {
        const ua = [uv[a * 2], uv[a * 2 + 1]], ub = [uv[b * 2], uv[b * 2 + 1]], uc = [uv[c * 2], uv[c * 2 + 1]];
        const ua2 = Math.abs((ub[0] - ua[0]) * (uc[1] - ua[1]) - (ub[1] - ua[1]) * (uc[0] - ua[0])) / 2;
        triUvArea[t] = ua2; uvAreaTotal += ua2;
      }
      for (const [p, q2] of [[pa, pb], [pb, pc], [pc, pa]]) {
        uni(p, q2);
        if (p === q2) continue;
        const lo = Math.min(p, q2), hi = Math.max(p, q2), k = `${lo}_${hi}`;
        let e = edges.get(k); if (!e) { e = { c: 0, f: 0, b: 0 }; edges.set(k, e); }
        e.c++; if (p === lo) e.f++; else e.b++;
      }
    }
    let boundary = 0, nonManifold = 0, inconsistent = 0;
    for (const e of edges.values()) { if (e.c === 1) boundary++; else if (e.c > 2) nonManifold++; else if (e.f !== 1) inconsistent++; }

    // 連結成分
    const comp = new Map();
    for (let t = 0; t < nT; t++) { const r = find(posId[idx[t * 3]]); let c = comp.get(r); if (!c) { c = { tris: 0, area: 0, min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }; comp.set(r, c); } c.tris++; c.area += triArea[t]; for (let k = 0; k < 3; k++) { c.min[k] = Math.min(c.min[k], triC[t * 3 + k]); c.max[k] = Math.max(c.max[k], triC[t * 3 + k]); } }
    const comps = [...comp.values()].sort((a, b) => b.tris - a.tris);

    // テクセル密度: sqrt(UV 面積 / 3D 面積) × テクスチャ辺(px) = 1m あたりのテクセル数
    const tex = root.listTextures()[0]; const texSize = tex ? (tex.getSize?.() ?? [0, 0])[0] : 0;
    const dens = []; // {d, y, z, t}
    if (uv) for (let t = 0; t < nT; t++) if (triArea[t] > 1e-7) dens.push({ d: Math.sqrt(triUvArea[t] / triArea[t]) * (texSize || 1), y: triC[t * 3 + 1], z: triC[t * 3 + 2], x: triC[t * 3], a: triArea[t] });
    // 面積加重の分位
    dens.sort((a, b) => a.d - b.d);
    const wq = (p) => { let acc = 0, tot = dens.reduce((s, x) => s + x.a, 0); for (const x of dens) { acc += x.a; if (acc >= tot * p) return x.d; } return 0; };

    // 部位別（高さ帯）
    const bands = [['足', 0, 0.15], ['脚', 0.15, 0.85], ['腰', 0.85, 1.05], ['胴', 1.05, 1.4], ['頭(首〜)', 1.4, 2.0]];
    const bandStats = bands.map(([name, lo, hi]) => { const s = dens.filter((x) => x.y >= lo && x.y < hi); if (!s.length) return [name, 0, 0, 0]; const tot = s.reduce((a, x) => a + x.a, 0); let acc = 0, med = 0; for (const x of s) { acc += x.a; if (acc >= tot / 2) { med = x.d; break; } } return [name, +(tot * 1e4).toFixed(0), Math.round(med), Math.round(s.reduce((m, x) => Math.min(m, x.d), 1e9))]; });

    // UV 範囲外
    let uvOut = 0; if (uv) for (let i = 0; i < nV; i++) if (uv[i * 2] < -0.001 || uv[i * 2] > 1.001 || uv[i * 2 + 1] < -0.001 || uv[i * 2 + 1] > 1.001) uvOut++;

    // 継ぎ目: 位置は同じだが UV が違う辺（= UV 島の境界）の長さ
    let seamLen = 0, totalLen = 0;
    if (uv) {
      const uvEdge = new Map();
      for (let t = 0; t < nT; t++) for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
        const a = idx[t * 3 + i], b = idx[t * 3 + j]; const pa = posId[a], pb = posId[b]; if (pa === pb) continue;
        const k = pa < pb ? `${pa}_${pb}` : `${pb}_${pa}`;
        const ua = pa < pb ? a : b, ub = pa < pb ? b : a;
        const len = Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
        const s = `${uv[ua * 2].toFixed(4)},${uv[ua * 2 + 1].toFixed(4)},${uv[ub * 2].toFixed(4)},${uv[ub * 2 + 1].toFixed(4)}`;
        let e = uvEdge.get(k); if (!e) { e = { s: new Set(), len }; uvEdge.set(k, e); } e.s.add(s);
      }
      for (const e of uvEdge.values()) { totalLen += e.len; if (e.s.size > 1) seamLen += e.len; }
    }

    // 重心高さ・サイズ
    let minY = 1e9, maxY = -1e9; for (let i = 0; i < nV; i++) { minY = Math.min(minY, pos[i * 3 + 1]); maxY = Math.max(maxY, pos[i * 3 + 1]); }

    out.meshes.push({
      name: mesh.getName(), verts: nV, tris: nT, weldedVerts: nP,
      heightRange: [+minY.toFixed(3), +maxY.toFixed(3)],
      degenerate, boundaryEdges: boundary, nonManifoldEdges: nonManifold, inconsistentWinding: inconsistent,
      flippedNormalTris: flipped, flippedShare: +(flipped / nT * 100).toFixed(3), signedVolume: +signedVol.toFixed(5),
      components: comps.length,
      topComponents: comps.slice(0, 4).map((c) => ({ tris: c.tris, areaCm2: +(c.area * 1e4).toFixed(1), y: [+c.min[1].toFixed(2), +c.max[1].toFixed(2)] })),
      smallIslands: comps.filter((c) => c.tris < 2000 && c.area < 0.01).length,
      smallIslandList: comps.filter((c) => c.tris < 2000).slice(0, 12).map((c) => ({ tris: c.tris, areaCm2: +(c.area * 1e4).toFixed(2), y: +((c.min[1] + c.max[1]) / 2).toFixed(2), x: +((c.min[0] + c.max[0]) / 2).toFixed(2), z: +((c.min[2] + c.max[2]) / 2).toFixed(2) })),
      uvOutOfRangeVerts: uvOut, textureSize: texSize,
      texelsPerMeter: { p5: Math.round(wq(0.05)), p25: Math.round(wq(0.25)), median: Math.round(wq(0.5)), p95: Math.round(wq(0.95)) },
      bands: bandStats.map(([n, a, m, mn]) => ({ band: n, areaCm2: a, medianTexelsPerM: m, minTexelsPerM: mn })),
      uvSeamShare: totalLen ? +(seamLen / totalLen * 100).toFixed(1) : null,
    });
  }
}
if (asJson) console.log(JSON.stringify(out, null, 1)); else console.dir(out, { depth: 5 });
