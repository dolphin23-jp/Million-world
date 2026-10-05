import type { AttackDef, ResolvedWindow } from '../combat/data/attacks';
import { CRIT } from '../combat/data/crit';
import { HIT_FEEDBACK } from '../combat/data/hit-feedback';
import type { ParryEffectDef } from '../combat/data/guard';
import type { GuardOutcome } from '../combat/guard';
import type { DamageResult } from '../combat/health';
import { collectHits, hitboxHits, makeHitEvent, type HitEvent, type HitOrigin, type HitTracker, type Hurtbox } from '../combat/hit';
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
  /** 多段ヒットの技（AttackDef.windows）でいま当たりが出ている窓。窓の無い攻撃では null / 省略（AttackDef の当たりを使う） */
  readonly hitWindow?: ResolvedWindow | null;
  /** いまの攻撃の威力の倍率（溜めの段階。1 = 等倍）。ダメージ・ノックバック・ヒットストップに掛かる */
  readonly attackPower: number;
  /** ダメージ・ノックバックの倍率（STR。Modifiers。省略 = 等倍） */
  readonly damageMul?: number;
  readonly knockbackMul?: number;
  /** 会心率（0..1）と会心ダメージの倍率（DEX・パッシブ。Modifiers。省略 = 会心しない）。命中 1 回ごとに抽選する */
  readonly critRate?: number;
  readonly critDamage?: number;
  /** 連携・剣技の 3 発目以降のダメージの倍率（パッシブ。いまの攻撃が 3 発目以降なら > 1、それ以外は 1）・反撃のダメージの倍率（パッシブ。省略 = 等倍。ADR-037） */
  readonly comboMul?: number;
  readonly riposteMul?: number;
  readonly body: Circle;
  readonly yaw: number;
  readonly hitTracker: HitTracker;
}

/** 反撃のときに攻撃へ掛ける倍率（ParryEffectDef がそのまま満たす） */
export interface RiposteScale {
  readonly riposteDamageScale: number;
  readonly riposteKnockbackScale: number;
}

export interface CombatTarget {
  readonly body: Hurtbox;
  takeHit(ev: HitEvent): DamageResult;
  /** パリィで弾かれて動けない間（stagger・down の反撃の受付中）はその倍率。その間に当てた攻撃は反撃（ダメージが大きく、ノックバックは小さい） */
  readonly riposte?: RiposteScale | null;
}

/** 防御できる被弾側（Player）。敵の攻撃が当たる瞬間に、まず guardOutcome で防御の結果を聞く（ADR-020） */
export interface DefenderView extends CombatTarget {
  /** 足の高さ（m。地面 = 0。ジャンプ・障害物の上に乗っているとき）。弾の高さより上なら、弾は下を通る（M7-2。ADR-040）。省略 = 0 */
  readonly y?: number;
  /** 回避の無敵が敵の攻撃を避けさせている最中か（ほかの無敵の理由がない）。ジャスト回避の判定（ADR-030） */
  readonly dodging?: boolean;
  /** ミスティカルドッジの最中か（無敵）。この間に重なった攻撃も「避けた」ものとして記録する（切れたあとに刺さらない） */
  readonly evading?: boolean;
  guardOutcome?(ev: HitEvent): GuardOutcome;
  /** ガードで受け止める（軽減したダメージを適用して構えを保つ） */
  guardBlock?(ev: HitEvent): DamageResult;
  /** パリィ成功（ダメージなし）。弾かれた敵の反応（構えごとの PARRY_EFFECTS）を返す */
  parry?(ev: HitEvent): ParryEffectDef;
}

const _origin: HitOrigin = { x: 0, z: 0, yaw: 0 };
const _boxes: Hurtbox[] = [];
const _hit: Hurtbox[] = [];

/** 抽選の乱数の既定: 会心しない（1 は常に会心率より大きい）。テストの結果が乱数で揺れないように。ゲームは Math.random 相当を渡す */
export const NEVER_CRIT = (): number => 1;

/**
 * 新しく当たった数を返す。会心は命中 1 回ごとに rng（0 以上 1 未満）で抽選する: rng() < 会心率 なら会心。
 * 会心はダメージに会心ダメージの倍率が掛かり、ノックバック・ヒットストップが少し増える（ADR-035）
 */
