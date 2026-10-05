import type { HazardType } from '../../world/world';

/**
 * 床の危険地帯（M7-4e。ADR-046）の数値。手触りの調整はここだけを触る。
 *
 * 危険地帯（World の HazardDef。炎の床）の中に、足が低いあいだ（World.HAZARD_TOP 以下）いると、tickFrames ごとに継続ダメージを受ける。
 * 跳んで（足が HAZARD_TOP を超える）越えれば受けない。回避の無敵（ロール）の最中も受けない。ひるまず、攻撃・回避・ガードはそのまま続けられる（ダメージだけ）。
 * 歩く敵も同じように燃える（敵の ダメージは playerDamage とは別）。飛ぶ敵（小蝙蝠）は燃えない。
 */
export interface HazardRule {
  name: string;
  /** ダメージを与える間隔（sim フレーム） */
  tickFrames: number;
  /** 1 回に受けるダメージ: プレイヤー（防御の軽減を受ける）・敵 */
  playerDamage: number;
  enemyDamage: number;
}

export const HAZARD_RULES: Record<HazardType, HazardRule> = {
  fire: { name: '炎の床', tickFrames: 30, playerDamage: 5, enemyDamage: 8 },
};
