/**
 * プレイヤーキャラ（hero.glb）の資産定義。クリップ名・区間・剣の装着位置。
 * 数値はすべてここで調整する（コードに埋めない）。
 */

export interface ClipSegment {
  clip: string;
  /** 元クリップ上の秒 */
  start: number;
  end: number;
}

export const HERO = {
  /** import.meta.env.BASE_URL からの相対 */
  url: 'assets/characters/hero.glb',
  height: 1.68,
  /** クリップはすべて +Z 正面（tools/scratch で確認済み） */
  forwardYawOffset: 0,

  /** そのまま使うクリップ */
  clips: {
    /** 直立に近い自然な待機（Idle_02）。身長が読めるように */
    idle: 'idle',
    /** 剣を構えた待機（Combat_Stance）。ロックオン中などに使う予定 */
    stance: 'stance',
    run: 'run',
    death: 'death',
  },

  /** 区間を切り出して使うクリップ（秒は元クリップ上） */
  segments: {
    // 3 連コンボは「振りかぶりの小さい」3 本をつなぐ（上腕の挙上 130° 以下。脇が破れない。docs/05）。
    // 1 段目 Right_Hand_Sword_Slash: 右手速度のピークが元クリップ上 0.55 秒（区間内 0.45 秒）
    combo1: { clip: 'slash', start: 0.1, end: 1.35 },
    // 2 段目 Left_Slash の 1 振り目: 速度ピーク 0.80 秒（区間内 0.60 秒）。2 振り目の振りかぶりは 0.85 秒ごろから始まるので手前で切る
    combo2: { clip: 'leftslash', start: 0.2, end: 0.9 },
    // 3 段目 Thrust_Slash の突き: 速度ピーク 0.75 秒（区間内 0.40 秒）。元クリップは右へ突く向きなので manifest で yawDeg:90 を掛けてある
    combo3: { clip: 'thrust', start: 0.35, end: 1.2 },
    // Heavy_Hammer_Swing: 振り下ろし 1.45〜1.70 秒
    heavy: { clip: 'heavy', start: 0.3, end: 1.87 },
    // Roll_Dodge: 前転本体は 0.45〜1.55 秒
    dodge: { clip: 'dodge', start: 0.45, end: 1.55 },
    // Hit_Reaction_1: ひるみは最初の 0.6 秒
    hit: { clip: 'hit', start: 0.0, end: 0.6 },
  } satisfies Record<string, ClipSegment>,

  /** 走りアニメ（Run_02, 0.73 秒/周）の自然な地面速度（m/s）。接地足の後方速度から推定した値。
   *  移動速度 ÷ この値 を再生速度にすると足が滑らない */
  runCycleSpeed: 3.6,
  runRateMin: 0.6,

  dodge: { rate: 2.2 },
  hit: { rate: 1.5 },

  /**
   * 手ボーン（RightHand）の座標系。ボーンのローカル空間（cm）で、手の頂点の主成分分析から求めた
   * （tools/scratch/hand-pca.mjs）。f=指の向き、t=親指側、d=手の甲側（f×t）。ボーンの Y 軸は f から約 22° ずれている。
   * 手を下ろしてのひらを体に向けたとき、t は前、f は下を向く。
   */
  hand: {
    right: {
      f: [0.2109, 0.9277, -0.3079] as [number, number, number],
      t: [-0.6494, 0.3682, 0.6654] as [number, number, number],
      d: [0.7307, 0.0596, 0.6801] as [number, number, number],
    },
  },

  /**
   * 剣の装着（グリップ）。ボーンのローカル空間（単位 cm。Armature が 0.01 倍のため）。
   * 以前は刃が手ボーンの X 軸＝のひらに垂直な向きで、待機で刃が真横に突き出ていた（実機の指摘）。
   * 今は「柄が手のひらを斜めに横切り、刃が親指側から前へ伸びる」持ち方:
   *   刃(+Y) = 親指側 t を指の向き f へ gripAngleDeg 倒した向き、剣の面の法線(+Z) = 手の甲側 d、
   *   剣の幅方向(+X) = 刃 × 法線。待機は刃が前下がり、走りは前へやや下がる
   */
  sword: {
    bone: 'RightHand',
    /** 柄の中心（手のひらの中心。cm） */
    position: [-0.86, 7.48, -1.22] as [number, number, number],
    /** グリップの回転（クォータニオン xyzw。剣のローカル → 手ボーンのローカル） */
    quaternion: [0.0883, 0.3901, 0.2744, 0.8745] as [number, number, number, number],
    gripAngleDeg: 35,
  },
} as const;
