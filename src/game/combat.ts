import type { AttackDef } from '../combat/data/attacks';
import type { DamageResult } from '../combat/health';
import { collectHits, makeHitEvent, type HitEvent, type HitOrigin, type HitTracker, type Hurtbox } from '../combat/hit';
import type { EnemyAttackDef } from '../ai/data/enemies';
import type { Circle } from '../world/collision';

/**
 * プレイヤーの攻撃を敵へ当てる（ADR-014）。持続フレームのあいだ毎 sim ステップ呼ぶ。
 * 当たった対象に takeHit を呼び、onHit で演出（ヒットストップ・フラッシュ・シェイク・ダメージ数字）を起こす側へ知らせる。
 */

export const PLAYER_ID = 0;

/** 攻撃側として読む Player の部分（テストで本物の Player を使えるよう、必要な口だけを型にする） */
export interface AttackerView {
  readonly attackActive: boolean;
  readonly attack: AttackDef | null;
  readonly body: Circle;
  readonly yaw: number;
  readonly hitTracker: HitTracker;
}

export interface CombatTarget {
  readonly body: Hurtbox;
  takeHit(ev: HitEvent): DamageResult;
}

const _origin: HitOrigin = { x: 0, z: 0, yaw: 0 };
const _boxes: Hurtbox[] = [];
const _hit: Hurtbox[] = [];

/** 新しく当たった数を返す */
export function resolvePlayerAttack<T extends CombatTarget>(
  attacker: AttackerView,
  targets: readonly T[],
  onHit: (ev: HitEvent, target: T, result: DamageResult) => void,
): number {
  const atk = attacker.attack;
  if (!atk || !attacker.attackActive) return 0;
  _origin.x = attacker.body.x;
  _origin.z = attacker.body.z;
  _origin.yaw = attacker.yaw;
  _boxes.length = 0;
  _hit.length = 0;
  for (const t of targets) _boxes.push(t.body);
  const n = collectHits(_origin, atk.hitbox, _boxes, attacker.hitTracker, _hit);
  for (const box of _hit) {
    const target = targets.find((t) => t.body === box);
    if (!target) continue;
    const ev = makeHitEvent(PLAYER_ID, _origin, box, atk);
    const result = target.takeHit(ev);
    onHit(ev, target, result);
  }
  return n;
}

/** 攻撃側として読む敵の部分（Enemy がそのまま満たす） */
export interface EnemyAttackerView {
  readonly id: number;
  readonly attackActive: boolean;
  readonly attackDef: EnemyAttackDef;
  readonly body: Circle;
  readonly yaw: number;
  readonly hitTracker: HitTracker;
}

/**
 * 敵の攻撃をプレイヤーへ当てる。判定が出ているフレームごとに呼ぶ。
 * 無敵（回避の無敵フレーム・被弾後の無敵・死亡）の間は当たらず、記録もしない（無敵が切れて持続が残っていれば当たる）。
 * 新しく当たった数を返す。
 */
export function resolveEnemyAttacks<E extends EnemyAttackerView>(
  enemies: readonly E[],
  victim: CombatTarget,
  onHit: (ev: HitEvent, enemy: E, result: DamageResult) => void,
): number {
  let total = 0;
  for (const enemy of enemies) {
    if (!enemy.attackActive) continue;
    _origin.x = enemy.body.x;
    _origin.z = enemy.body.z;
    _origin.yaw = enemy.yaw;
    _boxes.length = 0;
    _hit.length = 0;
    _boxes.push(victim.body);
    const atk = enemy.attackDef;
    if (collectHits(_origin, atk.hitbox, _boxes, enemy.hitTracker, _hit) === 0) continue;
    total++;
    const ev = makeHitEvent(enemy.id, _origin, victim.body, atk);
    onHit(ev, enemy, victim.takeHit(ev));
  }
  return total;
}