export function resolvePlayerAttack<T extends CombatTarget>(
  attacker: AttackerView,
  targets: readonly T[],
  /** riposte: 弾かれて体勢を崩している敵への攻撃（反撃）か */
  onHit: (ev: HitEvent, target: T, result: DamageResult, riposte: boolean) => void,
  rng: () => number = NEVER_CRIT,
): number {
  const atk = attacker.attack;
  if (!atk || !attacker.attackActive) return 0;
  const win = attacker.hitWindow?.def;
  _origin.x = attacker.body.x;
  _origin.z = attacker.body.z;
  _origin.yaw = attacker.yaw + (win?.yawOffset ?? 0);
  _boxes.length = 0;
  _hit.length = 0;
  for (const t of targets) _boxes.push(t.body);
  const n = collectHits(_origin, win?.hitbox ?? atk.hitbox, _boxes, attacker.hitTracker, _hit);
  for (const box of _hit) {
    const target = targets.find((t) => t.body === box);
    if (!target) continue;
    const p = attacker.attackPower;
    // 弾かれて動けない敵への攻撃は反撃: ダメージが大きく、ノックバックは小さい（遠くへ飛ばさず、続けて当てられる）
    const riposte = target.riposte ?? null;
    const rate = attacker.critRate ?? 0;
    const crit = rate > 0 && rng() < rate;
    const ev = makeHitEvent(PLAYER_ID, _origin, box, {
      damage: Math.round(atk.damage * (win?.damageScale ?? 1) * p * (attacker.damageMul ?? 1) * (attacker.comboMul ?? 1) * (riposte ? riposte.riposteDamageScale * (attacker.riposteMul ?? 1) : 1) * (crit ? attacker.critDamage ?? CRIT.baseDamage : 1)),
      // ノックバックは威力の半分だけ倍率を掛ける（吹き飛びすぎない）。ヒットストップは威力に比例して伸びる
      knockback: atk.knockback * (win?.knockbackScale ?? 1) * (1 + (p - 1) * 0.5) * (attacker.knockbackMul ?? 1) * (riposte ? riposte.riposteKnockbackScale : 1) * (crit ? CRIT.knockbackScale : 1),
      hitStop: Math.min(Math.round(atk.hitStop * (win?.hitStopScale ?? 1) * p) + (crit ? CRIT.hitStopBonus : 0), HIT_FEEDBACK.maxHitStop),
      crit,
    });
    const result = target.takeHit(ev);
    onHit(ev, target, result, riposte !== null);
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
  /** パリィで弾かれた（effect の反応: 体勢を崩す・倒れる）。なければパリィは通常のガードになる */
  parried?(ev: HitEvent, effect: ParryEffectDef): void;
}

/** 敵の攻撃を防がれたときの通知（演出用）。ガード = 受け止めた（result は通った削りダメージ）、パリィ = 弾いた */
export interface EnemyAttackHandlers<E> {
  onGuard?: (ev: HitEvent, enemy: E, result: DamageResult) => void;
  onParry?: (ev: HitEvent, enemy: E, effect: ParryEffectDef) => void;
  /**
   * 回避の無敵フレームで避けた（無敵がなければ当たっていた）。ジャスト回避（ミスティカルドッジ。ADR-030）の合図。
   * 戻り値が true（ミスティカルが発動した・発動中）なら、避けた攻撃は記録され、持続が残っていてももう当たらない
   * （ミスティカルが切れたあとに、遅い時間の中で止まっていた攻撃が刺さらない）
   */
  onJustDodge?: (enemy: E) => boolean;
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
    if (victim.body.invulnerable) {
      // 無敵の間は当たらず、記録もしない（無敵が切れて持続が残っていれば当たる）。ただし回避の無敵で避けたなら、ジャスト回避の合図を出す
      if ((victim.dodging || victim.evading) && !enemy.hitTracker.has(victim.body.id) && hitboxHits(_origin, atk.hitbox, victim.body) && handlers.onJustDodge?.(enemy)) {
        enemy.hitTracker.add(victim.body.id);
      }
      continue;
    }
    if (collectHits(_origin, atk.hitbox, _boxes, enemy.hitTracker, _hit) === 0) continue;
    total++;
    const ev = makeHitEvent(enemy.id, _origin, victim.body, atk);
    // 防御: 構えの正面からの攻撃は、パリィなら弾き（ダメージなし・敵が体勢を崩す）、ガードなら軽減して受け止める（ADR-020）。
    // ガード不能の攻撃（ADR-027）は構えていても被弾する
    const outcome = atk.unblockable ? 'none' : (victim.guardOutcome?.(ev) ?? 'none');
    if (outcome === 'parry' && victim.parry && enemy.parried) {
      const effect = victim.parry(ev);
      enemy.parried(ev, effect);
      handlers.onParry?.(ev, enemy, effect);
    } else if (outcome !== 'none' && victim.guardBlock) {
      handlers.onGuard?.(ev, enemy, victim.guardBlock(ev));
    } else {
      onHit(ev, enemy, victim.takeHit(ev));
    }
  }
  return total;
}
