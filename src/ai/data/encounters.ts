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
    // 2 波: 暴れ猪（突進型。ADR-025）が初登場。子鬼 1 体を添える
    [
      { type: 'boar', offset: 0, radius: 8.5 },
      { type: 'imp', offset: -0.9, radius: 6.5 },
    ],
    // 3 波（最後）: 猪 + 子鬼 2 体（猪の突進と子鬼の接近戦を同時にさばく）
    [
      { type: 'imp', offset: -0.9, radius: 7 },
      { type: 'boar', offset: 0.1, radius: 8.5 },
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
  { rank: 'S', maxSeconds: 80, maxDamage: 24 },
  { rank: 'A', maxSeconds: 120, maxDamage: 60 },
  { rank: 'B', maxSeconds: 180, maxDamage: 90 },
] as const;
