/**
 * 戦闘の構成（M3 デモ）。ウェーブ（敵の出し方）と、リザルトの評価。数値はここで調整する。
 * 時間は sim フレーム（60Hz）、距離は m。
 */

import type { ENEMIES } from './enemies';

export interface WaveEnemy {
  type: keyof typeof ENEMIES;
  /**
   * 出る向き。「プレイヤーから見てアリーナの中心の向こう側」を 0 として、そこからの角度（rad。正は反時計回り）。
   * プレイヤーが中心にいるときは +Z の側が 0。敵が 2 体以上のときは offset を変えて散らす
   */
  offset: number;
  /** アリーナの中心からの距離（m） */
  radius: number;
}

export interface EncounterDef {
  waves: readonly (readonly WaveEnemy[])[];
  /** ウェーブを全滅させてから、次のウェーブが出るまで */
  waveGapFrames: number;
  /** 最後のウェーブを全滅させてから、リザルトが出るまで（とどめのスローモーションを見せる間） */
  victoryDelayFrames: number;
  /** プレイヤーが倒れてから、リザルトが出るまで */
  defeatDelayFrames: number;
  /** 同時に予備動作〜攻撃に入れる敵の数（攻撃権）。残りは近くで構えて待つ */
  maxAttackers: number;
}

export const DEMO_ENCOUNTER: EncounterDef = {
  waves: [
    // 1 波: 2 体を左右に散らして
    [
      { type: 'imp', offset: -0.55, radius: 6.5 },
      { type: 'imp', offset: 0.55, radius: 6.5 },
    ],
    // 2 波: 暴れ猪（突進型。ADR-025）と提灯（遠距離型。ADR-026）が初登場。猪の突進を避けながら、遠くの鬼火にも気を配る
    [
      { type: 'boar', offset: 0.35, radius: 8.5 },
      { type: 'lantern', offset: -0.5, radius: 9 },
    ],
    // 3 波（最後）: 子鬼 2 体 + 猪 + 提灯（接近戦・突進・鬼火を同時にさばく。提灯を先に落とすか、鬼火を弾き返して減らす）
    [
      { type: 'imp', offset: -0.9, radius: 7 },
      { type: 'boar', offset: 0.1, radius: 8.5 },
      { type: 'lantern', offset: 0.55, radius: 9.5 },
      { type: 'imp', offset: 0.9, radius: 7 },
    ],
  ],
  waveGapFrames: 100,
  victoryDelayFrames: 75,
  defeatDelayFrames: 150,
  maxAttackers: 2,
};

/** 評価（上から順に、両方の条件を満たす最初のランク。どれも満たさなければ C）。時間は秒、ダメージは被ダメージの合計 */
export const RANKS = [
  { rank: 'S', maxSeconds: 90, maxDamage: 24 },
  { rank: 'A', maxSeconds: 130, maxDamage: 60 },
  { rank: 'B', maxSeconds: 190, maxDamage: 90 },
] as const;
