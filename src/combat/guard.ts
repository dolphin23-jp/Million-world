import { angleDelta } from '../core/math';
import type { GuardDef } from './data/guard';

/**
 * ガードの判定（純粋関数。ADR-020）。敵の攻撃が当たる瞬間に、構えの向き・構えに入ってからの経過で
 * 「パリィ（弾く）/ ガード（受け止める）/ 防げない」を決める。three にも DOM にも依存しない。
 */

export type GuardOutcome = 'none' | 'guard' | 'parry';

/**
 * 構えている（def）プレイヤーが、攻撃者から来る攻撃（dirX, dirZ = 攻撃者 → 自分の単位ベクトル）をどう受けるか。
 *  - 構えの正面から coneDeg 以内（攻撃者のいる向きが yaw の前方）でなければ防げない（横・背後からは被弾）
 *  - 構えに入ってから parryFrames（+ parryBonus = DEX による加算）以内（frame は 1 から数える。構えに入った step が 1）ならパリィ（parryFrames = 0 はパリィなし）
 *  - それ以外は受け止める
 */
export function guardOutcome(def: GuardDef, frame: number, yaw: number, dirX: number, dirZ: number, parryBonus = 0): GuardOutcome {
  const toAttacker = Math.atan2(-dirX, -dirZ);
  if (Math.abs(angleDelta(yaw, toAttacker)) > (def.coneDeg * Math.PI) / 180) return 'none';
  if (def.parryFrames > 0 && frame >= 1 && frame <= def.parryFrames + parryBonus) return 'parry';
  return 'guard';
}

/** 受け止めたときに通る削りダメージ。ダメージのある攻撃は、どれだけ軽減しても最低 1 は通る */
export function guardedDamage(damage: number, def: GuardDef): number {
  if (damage <= 0) return 0;
  return Math.max(1, Math.round(damage * (1 - def.damageReduction)));
}
