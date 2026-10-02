/**
 * XZ 平面の簡易衝突（ADR-003）。物理エンジンは使わない。
 * 位置は { x, z } の 2 次元で扱い、キャラは半径 r の円。
 */

export interface Circle {
  x: number;
  z: number;
  r: number;
}

/** 円 a を円 b から押し出す（a のみ動かす）。重なっていなければ何もしない */
export function pushOutOfCircle(a: Circle, b: Circle): boolean {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const minD = a.r + b.r;
  const d2 = dx * dx + dz * dz;
  if (d2 >= minD * minD) return false;
  const d = Math.sqrt(d2);
  if (d < 1e-6) {
    // 完全に重なっている場合は +X へ逃がす
    a.x = b.x + minD;
    return true;
  }
  const k = (minD - d) / d;
  a.x += dx * k;
  a.z += dz * k;
  return true;
}

/** 2 つの円を等分に押し離す（両方動く） */
export function separateCircles(a: Circle, b: Circle): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const minD = a.r + b.r;
  const d2 = dx * dx + dz * dz;
  if (d2 >= minD * minD) return false;
  const d = Math.sqrt(d2);
  let nx = 1;
  let nz = 0;
  if (d > 1e-6) {
    nx = dx / d;
    nz = dz / d;
  }
  const half = (minD - d) * 0.5;
  a.x -= nx * half;
  a.z -= nz * half;
  b.x += nx * half;
  b.z += nz * half;
  return true;
}

/** 円 c を、中心 (cx, cz) 半径 R のアリーナ内に収める */
export function clampInsideArena(c: Circle, cx: number, cz: number, R: number): boolean {
  const dx = c.x - cx;
  const dz = c.z - cz;
  const maxD = R - c.r;
  const d2 = dx * dx + dz * dz;
  if (d2 <= maxD * maxD) return false;
  const d = Math.sqrt(d2);
  const k = maxD / d;
  c.x = cx + dx * k;
  c.z = cz + dz * k;
  return true;
}

/** 円同士が重なっているか（ヒット判定用） */
export function circlesOverlap(a: Circle, b: Circle): boolean {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const minD = a.r + b.r;
  return dx * dx + dz * dz < minD * minD;
}
