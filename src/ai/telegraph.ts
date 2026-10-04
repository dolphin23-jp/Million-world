import type { EnemyAttackDef } from './data/enemies';

/**
 * 敵の攻撃の予告（テレグラフ）の床表示の幾何（純粋関数。ADR-025）。描くのは src/render/telegraph.ts。
 *
 * lane（突進の通り道）: 予備動作に入ると、敵の向いている方向へ帯が伸びる。前半（windupTrackFrames まで）は敵がプレイヤーを追って向きを変えるので
 * 帯も薄く揺れ、後半は向きが固定されて帯が濃くなる（ここから横へ動けば避けられる）。突進が始まったら出発点に固定して、攻撃の終わりへ向けて薄れる。
 */

/** 予告の帯 1 本の見た目の入力 */
export interface LaneView {
  /** 帯の始点（床の XZ）と向き（yaw。+Z が 0、sin / cos で +X / +Z）、長さ・幅（m） */
  x: number;
  z: number;
  yaw: number;
  length: number;
  width: number;
  /** 濃さ 0..1 */
  intensity: number;
  /** 向きが固定された（避けるなら今動く）か、突進が始まったか */
  locked: boolean;
  striking: boolean;
}

/** 予告を出せる敵の部分（Enemy がそのまま満たす） */
export interface TelegraphSource {
  readonly state: string;
  readonly stateFrame: number;
  readonly yaw: number;
  readonly body: { readonly x: number; readonly z: number };
  readonly attackDef: EnemyAttackDef;
  readonly attackOriginX: number;
  readonly attackOriginZ: number;
}

/** 帯の長さ = 踏み込み + 当たりの届く距離 */
export function laneLength(atk: EnemyAttackDef): number {
  const reach = atk.hitbox.kind === 'arc' ? atk.hitbox.range : atk.hitbox.length;
  return atk.lunge + reach;
}

/** 予告を out に書いて true。出さない状態（予告の無い攻撃・予備動作と攻撃以外）は false */
export function laneOf(e: TelegraphSource, out: LaneView): boolean {
  const atk = e.attackDef;
  const t = atk.telegraph;
  if (!t || t.kind !== 'lane') return false;
  out.length = laneLength(atk);
  out.width = t.width;
  if (e.state === 'windup') {
    const locked = e.stateFrame >= atk.windupTrackFrames;
    // 追っているあいだは薄く伸びてくる（0.12 → 0.4）。固定されたら濃く、突進の直前まで脈打つ
    const track = Math.min(1, e.stateFrame / Math.max(1, atk.windupTrackFrames));
    const pulse = 0.08 * Math.sin(e.stateFrame * 0.55);
    out.x = e.body.x;
    out.z = e.body.z;
    out.yaw = e.yaw;
    out.intensity = locked ? 0.62 + pulse + 0.2 * ((e.stateFrame - atk.windupTrackFrames) / Math.max(1, atk.windupFrames - atk.windupTrackFrames)) : 0.12 + 0.28 * track;
    out.locked = locked;
    out.striking = false;
    return true;
  }
  if (e.state === 'attack') {
    // 突進のあいだ: 出発点に固定した帯が、最初は強く光って薄れていく（突進の終わりでほぼ消える）
    const dash = atk.startupFrames + atk.activeFrames;
    const u = Math.min(1, e.stateFrame / Math.max(1, dash));
    if (u >= 1) return false;
    out.x = e.attackOriginX;
    out.z = e.attackOriginZ;
    out.yaw = e.yaw;
    out.intensity = 1 - 0.85 * u;
    out.locked = true;
    out.striking = true;
    return true;
  }
  return false;
}
