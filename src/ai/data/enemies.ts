/**
 * 敵の数値（ADR-014）。コードに埋め込まずここで調整する。
 * 時間は sim フレーム（60Hz）、距離は m。
 */

import { type HitboxDef } from '../../combat/hit';
import type { ProjectileId } from '../../combat/data/projectiles';
import type { DropDef } from '../../combat/data/items';
import { BOSS_POISE_BREAK, POISE_BREAK, type PoiseDef } from '../../combat/data/poise';

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
   * 予告（テレグラフ）の床表示（ADR-025・027）。あれば、予備動作のあいだ「どこが危ないか」を床に出す。
   * lane = 向いている方向へまっすぐ伸びる帯（突進・飛び道具の通り道。長さは踏み込み lunge + 当たりの届く距離）。width は帯の幅（m）で、横へ動いて避けられる幅の目安
   * circle = 敵を中心にした円（全周の攻撃。半径は当たりの届く距離 hitbox.range）。予備動作の進みに合わせて内側から満ちていき、満ちたときに攻撃が来る（円の外へ出れば避けられる）
   */
  telegraph?: { kind: 'lane'; width: number } | { kind: 'circle' };
  /**
   * ガード不能の攻撃（ADR-027）: ガードもパリィもできず、構えていても被弾する（回避か、当たらない場所へ逃げる）。
   * 床の予告と予備動作の合図を、防げる攻撃と色分けする
   */
  unblockable?: boolean;
  /**
   * 地面を叩く攻撃（ADR-027）: 判定が出る瞬間に、床で砂ぼこりの輪・ひび割れが弾け、画面が揺れる。値は演出の強さ（GroundFx.burst の power。輪の半径 = 1.2 + 1.5 × power）。
   * 全周の攻撃（circle の予告）では、輪の広がりが当たりの半径に合うよう power を決める
   */
  groundImpact?: number;
  /**
   * 飛び道具を撃つ攻撃（ADR-026）。攻撃に入って startupFrames で、予備動作で固定した向きへ弾を撃つ（近接の判定は出ない。hitbox・damage・knockback・hitStop・lunge は使わない）。
   * 帯（telegraph）の長さは弾の飛ぶ距離
   */
  projectile?: ProjectileId;
  /**
   * 弾を複数撃つ（ボスの連弾・輪。ADR-029）: 本数と、扇の広がり（rad。2π 以上 = 全周に等間隔）。既定は 1 本。
   * 扇は撃つ向きを中心に左右へ均等に広がる。床の予告（lane）も同じ本数の帯を出す
   */
  projectileCount?: number;
  projectileSpread?: number;
  /** 弾の出る位置を、弾のデータの銃口（Projectile.muzzle）から、さらに前へずらす距離（m）。体の大きな敵が自分の体の外から撃つ */
  muzzleOffset?: number;
  /**
   * 召喚（ボスの号令。ADR-029）: 判定が出る瞬間（startupFrames）に、周り（敵の中心から radius m の円周に等間隔）へ type の敵を count 体呼ぶ。
   * 実際に出すのは Game（Enemy.summonSerial / summon を読む。生きている同種の敵が多すぎれば出さない）
   */
  summon?: { type: string; count: number; radius: number; /** 生きている同種の敵がこの数以上なら呼ばない（手下が増えすぎない） */ max: number };
  /**
   * 複数の技を持つ敵（moves）で、この技が選べる最小の段階（0 = 最初から。EnemyDef.phases の段階）、
   * 選べる距離の下限（中心間 m。上限は range）、選ばれやすさ（既定 1）、技の名前
   */
  minPhase?: number;
  rangeMin?: number;
  weight?: number;
  id?: string;
  /**
   * 技の見た目の構え（EnemyVisual）: slam = 武器を頭上へ振りかぶって叩きつける（既定）、cast = 片腕を突き出して放つ、roar = 両腕を広げて吠える。
   * 予備動作の見た目だけで、当たり判定・タイミングには関わらない
   */
  pose?: 'slam' | 'cast' | 'roar';
}

