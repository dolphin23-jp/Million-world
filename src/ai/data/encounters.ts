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
  /**
   * 同時に予備動作〜攻撃に入れる敵の数の予算（攻撃権）。敵ごとの重み（EnemyDef.attackWeight。既定 1）の合計がこの値以下になるまで。残りは近くで構えて待つ。
   * 群れの小さな敵は重みが小さく、予算の中で数体が同時に襲える（ADR-028）
   */
  maxAttackers: number;
}

export const DEMO_ENCOUNTER: EncounterDef = {
  waves: [
    // 1 波: 2 体を左右に散らして
    [
      { type: 'imp', offset: -0.55, radius: 6.5 },
      { type: 'imp', offset: 0.55, radius: 6.5 },
    ],
    // 2 波: 小蝙蝠の群れ（小型の群れ。ADR-028）が初登場。6 体が周りを回って囲み、数体ずつ噛みつきに来る。大剣・回転斬りの薙ぎ払いが気持ちいい波
    [
      { type: 'bat', offset: -1.2, radius: 8 },
      { type: 'bat', offset: -0.7, radius: 9 },
      { type: 'bat', offset: -0.25, radius: 8 },
      { type: 'bat', offset: 0.25, radius: 9 },
      { type: 'bat', offset: 0.7, radius: 8 },
      { type: 'bat', offset: 1.2, radius: 9 },
    ],
    // 3 波: 暴れ猪（突進型。ADR-025）と提灯（遠距離型。ADR-026）が初登場。猪の突進を避けながら、遠くの鬼火にも気を配る
    [
      { type: 'boar', offset: 0.35, radius: 8.5 },
      { type: 'lantern', offset: -0.5, radius: 9 },
    ],
    // 4 波: 岩鬼（重装型。ADR-027）が初登場。ガード不能の地ならしと体勢ゲージを、子鬼 2 体を添えて試す（子鬼を相手にしながら岩鬼の円を見る）
    [
      { type: 'ogre', offset: 0, radius: 8.5 },
      { type: 'imp', offset: -1.0, radius: 7 },
      { type: 'imp', offset: 1.0, radius: 7 },
    ],
    // 5 波（最後）: 子鬼 + 猪 + 提灯 + 小蝙蝠 4（接近戦・突進・鬼火・群れを同時にさばく。提灯を先に落とすか、鬼火を弾き返して減らす）
    [
      { type: 'imp', offset: -0.9, radius: 7 },
      { type: 'boar', offset: 0.1, radius: 8.5 },
      { type: 'lantern', offset: 0.55, radius: 9.5 },
      { type: 'bat', offset: -0.5, radius: 8 },
      { type: 'bat', offset: 0.2, radius: 9 },
      { type: 'bat', offset: 0.9, radius: 8 },
      { type: 'bat', offset: 1.4, radius: 9 },
    ],
  ],
  waveGapFrames: 100,
  victoryDelayFrames: 75,
  defeatDelayFrames: 150,
  maxAttackers: 2,
};

/** 評価（上から順に、両方の条件を満たす最初のランク。どれも満たさなければ C）。時間は秒、ダメージは被ダメージの合計 */
export const RANKS = [
  { rank: 'S', maxSeconds: 160, maxDamage: 30 },
  { rank: 'A', maxSeconds: 220, maxDamage: 70 },
  { rank: 'B', maxSeconds: 300, maxDamage: 100 },
] as const;
