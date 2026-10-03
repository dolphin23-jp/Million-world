/**
 * ガード・パリィ・反撃の数値（ADR-020）。値はすべてここで調整する（実機で「受けやすさ」「弾きやすさ」を見ながら動かす）。
 *
 * ガードは左手の役割（ADR-013）。盾を持つ（sword-shield）とき: 保持で盾を構えて敵の攻撃をほぼ防ぎ、構えに入った直後の短い間は「パリィ」（弾く）。
 * 素手が標準（sword）のとき: 剣を体の前に立てて受ける。軽減は盾より小さく、パリィはない。
 * 大剣（greatsword）: 両手で剣を体の前に立てて受ける。盾がなくてもパリィができる（受付は盾より短い = シビア）。弾かれた敵は盾のときと違って弾き飛ばされて倒れる（PARRY_EFFECTS.down）。
 * 受け止めるだけのときの軽減は盾より小さいので、失敗すると痛い。
 * 構えているあいだは動けない（向きだけ変えられる）。構えの正面から来る攻撃だけを防ぐ（横・背後からは防げない）。
 */

import type { AuthoredAttack } from '../../character/authoring';
import { SHIELD_GUARD, SHIELD_GUARD_HIT, SHIELD_PARRY, SWORD_GUARD, SWORD_GUARD_HIT } from '../../character/data/guard';
import { GS_GUARD, GS_GUARD_HIT, GS_PARRY } from '../../character/data/gs-guard';

export type GuardId = 'sword' | 'shield' | 'greatsword';

export interface GuardDef {
  id: GuardId;
  /** 構えに入る動き（終端の構えで止まる）、受けた反動、パリィ成功の動き（手付けクリップ。src/character/data/guard.ts） */
  clips: { enter: AuthoredAttack; hit: AuthoredAttack; parry?: AuthoredAttack };
  /** 構えに入ってから、パリィが効く sim フレーム（1 〜 parryFrames）。0 = パリィなし */
  parryFrames: number;
  /** パリィが決まったときの、弾かれた敵の反応（PARRY_EFFECTS のキー）。パリィのない構えでは使わない */
  parryEffect: ParryEffectId;
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
    parryEffect: 'stagger',
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
    parryEffect: 'stagger',
    coneDeg: 60,
    damageReduction: 0.5,
    knockbackScale: 0.6,
    hitStunFrames: 16,
    cancelFrame: 4,
    minHoldFrames: 8,
    lockFrames: 8,
  },
  // 大剣: 受付 6f（0.1 秒。盾の 10f より短い）で、構えの動き（0.1 秒）と同時に終わる。軽減は 65%（盾 85%・素手 50% の間）、受けた硬直は長め、構え直しも遅い（14f）
  greatsword: {
    id: 'greatsword',
    clips: { enter: GS_GUARD, hit: GS_GUARD_HIT, parry: GS_PARRY },
    parryFrames: 6,
    parryEffect: 'down',
    coneDeg: 70,
    damageReduction: 0.65,
    knockbackScale: 0.5,
    hitStunFrames: 14,
    cancelFrame: 4,
    minHoldFrames: 8,
    lockFrames: 14,
  },
};

/**
 * 弾かれた敵の反応の種類（パリィの「効果」）。構えごとに違う（GuardDef.parryEffect）。
 *  - stagger（盾）: その場でのけぞって体勢を崩す。立ったまま動けず、少ししか離れない。反撃は近距離で連続して入れられる
 *  - down（大剣）: 大きく弾き飛ばされて倒れる。起き上がるまで長く動けず、反撃の倍率も大きいが、離れた所に倒れるので踏み込みが要る
 * 敵の状態は同名（Enemy の 'stagger' / 'down'）。
 */
export type ParryEffectId = 'stagger' | 'down';

export interface ParryEffectDef {
  id: ParryEffectId;
  /** 敵が動けないフレーム。stateFrame がこれに達した次の step で追跡へ戻る。そのあいだ予備動作も攻撃もしない（スーパーアーマーも関係なく割り込まれない） */
  frames: number;
  /** 弾いた直後から stateFrame がこの値になるまでに当てた攻撃が反撃（ダメージ・ノックバックに倍率）。frames より短ければ、立て直し・起き上がりの終わりは通常のダメージ */
  riposteFrames: number;
  /** 弾いたときの敵のノックバック（m）と押されるフレーム数（0 = 敵ごとの knockbackFrames） */
  enemyKnockback: number;
  knockbackFrames: number;
  /** 弾いた瞬間の演出: ヒットストップ（sim フレーム）・画面の揺れ・命中の閃光の強さ */
  hitStop: number;
  shake: { amp: number; seconds: number };
  burst: number;
  /** 反撃のダメージ倍率。ノックバックの倍率は小さくして、遠くへ飛ばさず続けて当てられるようにする */
  riposteDamageScale: number;
  riposteKnockbackScale: number;
  /** 立て直し・起き上がったあと、次の予備動作に入れるまでの待ち（sim フレーム） */
  recoverCooldownFrames: number;
}

export const PARRY_EFFECTS: Record<ParryEffectId, ParryEffectDef> = {
  stagger: {
    id: 'stagger',
    frames: 66,
    riposteFrames: 66,
    enemyKnockback: 0.7,
    knockbackFrames: 0,
    hitStop: 9,
    shake: { amp: 0.05, seconds: 0.2 },
    burst: 1.2,
    riposteDamageScale: 2,
    riposteKnockbackScale: 0.5,
    recoverCooldownFrames: 30,
  },
  down: {
    id: 'down',
    // 倒れる（約 0.25 秒）→ 倒れたまま → 起き上がる（最後の 26f）。起き上がりの途中は無防備だが、反撃の倍率は付かない
    frames: 112,
    riposteFrames: 86,
    // 3m 近く弾き飛ばされる（22f かけて滑る）。反撃は踏み込みの長い技（突き・ロール直後の跳び込み）で届く
    enemyKnockback: 2.6,
    knockbackFrames: 22,
    hitStop: 14,
    shake: { amp: 0.1, seconds: 0.32 },
    burst: 1.7,
    riposteDamageScale: 2.4,
    riposteKnockbackScale: 0.15,
    recoverCooldownFrames: 50,
  },
};

/** ガードで受け止めたときの演出（パリィの演出は PARRY_EFFECTS） */
export const GUARD_FEEDBACK = {
  /** ヒットストップ（sim フレーム）と画面の揺れ。被弾より小さく、受け止めた手応えだけを出す */
  hitStop: 4,
  shake: { amp: 0.03, seconds: 0.12 },
} as const;