/** 段階（ボスの怒り。ADR-029）: HP の割合がこの値以下になったら次の段階に入る。段階ごとに技が増え、技の間隔が縮む */
export interface EnemyPhaseDef {
  hpBelow: number;
  /** 技のあとの待ち（cooldownFrames）に掛ける倍率（小さいほど間隔が短い） */
  cooldownScale: number;
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
  /**
   * 常時スーパーアーマー（重装型。ADR-027）: 攻撃していなくても、armorBreakDamage 未満の攻撃ではひるまない（ダメージは通り、ノックバックは armorKnockbackScale 倍）。
   * ひるまない代わりに poise（体勢ゲージ）が減り、崩れたときだけ止まる
   */
  hyperArmor?: boolean;
  poise?: PoiseDef;
  /**
   * 攻撃権（同時に予備動作〜攻撃に入れる数の予算 = EncounterDef.maxAttackers）を使う重み（既定 1）。群れの小さな敵は 0.5 などにして、予算の中で数体が同時に襲える。
   * 予備動作に入る前に、いま攻撃中の敵の重みの合計 + 自分の重み ≤ 予算 であること（ADR-028）
   */
  attackWeight?: number;
  /**
   * 複数の技（ボス）: 距離・段階・重みで選ぶ（攻撃に入るたびに、選べる技から重み付きの乱数で。直前と同じ技は、他に選べる技があれば避ける）。
   * 技はどれも EnemyAttackDef で、attack は先頭の技（既定）。なければ attack 1 つだけ
   */
  moves?: readonly EnemyAttackDef[];
  /** 段階（HP の割合で段階が上がる）。なければ段階は 0 のまま */
  phases?: readonly EnemyPhaseDef[];
  /** ボス: 画面上部に大きな HP バーを出し、倒すと手下が消える（ADR-029） */
  boss?: boolean;
  /**
   * 周回（群れの敵。ADR-028）: プレイヤーの近く（stopDistance + 1.8m 以内）では、stopDistance の輪を保ちながらプレイヤーの周りを回る（m/s）。
   * 攻撃権を待つあいだ、敵が 1 か所に固まらず散らばって囲む。回る向きは敵の id で決まり、攻撃を終えるたびに逆になる
   */
  orbitSpeed?: number;
  /** 飛んでいる敵（ADR-028）: プレイヤーを押し出さず、地上の敵とも体を押し合わない（群れの敵どうしだけが重ならない） */
  flying?: boolean;
  /**
   * 倒したときにもらえる経験値（M6-2。ADR-033）。デモ 1 周（ボスの呼んだ手下は 0）で約 660。
   * 呼ばれた手下（Game の summonedIds）は、ここの値にかかわらず 0（呼ばせて稼げないように）
   */
  xp?: number;
  /** 倒したときのアイテムのドロップ（ADR-030）。種類ごとに別々の確率で抽選する。無ければ落とさない（ボス・呼ばれた手下は落とさない） */
  drops?: readonly DropDef[];
  attack: EnemyAttackDef;
}

/** 近接の判定を持たない攻撃（飛び道具）が hitbox に置く、大きさ 0 の判定 */
const NO_HITBOX: HitboxDef = { kind: 'arc', range: 0, halfAngle: 0 };

/**
 * ボス「夜行の大将」の技（ADR-029）。どれも常時スーパーアーマー・体勢で割り込む前提（armorBreakDamage 9999）。
 *  - 地ならし: 近距離の全周・ガード不能（岩鬼と同じ円の予告。半径 3.6m = 床の輪の最大）
 *  - 鬼火の連弾: 遠距離から、扇に 5 発（床に 5 本の帯。パリィで弾き返せば体勢も削れる）
 *  - 号令（段階 1〜）: 吠えて、周りに小蝙蝠を 3 体呼ぶ（生きている蝙蝠が多いと呼ばない）
 *  - 鬼火の輪（段階 2〜）: 全周に 8 発（輪の隙間か、ロール・ガードで）
 */
