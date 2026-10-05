import { createRayHit, type RayHit, type World } from '../world/world';
import { REACH } from './data/reach';

/**
 * 近接の縦の届き（M7-4b。ADR-044。純粋関数）。攻撃者の足の高さ attY・背の高さ attH と、相手の足の高さ tgtY・背の高さ tgtH から、
 * 攻撃が縦に届くかを返す。XZ の当たり（hitbox）は別に見る。
 * reachTop が指定されていれば、攻撃者の足から reachTop までしか届かない（猪の突進のように低い攻撃。足が reachTop より上の相手（跳んでいる）には当たらない）。
 */
export function verticalReach(attY: number, attH: number, tgtY: number, tgtH: number, reachTop?: number): boolean {
  const top = reachTop === undefined ? attY + attH + REACH.above : attY + reachTop;
  const bottom = attY - REACH.below;
  return top >= tgtY && bottom <= tgtY + tgtH;
}

/**
 * 視線（見えているか）を調べる高さ（m）: 二人の足の高さのうち高い方 + 目の高さ。この高さより上面の高い障害物（柱・高い箱）が遮り、
 * 低い岩・壁、登った縁（立っている足場の上面）は遮らない。ロックオン・敵の視界で共通
 */
export function sightHeight(footA: number, footB: number): number {
  return Math.max(footA, footB) + REACH.eyeHeight;
}

const SIGHT_HIT: RayHit = createRayHit();

/**
 * 2 点のあいだが見通せるか: 高さ y で、REACH.sightClearance の太さの線を引いて、上面が y より高い障害物に当たらなければ見える。
 * 遠距離の敵の射線・敵の視界・ロックオンで共通
 */
export function canSee(world: World, ax: number, az: number, bx: number, bz: number, y: number): boolean {
  return !world.raycast(ax, az, bx, bz, y, SIGHT_HIT, REACH.sightClearance);
}
