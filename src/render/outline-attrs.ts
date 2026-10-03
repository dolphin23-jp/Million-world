import * as THREE from 'three';

/**
 * 輪郭線（inverted hull）用の頂点属性を作る。
 *
 * 輪郭線は頂点を法線方向に押し出した裏面を描く。生成メッシュには次の弱点があり、そのまま押し出すと壊れて見える:
 *  1. 背骨・脇・服のしわのような「凹んだ溝」では、溝の両壁の法線が外へ開いており、押し出した裏面が
 *     表面を突き破って暗いギザギザの線になる
 *  2. 裾やふちの細かい凹凸で法線がばらつき、押し出しがささくれる
 * そこで頂点ごとに
 *  - aONormal: 近傍で平滑化した法線（押し出し専用。シェーディングの法線は変えない）
 *  - aOutlineCut: 凹み具合（0 = 凸・平坦で輪郭線は満額、1 = 深い溝で輪郭線なし）
 * を作る。
 *
 * UV の継ぎ目で同じ位置の頂点が複数に分かれているメッシュでは、複製同士で押し出し量が違うと輪郭線に隙間が開く。
 * そのため計算は「位置が同じ頂点を 1 つにまとめた」グラフ上で行い、結果を全複製に書き戻す。
 */

export interface OutlineAttrOptions {
  /** 法線の平滑化の回数 */
  normalIterations?: number;
  /** 凹み指標がこの値を超えると輪郭線を削り始める */
  cutStart?: number;
  /** 凹み指標がこの値以上で輪郭線を完全に消す */
  cutFull?: number;
  /** 凹み指標の平滑化の回数 */
  concavityIterations?: number;
}

const POS_QUANT = 1e5; // 0.01mm 単位でまとめる

/** noUncheckedIndexedAccess 下で配列の読み出しを number として扱う（添字は呼び出し側が範囲内を保証） */
const at = (a: ArrayLike<number>, i: number): number => a[i] as number;

