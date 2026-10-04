import type { Circle } from '../world/collision';
import type { ProjectileDef } from './data/projectiles';

/**
 * 飛び道具（鬼火など）の sim（ADR-026）。three にも DOM にも依存しない純粋なデータと関数。
 * 弾は XZ 平面を一定の速さでまっすぐ飛ぶ（高さは見た目だけ。PROJECTILE_HEIGHT）。当たり判定は円（半径 radius）で、
 * 1 ステップに動いた線分（前の位置 → 今の位置）と相手の円で調べる（速くてもすり抜けない）。
 * 命中・ガード・パリィの解決は src/game/projectile-combat.ts。弾の数は MAX_PROJECTILES まで（プールを最初に作って使い回す = 毎フレームの確保なし）。
 */

/** プールの大きさ。いちどに飛んでいる弾の上限（超えたら一番古い弾を消して作る） */
export const MAX_PROJECTILES = 24;

/** アリーナの縁から、弾がこの距離（m）外へ出たら消える */
const WALL_MARGIN = 0.5;

/** 弾の持ち主の陣営。enemy = 敵の弾（プレイヤーに当たる）、player = パリィで弾き返した弾（敵に当たる） */
export type ProjectileTeam = 'enemy' | 'player';

/** 消えた理由。expire = 寿命、wall = アリーナの縁、hit = 当たった、guard = 受け止められた、cut = 斬り落とされた、clear = 戦闘のやり直し */
export type ProjectileEnd = 'expire' | 'wall' | 'hit' | 'guard' | 'cut' | 'clear';

export interface Projectile {
  readonly slot: number;
  alive: boolean;
  def: ProjectileDef;
  team: ProjectileTeam;
  /** 撃った敵の id（弾き返された弾は元の持ち主のまま。命中したときの attackerId は team で決める） */
  ownerId: number;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  /** 飛ぶ向き（単位ベクトル）と速さ（m/s） */
  dirX: number;
  dirZ: number;
  speed: number;
  damage: number;
  knockback: number;
  hitStop: number;
  /** 撃たれてから進んだ sim フレーム、寿命（フレーム） */
  age: number;
  lifetime: number;
  /** 弾き返されるたびに増える（見た目が色を替えるため） */
  reflectSerial: number;
  end: ProjectileEnd | null;
}

export class ProjectileSystem {
  readonly pool: Projectile[] = [];

  constructor(size = MAX_PROJECTILES) {
    for (let i = 0; i < size; i++) {
      this.pool.push({
        slot: i,
        alive: false,
        def: null as unknown as ProjectileDef,
        team: 'enemy',
        ownerId: 0,
        x: 0,
        z: 0,
        prevX: 0,
        prevZ: 0,
        dirX: 0,
        dirZ: 1,
        speed: 0,
        damage: 0,
        knockback: 0,
        hitStop: 0,
        age: 0,
        lifetime: 0,
        reflectSerial: 0,
        end: null,
      });
    }
  }

  /** 飛んでいる弾の数 */
  get aliveCount(): number {
    let n = 0;
    for (const p of this.pool) if (p.alive) n++;
    return n;
  }

  /** 弾を撃つ。(x, z) = 銃口、(dirX, dirZ) = 単位ベクトル。空きが無ければ一番古い弾を消して使う */
  spawn(def: ProjectileDef, ownerId: number, x: number, z: number, dirX: number, dirZ: number): Projectile {
    let slot: Projectile | null = null;
    let oldest: Projectile = this.pool[0]!;
    for (const p of this.pool) {
      if (!p.alive) {
        slot = p;
        break;
      }
      if (p.age > oldest.age) oldest = p;
    }
    const p = slot ?? oldest;
    p.alive = true;
    p.def = def;
    p.team = 'enemy';
    p.ownerId = ownerId;
    p.x = p.prevX = x;
    p.z = p.prevZ = z;
    p.dirX = dirX;
    p.dirZ = dirZ;
    p.speed = def.speed;
    p.damage = def.damage;
    p.knockback = def.knockback;
    p.hitStop = def.hitStop;
    p.age = 0;
    p.lifetime = def.lifetimeFrames;
    p.reflectSerial = 0;
    p.end = null;
    return p;
  }

  /**
   * 1 ステップ進める。寿命が尽きるか、アリーナの縁の外へ出た弾は消える。消えた弾ごとに onEnd を呼ぶ（演出用）。
   * 弾が消えるのは step の中だけではない（命中・ガード・斬り落としは src/game/projectile-combat.ts が end() を呼ぶ）
   */
  step(dt: number, arenaRadius: number, onEnd?: (p: Projectile, reason: ProjectileEnd) => void): void {
    const limit = arenaRadius + WALL_MARGIN;
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.prevX = p.x;
      p.prevZ = p.z;
      p.x += p.dirX * p.speed * dt;
      p.z += p.dirZ * p.speed * dt;
      p.age++;
      if (p.age >= p.lifetime) end(p, 'expire', onEnd);
      else if (Math.hypot(p.x, p.z) > limit) end(p, 'wall', onEnd);
    }
  }

  /** すべての弾を消す（戦闘のやり直し。onEnd は呼ばない） */
  clear(): void {
    for (const p of this.pool) {
      p.alive = false;
      p.end = 'clear';
    }
  }
}

/** 弾を消す */
export function end(p: Projectile, reason: ProjectileEnd, onEnd?: (p: Projectile, reason: ProjectileEnd) => void): void {
  if (!p.alive) return;
  p.alive = false;
  p.end = reason;
  onEnd?.(p, reason);
}

/**
 * 弾き返す: 弾を player の陣営に替え、(dirX, dirZ)（単位ベクトル）の向きへ、速く・強くして飛ばし直す。
 * 寿命も数え直す（弾き返した先で、敵に届くまで飛び続ける）
 */
export function reflect(p: Projectile, dirX: number, dirZ: number): void {
  const r = p.def.reflect;
  p.team = 'player';
  p.dirX = dirX;
  p.dirZ = dirZ;
  p.speed = p.def.speed * r.speedScale;
  p.damage = r.damage;
  p.knockback = r.knockback;
  p.hitStop = r.hitStop;
  p.age = 0;
  p.lifetime = r.lifetimeFrames;
  p.reflectSerial++;
  // 弾いた瞬間の位置から飛び直す（前ステップの位置も揃えて、補間が逆戻りしないように）
  p.prevX = p.x;
  p.prevZ = p.z;
}

/**
 * 線分 (ax, az) → (bx, bz) と円 c（半径に margin を足す）が重なるか。弾が 1 ステップに動いた線分で調べる。
 * 重なるときは線分上の円の中心に最も近い点を out に書く（命中位置の目安）
 */
export function segmentHitsCircle(ax: number, az: number, bx: number, bz: number, c: Circle, margin: number, out?: { x: number; z: number }): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 < 1e-12 ? 0 : Math.min(1, Math.max(0, ((c.x - ax) * dx + (c.z - az) * dz) / len2));
  const px = ax + dx * t;
  const pz = az + dz * t;
  const reach = c.r + margin;
  const hit = (px - c.x) * (px - c.x) + (pz - c.z) * (pz - c.z) <= reach * reach;
  if (hit && out) {
    out.x = px;
    out.z = pz;
  }
  return hit;
}