const BOSS_ARMOR = { armorFromFrame: 0, armorBreakDamage: 9999, armorKnockbackScale: 0.08 } as const;
const BOSS_POUND: EnemyAttackDef = {
  id: 'pound',
  pose: 'slam',
  range: 4.4,
  rangeMin: 0,
  weight: 1.2,
  windupFrames: 66,
  windupTrackFrames: 36,
  ...BOSS_ARMOR,
  startupFrames: 6,
  activeFrames: 5,
  recoverFrames: 74,
  cooldownFrames: 70,
  hitbox: { kind: 'arc', range: 3.6, halfAngle: Math.PI },
  damage: 36,
  knockback: 3.6,
  hitStop: 14,
  lunge: 0,
  telegraph: { kind: 'circle' },
  unblockable: true,
  groundImpact: 1.6,
};
const BOSS_VOLLEY: EnemyAttackDef = {
  id: 'volley',
  pose: 'cast',
  range: 14,
  rangeMin: 4.5,
  weight: 1.5,
  windupFrames: 50,
  windupTrackFrames: 32,
  ...BOSS_ARMOR,
  startupFrames: 2,
  activeFrames: 1,
  recoverFrames: 40,
  cooldownFrames: 60,
  hitbox: NO_HITBOX,
  damage: 0,
  knockback: 0,
  hitStop: 0,
  lunge: 0,
  telegraph: { kind: 'lane', width: 0.8 },
  projectile: 'wisp',
  projectileCount: 5,
  projectileSpread: 1.3,
  muzzleOffset: 1.0,
};
const BOSS_SUMMON: EnemyAttackDef = {
  id: 'summon',
  pose: 'roar',
  range: 30,
  rangeMin: 0,
  minPhase: 1,
  weight: 0.8,
  windupFrames: 64,
  windupTrackFrames: 0,
  ...BOSS_ARMOR,
  startupFrames: 4,
  activeFrames: 1,
  recoverFrames: 50,
  cooldownFrames: 90,
  hitbox: NO_HITBOX,
  damage: 0,
  knockback: 0,
  hitStop: 0,
  lunge: 0,
  summon: { type: 'bat', count: 3, radius: 3.4, max: 6 },
};
const BOSS_RING: EnemyAttackDef = {
  id: 'ring',
  pose: 'roar',
  range: 14,
  rangeMin: 0,
  minPhase: 2,
  weight: 1.3,
  windupFrames: 58,
  windupTrackFrames: 20,
  ...BOSS_ARMOR,
  startupFrames: 2,
  activeFrames: 1,
  recoverFrames: 46,
  cooldownFrames: 70,
  hitbox: NO_HITBOX,
  damage: 0,
  knockback: 0,
  hitStop: 0,
  lunge: 0,
  telegraph: { kind: 'lane', width: 0.8 },
  projectile: 'wisp',
  projectileCount: 8,
  projectileSpread: Math.PI * 2,
  muzzleOffset: 1.1,
};

