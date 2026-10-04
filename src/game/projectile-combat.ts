import { hitboxHits, type HitEvent, type HitOrigin } from '../combat/hit';
import { end, reflect, segmentHitsCircle, type Projectile, type ProjectileEnd, type ProjectileSystem } from '../combat/projectile';
import type { ParryEffectDef } from '../combat/data/guard';
import type { DamageResult } from '../combat/health';
import type { Circle } from '../world/collision';
import { PLAYER_ID, type AttackerView, type CombatTarget, type DefenderView } from './combat';

/**
 * 飛び道具の命中の解決（ADR-026）。弾そのものの動きは src/combat/projectile.ts、ここは「誰に当たるか・防がれるか」を決める。
 *
 * - 敵の弾 → プレイヤー: 近接の攻撃と同じ防御の判定（guardOutcome）を通る。無敵（回避の無敵フレーム・被弾後）の間はすり抜ける。
 *     パリィ = 弾き返す（撃った敵の方へ、速く・強くして飛ばし直す。ダメージなし）、ガード = 受け止める（削りだけ通って弾は消える）、どちらでもなければ被弾して弾は消える
 * - 弾き返した弾（player の陣営）→ 敵: 最初に当たった敵 1 体に大きなダメージ（反撃と同じ扱い）
 * - プレイヤーの攻撃の判定 → 敵の弾: 振りの範囲に入った弾は斬り落とされて消える（ダメージも弾き返しもなし）
 *
 * 判定には向きの要素がある: ガードは構えの正面から来る攻撃だけを防ぐので、弾の「飛んでくる向き」を攻撃者 → 自分の向きとして渡す。
 */

const _pt = { x: 0, z: 0 };
const _origin: HitOrigin = { x: 0, z: 0, yaw: 0 };
const _circle: Circle = { x: 0, z: 0, r: 0 };

type OnEnd = (p: Projectile, reason: ProjectileEnd) => void;

/** 弾の命中イベント。向きは弾の飛ぶ向き、位置は線分上で相手の中心に最も近い点 */
function eventOf(p: Projectile, attackerId: number, targetId: number): HitEvent {
  return { attackerId, targetId, damage: p.damage, knockback: p.knockback, hitStop: p.hitStop, dirX: p.dirX, dirZ: p.dirZ, x: _pt.x, z: _pt.z };
}

export interface ProjectileHandlers {
  /** プレイヤーに当たった */
  onHit: (ev: HitEvent, p: Projectile, result: DamageResult) => void;
  /** ガードで受け止めた（result は通った削りダメージ） */
  onGuard?: (ev: HitEvent, p: Projectile, result: DamageResult) => void;
  /** パリィで弾き返した（effect は構えごとの演出）。弾は player の陣営になって飛び続ける */
  onParry?: (ev: HitEvent, p: Projectile, effect: ParryEffectDef) => void;
  /** 弾が消えた（命中・ガード・寿命・縁・斬り落とし） */
  onEnd?: OnEnd;
}

/**
 * 敵の弾をプレイヤーへ当てる。毎 sim ステップ（弾を動かしたあと）呼ぶ。新しく当たった弾の数を返す。
 * ownerOf は弾き返す先（撃った敵の体。いなければ null = 飛んできた向きへそのまま返す）
 */
export function resolveProjectilesOnPlayer(
  system: ProjectileSystem,
  victim: DefenderView,
  ownerOf: (id: number) => Circle | null,
  handlers: ProjectileHandlers,
): number {
  let total = 0;
  for (const p of system.pool) {
    if (!p.alive || p.team !== 'enemy') continue;
    if (victim.body.invulnerable) continue; // 回避の無敵フレーム・被弾後の無敵・死亡: すり抜ける（弾は残る）
    if (!segmentHitsCircle(p.prevX, p.prevZ, p.x, p.z, victim.body, p.def.radius, _pt)) continue;
    total++;
    const ev = eventOf(p, p.ownerId, victim.body.id);
    const outcome = victim.guardOutcome?.(ev) ?? 'none';
    if (outcome === 'parry' && victim.parry) {
      const effect = victim.parry(ev);
      // 撃った敵の方へ弾き返す。撃った敵が（もう）いなければ、来た向きへそのまま返す
      let dx = -p.dirX;
      let dz = -p.dirZ;
      const owner = ownerOf(p.ownerId);
      if (owner) {
        const ox = owner.x - p.x;
        const oz = owner.z - p.z;
        const d = Math.hypot(ox, oz);
        if (d > 1e-3) {
          dx = ox / d;
          dz = oz / d;
        }
      }
      reflect(p, dx, dz);
      handlers.onParry?.(ev, p, effect);
    } else if (outcome !== 'none' && victim.guardBlock) {
      const result = victim.guardBlock(ev);
      end(p, 'guard', handlers.onEnd);
      handlers.onGuard?.(ev, p, result);
    } else {
      const result = victim.takeHit(ev);
      end(p, 'hit', handlers.onEnd);
      handlers.onHit(ev, p, result);
    }
  }
  return total;
}

/**
 * 弾き返した弾（player の陣営）を敵へ当てる。弾 1 発につき、飛んだ線分の始点に最も近い（先に当たる）敵 1 体だけ。
 * 倒れている・死んでいる敵（invulnerable）には当たらず、すり抜ける。新しく当たった数を返す
 */
export function resolveReflectedProjectiles<T extends CombatTarget>(
  system: ProjectileSystem,
  targets: readonly T[],
  onHit: (ev: HitEvent, target: T, result: DamageResult, p: Projectile) => void,
  onEnd?: OnEnd,
): number {
  let total = 0;
  for (const p of system.pool) {
    if (!p.alive || p.team !== 'player') continue;
    let best: T | null = null;
    let bestD = Infinity;
    let bx = 0;
    let bz = 0;
    for (const t of targets) {
      if (t.body.invulnerable) continue;
      if (!segmentHitsCircle(p.prevX, p.prevZ, p.x, p.z, t.body, p.def.radius, _pt)) continue;
      const d = Math.hypot(t.body.x - p.prevX, t.body.z - p.prevZ);
      if (d < bestD) {
        best = t;
        bestD = d;
        bx = _pt.x;
        bz = _pt.z;
      }
    }
    if (!best) continue;
    total++;
    _pt.x = bx;
    _pt.z = bz;
    const ev = eventOf(p, PLAYER_ID, best.body.id);
    const result = best.takeHit(ev);
    end(p, 'hit', onEnd);
    onHit(ev, best, result, p);
  }
  return total;
}

/**
 * プレイヤーの攻撃で敵の弾を斬り落とす。攻撃の判定が出ているあいだ毎 sim ステップ呼ぶ（振りの範囲に入った弾が消える）。
 * 弾き返した弾は斬らない。斬り落とした数を返す
 */
export function cutProjectiles(system: ProjectileSystem, attacker: AttackerView, onEnd?: OnEnd): number {
  const atk = attacker.attack;
  if (!atk || !attacker.attackActive) return 0;
  _origin.x = attacker.body.x;
  _origin.z = attacker.body.z;
  _origin.yaw = attacker.yaw;
  let n = 0;
  for (const p of system.pool) {
    if (!p.alive || p.team !== 'enemy') continue;
    _circle.x = p.x;
    _circle.z = p.z;
    _circle.r = p.def.radius;
    if (!hitboxHits(_origin, atk.hitbox, _circle)) continue;
    end(p, 'cut', onEnd);
    n++;
  }
  return n;
}
