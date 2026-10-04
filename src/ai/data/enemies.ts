/**
 * 敵の数値（ADR-014）。コードに埋め込まずここで調整する。
 * 時間は sim フレーム（60Hz）、距離は m。
 */

import { type HitboxDef } from '../../combat/hit';
import type { ProjectileId } from '../../combat/data/projectiles';

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
  /**
   * 予告（テレグラフ）の床表示（ADR-025）。あれば、予備動作のあいだ「どこが危ないか」を床に出す。
   * lane = 向いている方向へまっすぐ伸びる帯（突進の通り道。長さは踏み込み lunge + 当たりの届く距離）。width は帯の幅（m）で、横へ動いて避けられる幅の目安
   */
  telegraph?: { kind: 'lane'; width: number };
  /**
   * 飛び道具を撃つ攻撃（ADR-026）。攻撃に入って startupFrames で、予備動作で固定した向きへ弾を撃つ（近接の判定は出ない。hitbox・damage・knockback・hitStop・lunge は使わない）。
   * 帯（telegraph）の長さは弾の飛ぶ距離
   */
  projectile?: ProjectileId;
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
  /**
   * 距離を取る敵（遠距離型）: プレイヤーがこの距離（中心間 m）より近づくと、向きを保ったまま後ろへ下がる（retreatSpeed m/s。壁際では止まる）。
   * 近づかれても慌てず撃つ・逃げる、を作る。stopDistance は撃つときに保つ距離
   */
  retreatDistance?: number;
  retreatSpeed?: number;
  attack: EnemyAttackDef;
}

/** 近接の判定を持たない攻撃（飛び道具）が hitbox に置く、大きさ 0 の判定 */
const NO_HITBOX: HitboxDef = { kind: 'arc', range: 0, halfAngle: 0 };

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
  /**
   * 暴れ猪（ADR-025。M5-1）: 突進型。遠くから予備動作に入り（床に突進の通り道が出る）、向きを固定して一直線に突っ込む。
   * 横へ動く・ロールで避ければ、息切れの長い硬直を無防備にさらす。パリィで弾けば倒れて大きな反撃を受ける（突進の勢いで 2 回りは遠くへ弾かれる）。
   * 予備動作 0.93 秒のうち前半 30f はプレイヤーを追い、後半 26f は向きを固定（床の帯が出る）。突進は 6m を 0.43 秒（13.8 m/s）で、当たりは正面の狭い扇（帯の幅 2.1m に収まる）。
   * 突進の前後はスーパーアーマー（armorBreakDamage 34 以上の重い攻撃だけが割り込める）。
   */
  boar: {
    id: 'boar',
    name: '暴れ猪',
    hp: 110,
    radius: 0.7,
    height: 1.15,
    hitStunFrames: 18,
    knockbackFrames: 12,
    knockbackScale: 0.6,
    deathFrames: 70,
    turnSpeed: 4,
    moveSpeed: 2.6,
    aggroRange: 16,
    stopDistance: 3,
    spawnIdleFrames: 50,
    attack: {
      range: 7,
      windupFrames: 56,
      windupTrackFrames: 30,
      armorFromFrame: 20,
      armorBreakDamage: 34,
      armorKnockbackScale: 0.2,
      startupFrames: 4,
      activeFrames: 26,
      recoverFrames: 64,
      cooldownFrames: 50,
      hitbox: { kind: 'arc', range: 1.6, halfAngle: deg(40) },
      damage: 20,
      knockback: 3.2,
      hitStop: 9,
      lunge: 6,
      telegraph: { kind: 'lane', width: 2.1 },
    },
  },
  /**
   * 提灯（ADR-026。M5-2）: 遠距離型。距離を保って（近づかれると後ろへ下がる）、鬼火を一直線に撃つ。
   * 予備動作 0.73 秒のうち前半 30f はプレイヤーを追い、後半 14f は向きを固定する（床に鬼火の通り道が出る = 横へ動く・ロールで避けられる）。
   * 鬼火は盾・大剣でパリィすると撃った提灯へ跳ね返って大ダメージ（体力 50 に対して 60 = 一撃）。ガードなら削りだけ、斬ればかき消せる。
   * 体は脆く（体力 50）、一度近づけば 2〜3 振りで落とせるが、近づくあいだに撃たれ、下がられる。
   */
  lantern: {
    id: 'lantern',
    name: '提灯',
    hp: 50,
    radius: 0.45,
    height: 1.5,
    hitStunFrames: 20,
    knockbackFrames: 12,
    knockbackScale: 1.2,
    deathFrames: 60,
    turnSpeed: 5,
    moveSpeed: 2.2,
    aggroRange: 20,
    stopDistance: 6.5,
    spawnIdleFrames: 60,
    retreatDistance: 4.5,
    retreatSpeed: 3.4,
    attack: {
      range: 11,
      windupFrames: 44,
      windupTrackFrames: 30,
      // 撃つ直前まで弱い攻撃でひるむ（近づいて斬れば撃たせない）。スーパーアーマーなし
      armorFromFrame: 999,
      armorBreakDamage: 0,
      armorKnockbackScale: 1,
      startupFrames: 2,
      activeFrames: 1,
      recoverFrames: 36,
      cooldownFrames: 70,
      hitbox: NO_HITBOX,
      damage: 0,
      knockback: 0,
      hitStop: 0,
      lunge: 0,
      telegraph: { kind: 'lane', width: 0.8 },
      projectile: 'wisp',
    },
  },
} as const satisfies Record<string, EnemyDef>;

export type EnemyId = keyof typeof ENEMIES;
