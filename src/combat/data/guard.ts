/**
 * ガード・パリィ・反撃の数値（ADR-020）。値はすべてここで調整する（実機で「受けやすさ」「弾きやすさ」を見ながら動かす）。
 *
 * ガードは左手の役割（ADR-013）。盾を持つ（sword-shield）とき: 保持で盾を構えて敵の攻撃をほぼ防ぎ、構えに入った直後の短い間は「パリィ」（弾く）。
 * 素手が標準（sword）のとき: 剣を体の前に立てて受ける。軽減は盾より小さく、パリィはない。
 * 構えているあいだは動けない（向きだけ変えられる）。構えの正面から来る攻撃だけを防ぐ（横・背後からは防げない）。
 */

import type { AuthoredAttack } from '../../character/authoring';
import { SHIELD_GUARD, SHIELD_GUARD_HIT, SHIELD_PARRY, SWORD_GUARD, SWORD_GUARD_HIT } from '../../character/data/guard';

export type GuardId = 'sword' | 'shield';

export interface GuardDef {
  id: GuardId;
  /** 構えに入る動き（終端の構えで止まる）、受けた反動、パリィ成功の動き（手付けクリップ。src/character/data/guard.ts） */
  clips: { enter: AuthoredAttack; hit: AuthoredAttack; parry?: AuthoredAttack };
  /** 構えに入ってから、パリィが効く sim フレーム（1 〜 parryFrames）。0 = パリィなし */
  parryFrames: number;
  /** 構えの正面からこの角度（度）以内から来る攻撃を受け止める。外側（横・背後）は防げず、そのまま被弾する */
  coneDeg: number;
  /** 受け止めたときに減らすダメージの割合（0..1）。残りは削りダメージとして通る */
  damageReduction: number;
  /** 受け止めたときのノックバックの倍率（1 = 被弾と同じだけ押される） */
  knockbackScale: number;
  /** 受け止めた直後の硬直（sim フレーム）。そのあいだは構えを解けず、攻撃・回避もできない */
  hitStunFrames: number;
  /** 構えに入ってから、攻撃・回避でキャンセルできるフレーム */
  cancelFrame: number;
  /** 構えを解けるようになるまでの最短フレーム（連打の指でちらつかないように） */
  minHoldFrames: number;
  /** 構えを解いてから、次に構えられるまでのフレーム（構え直しの連打でパリィの受付を開き続けられないように） */
  lockFrames: number;
}

export const GUARDS: Record<GuardId, GuardDef> = {
  shield: {
    id: 'shield',
    clips: { enter: SHIELD_GUARD, hit: SHIELD_GUARD_HIT, parry: SHIELD_PARRY },
    parryFrames: 10,
    coneDeg: 80,
    damageReduction: 0.85,
    knockbackScale: 0.3,
    hitStunFrames: 12,
    cancelFrame: 4,
    minHoldFrames: 8,
    lockFrames: 12,
  },
  sword: {
    id: 'sword',
    clips: { enter: SWORD_GUARD, hit: SWORD_GUARD_HIT },
    parryFrames: 0,
    coneDeg: 60,
    damageReduction: 0.5,
    knockbackScale: 0.6,
    hitStunFrames: 16,
    cancelFrame: 4,
    minHoldFrames: 8,
    lockFrames: 8,
  },
};

/** パリィ（弾く）と、弾かれた敵への反撃 */
export const PARRY = {
  /** 弾かれた敵が体勢を崩すフレーム。そのあいだ敵は動けず、攻撃はひるみに割り込まれず、反撃が通りやすい */
  staggerFrames: 66,
  /** 弾いたときの、敵のノックバック（m）・ヒットストップ（sim フレーム）・画面の揺れ */
  enemyKnockback: 0.7,
  hitStop: 9,
  shake: { amp: 0.05, seconds: 0.2 },
  /** 弾かれた敵（体勢を崩しているあいだ）に当てた攻撃のダメージ倍率（反撃）。ノックバックは倍率を掛けて小さくする（遠くへ飛ばさず、続けて当てられるように） */
  riposteDamageScale: 2,
  riposteKnockbackScale: 0.5,
  /** 体勢を崩したあと、敵が次の予備動作に入れるまでの待ち（sim フレーム） */
  recoverCooldownFrames: 30,
} as const;

/** ガードで受け止めたときの演出（パリィの演出は PARRY） */
export const GUARD_FEEDBACK = {
  /** ヒットストップ（sim フレーム）と画面の揺れ。被弾より小さく、受け止めた手応えだけを出す */
  hitStop: 4,
  shake: { amp: 0.03, seconds: 0.12 },
} as const;
