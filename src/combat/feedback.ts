import { clamp } from '../core/math';
import { CRIT } from './data/crit';
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
  /** 会心の命中か（ダメージ数字・音・エフェクトを会心の見た目にする。ADR-035） */
  crit: boolean;
}

export function hitFeedback(ev: Pick<HitEvent, 'damage' | 'hitStop' | 'crit'>, killed: boolean): HitFeedback {
  const f = HIT_FEEDBACK;
  const crit = ev.crit === true;
  const shake = f.shake.base + f.shake.perDamage * ev.damage;
  return {
    hitStop: ev.hitStop + (killed ? f.killExtraHitStop : 0),
    shakeAmp: shake * (killed ? f.shake.killScale : 1) * (crit ? CRIT.shakeScale : 1),
    shakeSeconds: f.shakeSeconds.base + f.shakeSeconds.perDamage * ev.damage,
    power: clamp((ev.damage / f.power.damage) * (crit ? CRIT.powerScale : 1), f.power.min, f.power.max * (crit ? CRIT.powerScale : 1)),
    style: killed ? 'kill' : ev.damage >= f.heavyDamage ? 'heavy' : 'light',
    crit,
  };
}
