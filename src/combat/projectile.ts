import type { Circle } from '../world/collision';
import { PROJECTILES, type ProjectileDef, type ProjectileId } from './data/projectiles';

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
  /** 弾き返したときのダメージ（弾のデータの値に、撃った敵の段階の倍率を掛けたもの。ADR-036） */
  reflectDamage: number;
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
        reflectDamage: 0,
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

  /**
   * 弾を撃つ。(x, z) = 銃口、(dirX, dirZ) = 単位ベクトル。空きが無ければ一番古い弾を消して使う。
   * damageScale / reflectScale = 撃った敵の段階の倍率（ダメージ・弾き返したときのダメージ。ADR-036。省略 = 等倍）
   */
  spawn(def: ProjectileDef, ownerId: number, x: number, z: number, dirX: number, dirZ: number, damageScale = 1, reflectScale = 1): Projectile {
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
    p.damage = damageScale === 1 ? def.damage : Math.max(1, Math.round(def.damage * damageScale));
    p.knockback = def.knockback;
    p.hitStop = def.hitStop;
    p.reflectDamage = reflectScale === 1 ? def.reflect.damage : Math.round(def.reflect.damage * reflectScale);
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
  p.damage = p.reflectDamage;
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

/**
 * 弾を扇・輪に撃つときの i 本目（0 始まり）の向きのずれ（rad。撃つ向きからの差）。
 * count 1 = ずれなし。spread が 2π 以上 = 全周に等間隔（先頭が撃つ向き）。それ以外は撃つ向きを中心に -spread/2 〜 +spread/2 へ均等
 */
export function fanOffset(i: number, count: number, spread: number): number {
  if (count <= 1) return 0;
  if (spread >= Math.PI * 2 - 1e-6) return (i * Math.PI * 2) / count;
  return -spread / 2 + (spread * i) / (count - 1);
}

/** 敵が撃った弾の出どころ（Enemy.shot がそのまま満たす） */
export interface ShotSpec {
  projectile: ProjectileId;
  /** 銃口（敵の中心から中心の向きへ出した位置）と、中心の向き（単位ベクトル） */
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  /** 本数と扇の広がり（count 1 = 1 本。spread は fanOffset の約束） */
  count: number;
  spread: number;
  /** 弾のダメージ・弾き返したときのダメージの倍率（敵の段階。ADR-036。省略 = 等倍） */
  damageScale?: number;
  reflectScale?: number;
}

/**
 * 敵の弾を作る。1 本なら銃口から中心の向きへ。複数（扇・輪）なら、(cx, cz)（敵の中心）から銃口までの距離（reach）を保ったまま、
 * 中心の向きを fanOffset だけ回した向きへ 1 本ずつ撃つ（体の大きな敵が、体の外から放射状に撃つ）。作った弾を返す（最後の 1 本）
 */
export function spawnShot(system: ProjectileSystem, ownerId: number, cx: number, cz: number, shot: ShotSpec): Projectile {
  const def = PROJECTILES[shot.projectile];
  const ds = shot.damageScale ?? 1;
  const rs = shot.reflectScale ?? 1;
  if (shot.count <= 1) return system.spawn(def, ownerId, shot.x, shot.z, shot.dirX, shot.dirZ, ds, rs);
  const reach = Math.hypot(shot.x - cx, shot.z - cz);
  const yaw = Math.atan2(shot.dirX, shot.dirZ);
  let last: Projectile | null = null;
  for (let i = 0; i < shot.count; i++) {
    const a = yaw + fanOffset(i, shot.count, shot.spread);
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    last = system.spawn(def, ownerId, cx + dx * reach, cz + dz * reach, dx, dz, ds, rs);
  }
  return last!;
}

