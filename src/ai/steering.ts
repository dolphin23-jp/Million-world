import { STEP_UP, createRayHit, type RayHit, type World } from '../world/world';
import { STEERING } from './data/steering';

/**
 * 敵の迂回（M7-4a。ADR-043。three にも DOM にも依存しない純粋関数）。
 * 目標へまっすぐ進める（体の幅で、先 lookahead まで障害物に触れない）なら、その向き。塞がれていれば、向きを offsetsDeg の角度だけ左右へ回して、
 * 通れる向きのうち回す角度がいちばん小さいものを選ぶ（毎ステップ選び直す = 柱のまわりをなめらかな弧で回り、壁の端を越えると目標へ向き直る）。
 * 同じ角度で左右とも通れるときは、前のステップで選んだ側（state.side）を続ける（柱の真後ろに目標があるとき、左右へ揺れない）。
 * まっすぐ進める向きになったら、側の記憶を捨てる。どの向きも塞がれていれば、いちばん先まで進める向き。
 */

/** 迂回の状態（敵ごとに持つ。選んでいる側） */
export interface SteerState {
  /** 0 = 迂回していない、+1 = 目標の向きから左（+yaw）へ回している、−1 = 右へ */
  side: number;
}

export function createSteerState(): SteerState {
  return { side: 0 };
}

const HIT: RayHit = createRayHit();

/**
 * 点 (x, z) から向き (dirX, dirZ)（単位ベクトル）へ、半径 r の体が長さ look まで障害物に触れずに進めるか調べ、進める距離（look 以下）を返す。
 * y は足の高さ（飛んでいる敵は FLYING_Y）。足の高さ + STEP_UP より高い障害物が体を止める（World.moveCircle と同じ境目）
 */
export function freeDistance(world: World, x: number, z: number, dirX: number, dirZ: number, r: number, y: number, look: number): number {
  const inflate = Math.max(0, r - STEERING.slack);
  const ex = x + dirX * look;
  const ez = z + dirZ * look;
  let sx = x;
  let sz = z;
  let travelled = 0;
  // 始点が太らせた障害物の中（接して押し出された体）でも、外向き・沿う向きなら進める: その幅だけ先へ進めて調べ直す
  for (let i = 0; i < 4; i++) {
    if (!world.raycast(sx, sz, ex, ez, y + STEP_UP, HIT, inflate)) return look;
    const into = HIT.nx * dirX + HIT.nz * dirZ < -1e-6;
    if (HIT.t > 1e-6 || into) return Math.min(look, travelled + HIT.t * (look - travelled));
    travelled += STEERING.skip;
    if (travelled >= look) return look;
    sx = x + dirX * travelled;
    sz = z + dirZ * travelled;
  }
  return travelled;
}

/** 片側（side = +1 / −1）へ、小さい角度から順に回して、最初に通れる向きを探す。結果は SCAN に書く（clearIndex = offsetsDeg の添字。通れる向きがなければ −1） */
const SCAN = { clearIndex: -1, yaw: 0, bestFree: -1, bestYaw: 0 };

function scanSide(world: World, x: number, z: number, r: number, y: number, want: number, look: number, side: number): void {
  SCAN.clearIndex = -1;
  SCAN.bestFree = -1;
  SCAN.bestYaw = want;
  const offsets = STEERING.offsetsDeg;
  for (let i = 0; i < offsets.length; i++) {
    const yaw = want + side * ((offsets[i]! * Math.PI) / 180);
    const f = freeDistance(world, x, z, Math.sin(yaw), Math.cos(yaw), r, y, look);
    if (f >= look - 1e-6) {
      SCAN.clearIndex = i;
      SCAN.yaw = yaw;
      return;
    }
    if (f > SCAN.bestFree + 1e-6) {
      SCAN.bestFree = f;
      SCAN.bestYaw = yaw;
    }
  }
}

/**
 * 目標 (tx, tz) へ向かう進行の向き（yaw。atan2(dx, dz)）を返す。
 * まっすぐ進めるならその向き（側の記憶を捨てる）。塞がれていれば、まだ側を決めていないときは、左右それぞれで通れる最小の角度を調べて小さいほう
 * （同じなら prefer の側。+1 / −1。敵の id で散らす）を選んで**その側を続ける**: 決めた側で通れる向きがあるあいだは、反対側が近くなっても戻らない
 * （壁の真後ろの目標へ、端まで行かずに左右へ往復するのを防ぐ）。決めた側にどの向きも通れる所がなければ、反対側へ移る。どちらもなければ、いちばん先まで進める向き。
 * 半径 r・足の高さ y の体が (x, z) にいる
 */
export function steerYaw(world: World, x: number, z: number, r: number, y: number, tx: number, tz: number, state: SteerState, prefer = 1): number {
  const dx = tx - x;
  const dz = tz - z;
  const dist = Math.hypot(dx, dz);
  const want = Math.atan2(dx, dz);
  if (dist < STEERING.minDistance) return want;
  const look = Math.min(STEERING.lookahead, dist);
  if (freeDistance(world, x, z, dx / dist, dz / dist, r, y, look) >= look - 1e-6) {
    state.side = 0;
    return want;
  }
  if (state.side !== 0) {
    scanSide(world, x, z, r, y, want, look, state.side);
    if (SCAN.clearIndex >= 0) return SCAN.yaw;
    const keepFree = SCAN.bestFree;
    const keepYaw = SCAN.bestYaw;
    scanSide(world, x, z, r, y, want, look, -state.side);
    if (SCAN.clearIndex >= 0) {
      state.side = -state.side;
      return SCAN.yaw;
    }
    if (SCAN.bestFree > keepFree + 1e-6) {
      state.side = -state.side;
      return SCAN.bestYaw;
    }
    return keepYaw;
  }
  const first = prefer >= 0 ? 1 : -1;
  scanSide(world, x, z, r, y, want, look, first);
  const a = SCAN.clearIndex;
  const aYaw = SCAN.yaw;
  const aFree = SCAN.bestFree;
  const aBestYaw = SCAN.bestYaw;
  scanSide(world, x, z, r, y, want, look, -first);
  const b = SCAN.clearIndex;
  if (a >= 0 && (b < 0 || a <= b)) {
    state.side = first;
    return aYaw;
  }
  if (b >= 0) {
    state.side = -first;
    return SCAN.yaw;
  }
  // どちらにも通れる向きがない: いちばん先まで進める向き
  if (aFree >= SCAN.bestFree) {
    state.side = first;
    return aBestYaw;
  }
  state.side = -first;
  return SCAN.bestYaw;
}
