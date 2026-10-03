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
    idle: 'idle',
    run: 'run',
    death: 'death',
  },

  /** 区間を切り出して使うクリップ（秒は元クリップ上） */
  segments: {
    // Triple_Combo_Attack: 右手の速度ピークが 0.78 / 1.60 / 2.30 秒
    combo1: { clip: 'combo', start: 0.0, end: 1.0 },
    combo2: { clip: 'combo', start: 1.0, end: 1.8 },
    combo3: { clip: 'combo', start: 1.8, end: 2.7 },
    // Right_Hand_Sword_Slash: ピーク 0.55 秒
    slash: { clip: 'slash', start: 0.1, end: 1.35 },
    // Heavy_Hammer_Swing: 振り下ろし 1.45〜1.70 秒
    heavy: { clip: 'heavy', start: 0.3, end: 1.87 },
    // Roll_Dodge: 前転本体は 0.45〜1.55 秒
    dodge: { clip: 'dodge', start: 0.45, end: 1.55 },
    // Hit_Reaction_1: ひるみは最初の 0.6 秒
    hit: { clip: 'hit', start: 0.0, end: 0.6 },
  } satisfies Record<string, ClipSegment>,

  /** 走りアニメ 1 周（0.83 秒）が自然に見える移動速度（m/s）。これを基準に再生速度を変える */
  runCycleSpeed: 5.2,
  runRateMin: 0.6,

  dodge: { rate: 2.2 },
  hit: { rate: 1.5 },

  /** 剣の装着。ボーンのローカル空間（単位 cm。Armature が 0.01 倍のため） */
  sword: {
    bone: 'RightHand',
    /** ソケットの位置（cm） */
    position: [0, 8, 0] as [number, number, number],
    /** ソケットの回転（オイラー、ラジアン、XYZ 順） */
    rotation: [0, 0, -Math.PI * 0.5] as [number, number, number],
  },
} as const;
