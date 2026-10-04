/**
 * ヒット判定の核（ADR-014）。XZ 平面の幾何だけを扱う純粋関数で、three や DOM に依存しない。
 *
 * 攻撃側は「持続フレームのあいだ、攻撃者の前方に出る領域（ヒットボックス）」、被弾側は「半径 r の円（ハートボックス）」。
 * 剣先の軌跡では判定しない: 剣先は最高 85m/s（1 フレームで約 1.4m）で動くので、フレームごとの位置で判定するとすり抜ける。
 * 領域は攻撃者に付いて動き、持続中は毎フレーム同じ領域を当てるので、すり抜けず、当たる範囲は技の見た目（振りの弧・突きの線）に合わせたデータで決まる。
 *
 * 「1 攻撃 1 対象 1 回」は HitTracker で守る。攻撃を始めるたびに tracker を reset する。
 */

import type { Circle } from '../world/collision';
import { wrapAngle } from '../core/math';

export type HitboxDef =
  /** 扇形（斬り）。range は攻撃者の中心から相手の円の縁までの届く距離、halfAngle は正面からの片側の角度（rad） */
  | { kind: 'arc'; range: number; halfAngle: number }
  /** 線分に幅を持たせた領域（突き）。攻撃者の中心から正面へ length、相手の円との距離が radius 以内で当たる */
  | { kind: 'line'; length: number; radius: number }
  /** 円（地面の衝撃波。ADR-031）。攻撃者の中心から正面へ offset の点を中心に、半径 radius の円（相手の円の半径も足す） */
  | { kind: 'circle'; offset: number; radius: number };

/** 当たりの届く距離（攻撃者の中心から）。予告の帯の長さの計算に使う */
export function hitboxReach(box: HitboxDef): number {
  if (box.kind === 'arc') return box.range;
  if (box.kind === 'line') return box.length;
  return box.offset + box.radius;
}

/** 攻撃者の位置と向き（yaw: +Z が 0、+X が +π/2。Player.yaw と同じ） */
export interface HitOrigin {
  x: number;
  z: number;
  yaw: number;
}

/** 被弾側。id は tracker のキー。invulnerable の間は当たらない（回避の無敵フレームなど） */
export interface Hurtbox extends Circle {
  id: number;
  invulnerable: boolean;
}

/** 命中の結果。演出（ヒットストップ・フラッシュ・シェイク・数字）とダメージ適用の入力 */
export interface HitEvent {
  attackerId: number;
  targetId: number;
  damage: number;
  /** ノックバック距離（m） */
  knockback: number;
  /** ヒットストップ（sim フレーム） */
  hitStop: number;
  /** 攻撃者から相手へ向かう単位ベクトル（XZ） */
  dirX: number;
  dirZ: number;
  /** 命中位置（XZ）。相手の円の、攻撃者に近い側の縁 */
  x: number;
  z: number;
}

/** 円 target がヒットボックスに当たっているか */
export function hitboxHits(origin: HitOrigin, box: HitboxDef, target: Circle): boolean {
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const d = Math.hypot(dx, dz);
  const fx = Math.sin(origin.yaw);
  const fz = Math.cos(origin.yaw);

  if (box.kind === 'circle') {
    const px = origin.x + fx * box.offset - target.x;
    const pz = origin.z + fz * box.offset - target.z;
    const reach = box.radius + target.r;
    return px * px + pz * pz <= reach * reach;
  }

  if (box.kind === 'line') {
    // 線分 (origin → origin + f * length) と円の中心の距離
    const along = Math.min(Math.max(dx * fx + dz * fz, 0), box.length);
    const px = origin.x + fx * along - target.x;
    const pz = origin.z + fz * along - target.z;
    const reach = box.radius + target.r;
    return px * px + pz * pz <= reach * reach;
  }

  // 扇形: 届く距離（縁まで）と、相手の円の見かけの角度の広がりを含めた向き
  if (d - target.r > box.range) return false;
  if (d <= target.r) return true; // 攻撃者の中心が相手の円の中にある
  const toTarget = Math.atan2(dx, dz);
  const dAngle = Math.abs(wrapAngle(toTarget - origin.yaw));
  const spread = Math.asin(Math.min(1, target.r / d));
  return dAngle <= box.halfAngle + spread;
}

/** 「1 攻撃 1 対象 1 回」の記録。攻撃を始めるたびに reset する */
export class HitTracker {
  private readonly hit = new Set<number>();

  reset(): void {
    this.hit.clear();
  }

  has(id: number): boolean {
    return this.hit.has(id);
  }

  add(id: number): void {
    this.hit.add(id);
  }

  get count(): number {
    return this.hit.size;
  }
}

/**
 * ヒットボックスに当たった「まだ当てていない」対象を out に集め（追記）、tracker に記録する。戻り値は新しく当たった数。
 * invulnerable な対象は当たらず、記録もしない（無敵が切れたあと、同じ攻撃の持続が残っていれば当たる）。
 */
export function collectHits(
  origin: HitOrigin,
  box: HitboxDef,
  targets: readonly Hurtbox[],
  tracker: HitTracker,
  out: Hurtbox[],
): number {
  let n = 0;
  for (const t of targets) {
    if (t.invulnerable || tracker.has(t.id)) continue;
    if (!hitboxHits(origin, box, t)) continue;
    tracker.add(t.id);
    out.push(t);
    n++;
  }
  return n;
}

/** 持続フレームの中か。f は「攻撃を始めてからの sim フレーム」（アニメ時刻 f/60 ≒ 描画されている姿勢の時刻） */
export function isActiveFrame(startup: number, active: number, f: number): boolean {
  return f >= startup && f < startup + active;
}

/** 命中位置（相手の円の、攻撃者に近い側の縁）と方向を作る */
export function makeHitEvent(
  attackerId: number,
  origin: HitOrigin,
  target: Circle & { id: number },
  hit: { damage: number; knockback: number; hitStop: number },
): HitEvent {
  let dx = target.x - origin.x;
  let dz = target.z - origin.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) {
    // 完全に重なっていたら攻撃者の向きを使う
    dx = Math.sin(origin.yaw);
    dz = Math.cos(origin.yaw);
  } else {
    dx /= d;
    dz /= d;
  }
  return {
    attackerId,
    targetId: target.id,
    damage: hit.damage,
    knockback: hit.knockback,
    hitStop: hit.hitStop,
    dirX: dx,
    dirZ: dz,
    x: target.x - dx * target.r,
    z: target.z - dz * target.r,
  };
}