export const ENEMIES = {
  /** 子鬼。M2 の最初の敵（プリミティブ製の仮の見た目。src/game/enemy-visual.ts） */
  imp: {
    id: 'imp',
    name: '子鬼',
    xp: 20,
    hp: 80,
    radius: 0.5,
    height: 1.7,
    hitStunFrames: 22,
    knockbackFrames: 12,
    knockbackScale: 1,
    deathFrames: 70,
    drops: [{ item: 'potionS', chance: 0.1 }],
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
    xp: 40,
    hp: 110,
    radius: 0.7,
    height: 1.15,
    hitStunFrames: 18,
    knockbackFrames: 12,
    knockbackScale: 0.6,
    deathFrames: 70,
    drops: [{ item: 'potionS', chance: 0.2 }],
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
    xp: 35,
    hp: 50,
    radius: 0.45,
    height: 1.5,
    hitStunFrames: 20,
    knockbackFrames: 12,
    knockbackScale: 1.2,
    deathFrames: 60,
    drops: [{ item: 'potionS', chance: 0.18 }],
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
  /**
   * 岩鬼（ADR-027。M5-3）: 重装型。ひるまない（常時スーパーアーマー）代わりに、受けたダメージで体勢ゲージ（80）が減り、0 になると膝をついて動けなくなる（反撃 1.8 倍）。
   * 攻撃は金棒を振りかぶって地面を叩く「地ならし」1 種で、**全周・ガード不能**（ガードもパリィも効かない）。避け方は、予告の円（床。半径 3.0m）の外へ出る、ロールの無敵で抜ける、
   * または予備動作のうちに体勢を崩して中断させる。予備動作 1.07 秒（前半 34f は追い、後半は固定）・硬直 1.17 秒（反撃のチャンス）。
   */
  ogre: {
    id: 'ogre',
    name: '岩鬼',
    xp: 100,
    hp: 320,
    radius: 0.95,
    height: 2.6,
    hitStunFrames: 20,
    knockbackFrames: 14,
    knockbackScale: 0.12,
    deathFrames: 90,
    drops: [
      { item: 'potionS', chance: 0.35 },
      { item: 'potionM', chance: 0.3 },
    ],
    turnSpeed: 2.2,
    moveSpeed: 1.7,
    aggroRange: 18,
    stopDistance: 2.6,
    spawnIdleFrames: 70,
    hyperArmor: true,
    poise: { max: 80, regenDelayFrames: 150, regenPerFrame: 0.35, breakEffect: POISE_BREAK },
    attack: {
      range: 3.4,
      windupFrames: 64,
      windupTrackFrames: 34,
      armorFromFrame: 0,
      armorBreakDamage: 9999,
      armorKnockbackScale: 0.12,
      startupFrames: 6,
      activeFrames: 5,
      recoverFrames: 70,
      cooldownFrames: 60,
      // 全周（半角 180°）。届く距離 3.0m（プレイヤーの体の縁がここに触れたら当たる）
      hitbox: { kind: 'arc', range: 3.0, halfAngle: Math.PI },
      damage: 32,
      knockback: 3.4,
      hitStop: 12,
      lunge: 0,
      telegraph: { kind: 'circle' },
      unblockable: true,
      groundImpact: 1.2,
    },
  },
  /**
   * 小蝙蝠（ADR-028。M5-4）: 小型の群れ。弱く（HP 12 = 片手剣 2 発・大剣 1 発）、素早く（4.2 m/s）、数で囲んで噛みつく。
   * 近づくとプレイヤーの周りを輪（3m）で回って（散らばって囲む）、攻撃権（重み 0.6 = 同時に 3 体まで）が回ってきた順に、予備動作 0.43 秒（後半 16f は向きを固定）→ 急降下で 2.8m を一気に噛みつく。
   * 1 発は軽い（ダメージ 6）が、複数に囲まれるとまとめて来る。盾・ガード・ロールで防げ、大剣の薙ぎ払い・回転斬りで一掃できる。飛んでいるのでプレイヤーを押し出さない。
   */
  bat: {
    id: 'bat',
    name: '小蝙蝠',
    xp: 6,
    hp: 12,
    radius: 0.3,
    height: 1.6,
    hitStunFrames: 16,
    knockbackFrames: 10,
    knockbackScale: 1.8,
    deathFrames: 40,
    drops: [{ item: 'potionS', chance: 0.05 }],
    turnSpeed: 9,
    moveSpeed: 4.2,
    aggroRange: 22,
    stopDistance: 3,
    spawnIdleFrames: 30,
    attackWeight: 0.6,
    orbitSpeed: 2.4,
    flying: true,
    attack: {
      range: 3.6,
      windupFrames: 26,
      windupTrackFrames: 10,
      armorFromFrame: 999,
      armorBreakDamage: 0,
      armorKnockbackScale: 1,
      startupFrames: 2,
      activeFrames: 10,
      recoverFrames: 28,
      cooldownFrames: 60,
      hitbox: { kind: 'arc', range: 0.8, halfAngle: deg(50) },
      damage: 6,
      knockback: 0.7,
      hitStop: 3,
      lunge: 2.8,
    },
  },
  /**
   * ボス「夜行の大将」（ADR-029。M5-5）: これまでの敵の要素を 1 体に集めた最後の相手。岩鬼の体（ひるまない・体勢ゲージ・ガード不能の地ならし）、提灯の鬼火（扇・輪）、小蝙蝠の召喚。
   * HP 900・体勢 140（崩すと 2 秒の反撃の窓 1.6 倍）。HP が 66% と 33% で段階が上がり、技が増え（号令・鬼火の輪）、技の間隔が縮む（0.85 → 0.65 倍）。
   * 倒すと手下（呼んだ小蝙蝠）は消える。遅い（1.9 m/s）が、遠距離から連弾・輪を撃つので、近づく判断が要る。
   */
  boss: {
    id: 'boss',
    name: '夜行の大将',
    xp: 250,
    hp: 900,
    radius: 1.25,
    height: 3.9,
    hitStunFrames: 20,
    knockbackFrames: 14,
    knockbackScale: 0.08,
    deathFrames: 130,
    turnSpeed: 2,
    moveSpeed: 1.9,
    aggroRange: 30,
    stopDistance: 3.6,
    spawnIdleFrames: 90,
    hyperArmor: true,
    boss: true,
    poise: { max: 140, regenDelayFrames: 160, regenPerFrame: 0.4, breakEffect: BOSS_POISE_BREAK },
    phases: [
      { hpBelow: 0.66, cooldownScale: 0.85 },
      { hpBelow: 0.33, cooldownScale: 0.65 },
    ],
    attack: BOSS_POUND,
    moves: [BOSS_POUND, BOSS_VOLLEY, BOSS_SUMMON, BOSS_RING],
  },
} as const satisfies Record<string, EnemyDef>;

export type EnemyId = keyof typeof ENEMIES;
