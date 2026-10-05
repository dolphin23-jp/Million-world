/**
 * ロックオンの判定（純粋関数）。対象の選択・切替・カメラの向き。位置は XZ 平面。
 *
 * 向きの約束: プレイヤー・カメラの yaw は Player.yaw / ThirdPersonCamera.yaw と同じ。
 *  - 方向の角度 θ = atan2(dx, dz)（+Z が 0、+X が +π/2）
 *  - カメラの正面は (−sin yaw, −cos yaw)、右は (cos yaw, −sin yaw)。つまり画面の右は θ が減る向き
 */

import { LOCKON } from './data/lockon';
import { wrapAngle } from '../core/math';

export interface LockCandidate {
  id: number;
  x: number;
  z: number;
  /** プレイヤーから見えているか（視線が柱・高い箱に遮られていない）。false の敵は、選べない・切替先にならない。省略 = 見えている（M7-4b。ADR-044） */
  visible?: boolean;
}

/** カメラが方向 (dx, dz) を正面に見るときの yaw */
export function lockYaw(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** カメラの yaw から見た、方向 (dx, dz) の正面からのずれ（rad、右が正、−π..π） */
export function angleFromCamera(camYaw: number, dx: number, dz: number): number {
  return wrapAngle(Math.atan2(-dx, -dz) - camYaw) * -1;
}

/**
 * ロック対象を選ぶ（ロックボタンを押したとき）。見えている（visible が false でない）敵のうち、maxRange 以内で、点数（距離を、画面の正面からずれるほど割り増し）が最小の敵。
 * 対象がなければ null。
 */
export function pickTarget(px: number, pz: number, camYaw: number, cands: readonly LockCandidate[]): number | null {
  let best: number | null = null;
  let bestScore = Infinity;
  for (const c of cands) {
    if (c.visible === false) continue;
    const dx = c.x - px;
    const dz = c.z - pz;
    const d = Math.hypot(dx, dz);
    if (d > LOCKON.maxRange) continue;
    const off = Math.abs(angleFromCamera(camYaw, dx, dz));
    const score = d * (1 + (LOCKON.angleBias * off) / Math.PI);
    if (score < bestScore) {
      bestScore = score;
      best = c.id;
    }
  }
  return best;
}

/**
 * ロック中の対象切替。いまの対象の方向から見て、右（dir = +1）または左（−1）に最も近い敵へ移る。
 * 方向は「プレイヤーから見た、いまの対象との角度の差」で測る（ロック中はカメラがいまの対象を向くので、画面の左右と一致する）。
 * その向きに敵がいなければ今のまま。
 */
export function switchTarget(currentId: number, dir: 1 | -1, px: number, pz: number, cands: readonly LockCandidate[]): number {
  const cur = cands.find((c) => c.id === currentId);
  if (!cur) return currentId;
  const ref = Math.atan2(cur.x - px, cur.z - pz);
  let best = currentId;
  let bestDelta = Infinity;
  let bestDist = Infinity;
  for (const c of cands) {
    if (c.id === currentId || c.visible === false) continue;
    const dx = c.x - px;
    const dz = c.z - pz;
    const d = Math.hypot(dx, dz);
    if (d > LOCKON.maxRange) continue;
    // 画面の右が正（θ が減る向き）にした、いまの対象からの角度の差
    const delta = wrapAngle(ref - Math.atan2(dx, dz));
    const along = delta * dir; // 切替の向きに進んだ量。正のものだけが候補
    if (along <= 1e-3) continue;
    if (along < bestDelta - 1e-6 || (Math.abs(along - bestDelta) <= 1e-6 && d < bestDist)) {
      bestDelta = along;
      bestDist = d;
      best = c.id;
    }
  }
  return best;
}

/** ロックを続けてよいか: 対象が残っていて、breakRange 以内 */
export function lockStillValid(px: number, pz: number, target: LockCandidate | undefined): boolean {
  if (!target) return false;
  return Math.hypot(target.x - px, target.z - pz) <= LOCKON.breakRange;
}
