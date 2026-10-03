/**
 * 敵の数値（ADR-014）。コードに埋め込まずここで調整する。
 * 時間は sim フレーム（60Hz）、距離は m。
 */

import { type HitboxDef } from '../../combat/hit';

const deg = (d: number) => (d * Math.PI) / 180;

/** 敵の攻撃 1 種。待機/追跡から windup（予備動作 = テレグラフ）→ attack（発生 + 持続）→ recover（硬直）と進む */
export interface EnemyAttackDef {
  /** 予備動作を始める距離（敵の中心からプレイヤーの中心まで、m）以内 */
  range: number;
  /** 予備動作のフレーム数。プレイヤーが見て避けられる長さ（0.5 秒前後）にする */
  windupFrames: number;
  /** 予備動作のうち、プレイヤーの方を向き続けるフレーム数（そのあとは向きを固定する = 横へ動けば避けられる） */
  windupTrackFrames: number;
  /**
   * スーパーアーマー: 予備動作のこのフレーム以降から攻撃が終わるまで、弱い攻撃ではひるまない（ダメージは通り、ノックバックは armorKnockbackScale 倍）。
   * 弱攻撃の連打で敵が一度も攻撃できなくなる（連続ひるみ）のを防ぎ、攻撃を続けるか回避で避けるかの選択を作る。
   * ダメージが armorBreakDamage 以上の攻撃（重撃）は割り込める
   */
  armorFromFrame: number;
  armorBreakDamage: number;
  armorKnockbackScale: number;
  /** 攻撃に入ってから判定が出るまで、判定が出ているフレーム数、判定が終わってからの硬直 */
  startupFrames: number;
  activeFrames: number;
  recoverFrames: number;
  /** 硬直が終わってから次の予備動作に入れるまでの待ち */
  cooldownFrames: number;
  hitbox: HitboxDef;
  damage: number;
  /** プレイヤーへのノックバック距離（m）とヒットストップ（sim フレーム） */
  knockback: number;
  hitStop: number;
  /** 持続中に前へ踏み込む距離（m） */
  lunge: number;
}

export interface EnemyDef {
  id: string;
  /** HUD に出す名前 */
  name: string;
  hp: number;
  /** 当たり判定（XZ の円）の半径 */
  radius: number;
  /** 見た目の高さ。ダメージ数字・命中エフェクトの出す高さの目安 */
  height: number;
  /** 被弾のひるみ（この間は何もできない） */
  hitStunFrames: number;
  /** ノックバックをかけるフレーム数（この間に距離ぶん進んで止まる） */
  knockbackFrames: number;
  /** ノックバック距離の倍率（1 = 攻撃データのまま、0 = 動かない） */
  knockbackScale: number;
  /** 死亡の演出フレーム。終わったら取り除く */
  deathFrames: number;
  /** 向き直りの速さ（rad/s） */
  turnSpeed: number;
  /** 追跡の速さ（m/s）。プレイヤー（4.8 m/s）より十分遅い */
  moveSpeed: number;
  /** この距離（m）以内にプレイヤーがいれば追いかける */
  aggroRange: number;
  /** 追跡でこの距離（中心間 m）まで近づいたら止まる */
  stopDistance: number;
  /** 出現してから動き出すまで */
  spawnIdleFrames: number;
  attack: EnemyAttackDef;
}

export const ENEMIES = {
  /** 子鬼。M2 の最初の敵（プリミティブ製の仮の見た目。src/game/enemy-visual.ts） */
  imp: {
    id: 'imp',
    name: '子鬼',
    hp: 80,
    radius: 0.5,
    height: 1.7,
    hitStunFrames: 22,
    knockbackFrames: 12,
    knockbackScale: 1,
    deathFrames: 70,
    turnSpeed: 5,
    moveSpeed: 2.4,
    aggroRange: 14,
    stopDistance: 1.6,
    spawnIdleFrames: 40,
    // 腕を振り上げて 0.63 秒（38f）ためる → 前へ踏み込んで叩きつける → 0.7 秒の硬直。ための後半 16f は向きを固定する。
    // ためが 16f を過ぎたら弱攻撃ではひるまない（重撃だけが割り込める）
    attack: {
      range: 1.9,
      windupFrames: 38,
      windupTrackFrames: 22,
      armorFromFrame: 16,
      armorBreakDamage: 30,
      armorKnockbackScale: 0.2,
      startupFrames: 3,
      activeFrames: 6,
      recoverFrames: 42,
      cooldownFrames: 40,
      hitbox: { kind: 'arc', range: 1.5, halfAngle: deg(50) },
      damage: 12,
      knockback: 0.9,
      hitStop: 6,
      lunge: 0.8,
    },
  },
} as const satisfies Record<string, EnemyDef>;
