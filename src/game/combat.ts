import type { AttackDef } from '../combat/data/attacks';
import { PARRY } from '../combat/data/guard';
import type { GuardOutcome } from '../combat/guard';
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
  /** いまの攻撃の威力の倍率（溜めの段階。1 = 等倍）。ダメージ・ノックバック・ヒットストップに掛かる */
  readonly attackPower: number;
  readonly body: Circle;
  readonly yaw: number;
  readonly hitTracker: HitTracker;
}

export interface CombatTarget {
  readonly body: Hurtbox;
  takeHit(ev: HitEvent): DamageResult;
  /** パリィで弾かれて体勢を崩している間は true。その間に当てた攻撃は反撃（ダメージが PARRY.riposteDamageScale 倍） */
  readonly vulnerable?: boolean;
}

/** 防御できる被弾側（Player）。敵の攻撃が当たる瞬間に、まず guardOutcome で防御の結果を聞く（ADR-020） */
export interface DefenderView extends CombatTarget {
  guardOutcome?(ev: HitEvent): GuardOutcome;
  /** ガードで受け止める（軽減したダメージを適用して構えを保つ） */
  guardBlock?(ev: HitEvent): DamageResult;
  /** パリィ成功（ダメージなし） */
  parry?(ev: HitEvent): void;
}

const _origin: HitOrigin = { x: 0, z: 0, yaw: 0 };
const _boxes: Hurtbox[] = [];
const _hit: Hurtbox[] = [];

/** 新しく当たった数を返す */
export function resolvePlayerAttack<T extends CombatTarget>(
  attacker: AttackerView,
  targets: readonly T[],
  /** riposte: 弾かれて体勢を崩している敵への攻撃（反撃）か */
  onHit: (ev: HitEvent, target: T, result: DamageResult, riposte: boolean) => void,
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
    const p = attacker.attackPower;
    // 弾かれて体勢を崩している敵への攻撃は反撃: ダメージが大きく、ノックバックは小さい（遠くへ飛ばさず、続けて当てられる）
    const riposte = target.vulnerable === true;
    const ev = makeHitEvent(PLAYER_ID, _origin, box, {
      damage: Math.round(atk.damage * p * (riposte ? PARRY.riposteDamageScale : 1)),
      // ノックバックは威力の半分だけ倍率を掛ける（吹き飛びすぎない）。ヒットストップは威力に比例して伸びる
      knockback: atk.knockback * (1 + (p - 1) * 0.5) * (riposte ? PARRY.riposteKnockbackScale : 1),
      hitStop: Math.round(atk.hitStop * p),
    });
    const result = target.takeHit(ev);
    onHit(ev, target, result, riposte);
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
  /** パリィで弾かれた（体勢を崩す）。なければパリィは通常のガードになる */
  parried?(ev: HitEvent): void;
}

/** 敵の攻撃を防がれたときの通知（演出用）。ガード = 受け止めた（result は通った削りダメージ）、パリィ = 弾いた */
export interface EnemyAttackHandlers<E> {
  onGuard?: (ev: HitEvent, enemy: E, result: DamageResult) => void;
  onParry?: (ev: HitEvent, enemy: E) => void;
}

/**
 * 敵の攻撃をプレイヤーへ当てる。判定が出ているフレームごとに呼ぶ。
 * 無敵（回避の無敵フレーム・被弾後の無敵・死亡）の間は当たらず、記録もしない（無敵が切れて持続が残っていれば当たる）。
 * 新しく当たった数を返す。
 */
export function resolveEnemyAttacks<E extends EnemyAttackerView>(
  enemies: readonly E[],
  victim: DefenderView,
  onHit: (ev: HitEvent, enemy: E, result: DamageResult) => void,
  handlers: EnemyAttackHandlers<E> = {},
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
    // 防御: 構えの正面からの攻撃は、パリィなら弾き（ダメージなし・敵が体勢を崩す）、ガードなら軽減して受け止める（ADR-020）
    const outcome = victim.guardOutcome?.(ev) ?? 'none';
    if (outcome === 'parry' && victim.parry && enemy.parried) {
      victim.parry(ev);
      enemy.parried(ev);
      handlers.onParry?.(ev, enemy);
    } else if (outcome !== 'none' && victim.guardBlock) {
      handlers.onGuard?.(ev, enemy, victim.guardBlock(ev));
    } else {
      onHit(ev, enemy, victim.takeHit(ev));
    }
  }
  return total;
}
