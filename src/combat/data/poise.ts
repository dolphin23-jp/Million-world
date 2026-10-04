/**
 * 体勢ゲージ（poise。ADR-027）の数値。重装型の敵は、攻撃を受けてもひるまない（常時スーパーアーマー）代わりに、
 * 受けたダメージで体勢ゲージが減り、0 になると体勢を崩して動けなくなる（反撃のチャンス）。
 * 予備動作・攻撃の最中でも減るので、大技の前に崩せば攻撃を中断させられる。
 */

import type { ParryEffectDef } from './guard';

export interface PoiseDef {
  /** 体勢ゲージの最大値（受けたダメージぶん減る） */
  max: number;
  /** 最後に体勢ダメージを受けてから、回復が始まるまで（sim フレーム） */
  regenDelayFrames: number;
  /** 回復の速さ（1 フレームあたり） */
  regenPerFrame: number;
  /** 体勢を崩したときの反応（弾かれたときと同じ形: 動けない長さ・反撃の窓と倍率・演出） */
  breakEffect: ParryEffectDef;
}

/**
 * 体勢崩し: その場で膝をついて動けない（stagger）。反撃の窓は動けないあいだずっと（1.7 秒）で、ダメージは 1.8 倍・ノックバックは小さい（押し出さず、続けて当てられる）。
 * 終わると体勢ゲージは満タンに戻る。
 */
export const POISE_BREAK: ParryEffectDef = {
  id: 'stagger',
  frames: 100,
  riposteFrames: 100,
  enemyKnockback: 0,
  knockbackFrames: 0,
  hitStop: 12,
  shake: { amp: 0.09, seconds: 0.3 },
  burst: 1.5,
  labelScale: 1.3,
  sfx: 'poiseBreak',
  riposteDamageScale: 1.8,
  riposteKnockbackScale: 0.2,
  recoverCooldownFrames: 40,
};