export function addOutlineAttributes(geo: THREE.BufferGeometry, opts: OutlineAttrOptions = {}): void {
  const normalIterations = opts.normalIterations ?? 2;
  const cutStart = opts.cutStart ?? 0.02;
  const cutFull = opts.cutFull ?? 0.18;
  const concavityIterations = opts.concavityIterations ?? 2;

  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const index = geo.getIndex();
  if (!pos || !nor || !index) return;
  const nV = pos.count;

  // 位置が同じ頂点を同一視
  const idMap = new Map<string, number>();
  const pid = new Int32Array(nV);
  let nP = 0;
  for (let i = 0; i < nV; i++) {
    const key = `${Math.round(pos.getX(i) * POS_QUANT)},${Math.round(pos.getY(i) * POS_QUANT)},${Math.round(pos.getZ(i) * POS_QUANT)}`;
    let id = idMap.get(key);
    if (id === undefined) {
      id = nP++;
      idMap.set(key, id);
    }
    pid[i] = id;
  }

  const P = new Float32Array(nP * 3);
  const N = new Float32Array(nP * 3);
  for (let i = 0; i < nV; i++) {
    const p = at(pid, i) * 3;
    P[p] = pos.getX(i);
    P[p + 1] = pos.getY(i);
    P[p + 2] = pos.getZ(i);
    N[p] = at(N, p) + nor.getX(i);
    N[p + 1] = at(N, p + 1) + nor.getY(i);
    N[p + 2] = at(N, p + 2) + nor.getZ(i);
  }
  normalize3(N, nP);

  // 隣接（CSR）。同じ辺は 1 回だけ数える
  const idx = index.array;
  const edgeSet = new Set<number>();
  const deg = new Int32Array(nP);
  const pairs: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = at(pid, at(idx, t)), b = at(pid, at(idx, t + 1)), c = at(pid, at(idx, t + 2));
    const tri = [a, b, c, a];
    for (let k = 0; k < 3; k++) {
      const u = at(tri, k), v = at(tri, k + 1);
      if (u === v) continue;
      const lo = Math.min(u, v), hi = Math.max(u, v);
      const key = lo * nP + hi;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      pairs.push(lo, hi);
      deg[lo] = at(deg, lo) + 1;
      deg[hi] = at(deg, hi) + 1;
    }
  }
  const start = new Int32Array(nP + 1);
  for (let i = 0; i < nP; i++) start[i + 1] = at(start, i) + at(deg, i);
  const fill = start.slice(0, nP);
  const adj = new Int32Array(at(start, nP));
  for (let e = 0; e < pairs.length; e += 2) {
    const u = at(pairs, e), v = at(pairs, e + 1);
    adj[at(fill, u)] = v;
    fill[u] = at(fill, u) + 1;
    adj[at(fill, v)] = u;
    fill[v] = at(fill, v) + 1;
  }

  // 凹み指標: 近傍が「法線の表側」にあるほど凹んでいる。隣までの平均距離で正規化して無次元にする
  const conc = new Float32Array(nP);
  for (let i = 0; i < nP; i++) {
    const s = at(start, i), e = at(start, i + 1);
    if (e === s) continue;
    let along = 0, dist = 0;
    for (let k = s; k < e; k++) {
      const j = at(adj, k) * 3;
      const dx = at(P, j) - at(P, i * 3), dy = at(P, j + 1) - at(P, i * 3 + 1), dz = at(P, j + 2) - at(P, i * 3 + 2);
      along += dx * at(N, i * 3) + dy * at(N, i * 3 + 1) + dz * at(N, i * 3 + 2);
      dist += Math.hypot(dx, dy, dz);
    }
    conc[i] = dist > 1e-9 ? along / dist : 0;
  }
  smoothScalar(conc, start, adj, nP, concavityIterations);

  // 押し出し用の法線: 近傍平均で平滑化
  const SN = N.slice();
  const tmp = new Float32Array(nP * 3);
  for (let it = 0; it < normalIterations; it++) {
    for (let i = 0; i < nP; i++) {
      let x = at(SN, i * 3), y = at(SN, i * 3 + 1), z = at(SN, i * 3 + 2);
      for (let k = at(start, i); k < at(start, i + 1); k++) {
        const j = at(adj, k) * 3;
        x += at(SN, j);
        y += at(SN, j + 1);
        z += at(SN, j + 2);
      }
      tmp[i * 3] = x;
      tmp[i * 3 + 1] = y;
      tmp[i * 3 + 2] = z;
    }
    SN.set(tmp);
    normalize3(SN, nP);
  }

  // 溝の縁の頂点も巻き込んで削る（押し出した裏面は隣の頂点にも引っ張られて表面に出るため）
  const cutP = new Float32Array(nP);
  for (let i = 0; i < nP; i++) cutP[i] = cutFromConcavity(at(conc, i), cutStart, cutFull);
  const cutD = cutP.slice();
  for (let i = 0; i < nP; i++) {
    let m = at(cutP, i);
    for (let k = at(start, i); k < at(start, i + 1); k++) m = Math.max(m, at(cutP, at(adj, k)) * 0.85);
    cutD[i] = m;
  }

  const outNormal = new Float32Array(nV * 3);
  const outCut = new Float32Array(nV);
  for (let i = 0; i < nV; i++) {
    const q = at(pid, i);
    outNormal[i * 3] = at(SN, q * 3);
    outNormal[i * 3 + 1] = at(SN, q * 3 + 1);
    outNormal[i * 3 + 2] = at(SN, q * 3 + 2);
    outCut[i] = at(cutD, q);
  }
  geo.setAttribute('aONormal', new THREE.BufferAttribute(outNormal, 3));
  geo.setAttribute('aOutlineCut', new THREE.BufferAttribute(outCut, 1));
}

/** 凹み指標 → 輪郭線を削る割合（0..1）。smoothstep で滑らかに */
export function cutFromConcavity(c: number, start: number, full: number): number {
  const t = Math.min(1, Math.max(0, (c - start) / Math.max(1e-6, full - start)));
  return t * t * (3 - 2 * t);
}

function normalize3(a: Float32Array, n: number): void {
  for (let i = 0; i < n; i++) {
    const x = at(a, i * 3), y = at(a, i * 3 + 1), z = at(a, i * 3 + 2);
    const l = Math.hypot(x, y, z);
    if (l > 1e-9) {
      a[i * 3] = x / l;
      a[i * 3 + 1] = y / l;
      a[i * 3 + 2] = z / l;
    }
  }
}

function smoothScalar(v: Float32Array, start: Int32Array, adj: Int32Array, n: number, iterations: number): void {
  const tmp = new Float32Array(n);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      let s = at(v, i);
      const lo = at(start, i), hi = at(start, i + 1);
      for (let k = lo; k < hi; k++) s += at(v, at(adj, k));
      tmp[i] = s / (hi - lo + 1);
    }
    v.set(tmp);
  }
}
