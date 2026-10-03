import { clamp } from '../core/math';
import { HIT_FEEDBACK } from './data/hit-feedback';
import type { HitEvent } from './hit';

/**
 * 命中の演出の決定（純粋関数）。命中の結果（HitEvent）ととどめかどうかから、
 * ヒットストップ・画面の揺れ・エフェクトの強さ・ダメージ数字の見た目を求める。実際の表示は Game が各部へ渡す。
 */

export type HitStyle = 'light' | 'heavy' | 'kill';

export interface HitFeedback {
  /** ヒットストップ（sim フレーム） */
  hitStop: number;
  /** 画面の揺れの強さ（m）と長さ（秒） */
  shakeAmp: number;
  shakeSeconds: number;
  /** エフェクトの強さ（0.3〜1.2。1 でおよそダメージ 40 相当） */
  power: number;
  style: HitStyle;
}

export function hitFeedback(ev: Pick<HitEvent, 'damage' | 'hitStop'>, killed: boolean): HitFeedback {
  const f = HIT_FEEDBACK;
  const shake = f.shake.base + f.shake.perDamage * ev.damage;
  return {
    hitStop: ev.hitStop + (killed ? f.killExtraHitStop : 0),
    shakeAmp: shake * (killed ? f.shake.killScale : 1),
    shakeSeconds: f.shakeSeconds.base + f.shakeSeconds.perDamage * ev.damage,
    power: clamp(ev.damage / f.power.damage, f.power.min, f.power.max),
    style: killed ? 'kill' : ev.damage >= f.heavyDamage ? 'heavy' : 'light',
  };
}
