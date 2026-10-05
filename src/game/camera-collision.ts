import { createRayHit, type RayHit, type World } from '../world/world';

/**
 * カメラの衝突（M7-4a。ADR-043。純粋関数）: 注視点からカメラへの線が障害物に遮られる手前までの距離。
 * 線は斜め（カメラは注視点より高い）なので、障害物の上面より高いところを通る線は遮られない（低い岩・壁・箱の上は見通せる）。
 * 線の高さが上面より低いときだけ遮る = 柱・高い壁の陰にカメラが入り込まない。
 */

const HIT: RayHit = createRayHit();

/** 遮りを探すとき、見つけた障害物の上を通り越して、先を探し直す回数と、通り越すときに進める割合 */
const PASSES = 4;
const NUDGE = 0.02;

/**
 * 注視点 (fx, fy, fz) から向き (dx, dy, dz)（単位ベクトル。注視点からカメラへ）へ maxDist の線を、半径 radius（カメラの大きさ）で調べる。
 * 遮られなければ maxDist。遮られれば、遮る面（radius だけ太らせた面）までの距離（0 以上）。
 * 始点が太らせた障害物の中でも、外向き・沿う向きなら遮られていないものとして先へ進める（箱の角のそばに立つ体から後ろへ引くとき）
 */
export function cameraClearDistance(world: World, fx: number, fy: number, fz: number, dx: number, dy: number, dz: number, maxDist: number, radius: number): number {
  const ex = fx + dx * maxDist;
  const ez = fz + dz * maxDist;
  let t0 = 0;
  let sx = fx;
  let sz = fz;
  for (let i = 0; i < PASSES; i++) {
    const startY = fy + dy * maxDist * t0;
    if (!world.raycast(sx, sz, ex, ez, startY, HIT, radius)) return maxDist;
    const t = t0 + HIT.t * (1 - t0);
    const away = HIT.t <= 1e-6 && HIT.nx * dx + HIT.nz * dz >= 0;
    const rayY = fy + dy * maxDist * t;
    const top = world.obstacles[HIT.index]!.top;
    if (!away && top > rayY) return t * maxDist;
    // 線は障害物の上を通る（または、内側から外へ出る）: その先を探し直す
    t0 = t + NUDGE;
    if (t0 >= 1) return maxDist;
    sx = fx + dx * maxDist * t0;
    sz = fz + dz * maxDist * t0;
  }
  return maxDist;
}
