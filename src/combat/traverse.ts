import { MOVE } from './data/attacks';
import { TRAVERSE } from './data/traverse';
import { STEP_UP, createLedgeHit, type World } from '../world/world';

/**
 * 乗り上がり・乗り越え（M7-3。ADR-041）の計画。three にも DOM にも依存しない純粋な関数: 世界と体の位置・足の高さ・押し込む向きから、
 * 「この向きへ押し込むと何が起こるか」（乗り上がり / 乗り越え / 何も起こらない）と、始点・終点を決める。実際の動きは Player が計画に沿って進める。
 */

/** mantle = 乗り上がり / vault = 乗り越え / climb = 掴んで登る（登れる縁だけ。M7-3b） */
export type TraverseKind = 'mantle' | 'vault' | 'climb';

export interface TraversePlan {
  kind: TraverseKind;
  /** 足から上面までの高さ（m）と、障害物の奥行き（面から入って反対側へ抜けるまで） */
  height: number;
  depth: number;
  /** 面の外向きの法線（単位）と、面の正面を向く体の向き（yaw。+Z が 0、右へ回る正） */
  nx: number;
  nz: number;
  yaw: number;
  /** クリップの原点（面から faceZ 手前）と、終点（乗り上がり = 上面の上、乗り越え = 向こう側の地面）。終点の高さ endY */
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  endY: number;
  /** 始点から終点までの、面の正面方向の前進量（m。クリップの rootZ の終端に対応） */
  span: number;
  /** 上面の高さ（絶対）と、足場の障害物の番号 */
  top: number;
  index: number;
}

export interface TraverseProbe {
  plan: TraversePlan;
  /** 走って近づいていて、すぐ始めてよい（勢いを保つ） */
  immediate: boolean;
  /** 面に接していて、押し込み続ければ始まる（holdFrames） */
  touching: boolean;
}

const HIT = createLedgeHit();
const END = { x: 0, z: 0, r: MOVE.radius };

/** 数値を step の倍数へ丸める（クリップを使い回す） */
export function quantize(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/**
 * 点 (x, z)・足の高さ y から、向き (dirX, dirZ)（単位ベクトル。スティックの向き）へ押し込んだときの計画。speed は水平の速さ（m/s）。
 * 乗り越えられる障害物が無い・向きが面の正面から外れている・近すぎず遠すぎず（走っているか、接しているか）でない・終点に立てない、ときは null
 */
export function probeTraverse(world: World, x: number, z: number, y: number, dirX: number, dirZ: number, speed: number): TraverseProbe | null {
  const r = MOVE.radius;
  if (!world.probeLedge(x, z, dirX, dirZ, r + TRAVERSE.runStartDist, y, HIT)) return null;
  const nx = HIT.nx;
  const nz = HIT.nz;
  // 面の正面から外れすぎ（斜めに擦っている）なら始めない
  if (dirX * -nx + dirZ * -nz < Math.cos((TRAVERSE.maxAngleDeg * Math.PI) / 180)) return null;
  const height = HIT.top - y;
  // mantleMax より高い縁は、登れる縁（climbable）と明示された面だけ（climbMax まで）。柱・登れない高い箱は対象外
  const climbing = height > TRAVERSE.mantleMax;
  if (height <= STEP_UP + 1e-6 || height > TRAVERSE.climbMax || (climbing && !HIT.climbable)) return null;
  const edge = HIT.dist - r; // 体の縁から面まで
  const immediate = speed >= TRAVERSE.runSpeed && edge <= TRAVERSE.runStartDist;
  const touching = edge <= TRAVERSE.contactDist;
  if (!immediate && !touching) return null;

  const depth = HIT.depth;
  const top = HIT.top;
  // 乗り越え: 低くて薄く、向こう側に着地できる（同じ高さの平らな地面で、ほかの障害物に重ならない）
  let kind: TraverseKind = climbing ? 'climb' : 'mantle';
  let endDist = Math.min(TRAVERSE.standZ, depth / 2); // 面からの前進量（乗り上がり）
  let endY = top;
  if (!climbing && immediate && height <= TRAVERSE.vault.maxHeight && depth <= TRAVERSE.vault.maxDepth) {
    const land = depth + TRAVERSE.vault.landZ;
    END.x = HIT.x - nx * land;
    END.z = HIT.z - nz * land;
    if (Math.abs(world.groundHeight(END.x, END.z, y, STEP_UP) - y) < 0.02 && !world.overlapsObstacle(END, y, STEP_UP) && world.contains(END.x, END.z)) {
      kind = 'vault';
      endDist = land;
      endY = y;
    }
  }
  if (kind !== 'vault') {
    END.x = HIT.x - nx * endDist;
    END.z = HIT.z - nz * endDist;
    // 上面に立てる（足場がちょうどその高さ）・別の高い障害物に重ならない・境界の内側
    if (Math.abs(world.groundHeight(END.x, END.z, top, STEP_UP) - top) > 0.02 || world.overlapsObstacle(END, top, STEP_UP) || !world.contains(END.x, END.z)) return null;
  }
  const faceZ = TRAVERSE.faceZ;
  return {
    plan: {
      kind,
      height,
      depth,
      nx,
      nz,
      yaw: Math.atan2(-nx, -nz),
      startX: HIT.x + nx * faceZ,
      startZ: HIT.z + nz * faceZ,
      endX: END.x,
      endZ: END.z,
      endY,
      span: faceZ + endDist,
      top,
      index: HIT.index,
    },
    immediate,
    touching,
  };
}
