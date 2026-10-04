/**
 * 効果音のレシピ（ADR-017）。音声ファイルは使わず、WebAudio のノイズと発振器の重ね合わせで合成する。
 * 1 つの音 = いくつかの層（layer）。各層は「いつ（delay）」「どれくらい（dur）」「どう変わるか（周波数の from → to）」「音量の山（attack と peak）」で決まる。
 * 周波数は指数的に from から to へ動く（ヒュッ・ドスッの質感はここで決まる）。音量は attack で peak まで上げ、dur の終わりへ向けて指数的に消える。
 * 数値はここだけで調整する（実機で聴きながら）。
 */

export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

export interface NoiseLayer {
  kind: 'noise';
  filter: FilterType;
  /** フィルタの中心（カットオフ）周波数（Hz）が from から to へ動く */
  from: number;
  to: number;
  q: number;
  /** 秒 */
  delay?: number;
  attack: number;
  dur: number;
  peak: number;
}

export interface ToneLayer {
  kind: 'tone';
  wave: Wave;
  from: number;
  to: number;
  delay?: number;
  attack: number;
  dur: number;
  peak: number;
}

export type Layer = NoiseLayer | ToneLayer;

export interface SfxDef {
  /** この音全体の音量（0..1）。レイヤの peak と掛け合わせる */
  gain: number;
  layers: readonly Layer[];
}

const noise = (filter: FilterType, from: number, to: number, q: number, dur: number, peak: number, attack = 0.01, delay = 0): NoiseLayer => ({ kind: 'noise', filter, from, to, q, delay, attack, dur, peak });
const tone = (wave: Wave, from: number, to: number, dur: number, peak: number, attack = 0.005, delay = 0): ToneLayer => ({ kind: 'tone', wave, from, to, delay, attack, dur, peak });

export const SFX = {
  // ---- プレイヤーの剣 ----
  /** 1 段目: 袈裟斬りのヒュッ（高めに上がって消える） */
  swing1: { gain: 1, layers: [noise('bandpass', 1500, 4600, 1.3, 0.17, 1, 0.03), tone('sine', 420, 260, 0.1, 0.2)] },
  /** 2 段目: 少し高く短い */
  swing2: { gain: 1, layers: [noise('bandpass', 1900, 5400, 1.3, 0.15, 1, 0.025), tone('sine', 480, 300, 0.09, 0.18)] },
  /** 3 段目: 突き。低めから鋭く */
  swing3: { gain: 1, layers: [noise('bandpass', 900, 3600, 1.1, 0.16, 1, 0.02), tone('triangle', 300, 170, 0.12, 0.22)] },
  /** 重撃: 長い風切り音と低い唸り */
  swingHeavy: { gain: 0.85, layers: [noise('bandpass', 500, 2600, 0.9, 0.34, 0.9, 0.12), tone('sine', 110, 55, 0.34, 0.3, 0.1)] },
  dodge: { gain: 0.5, layers: [noise('highpass', 2200, 7200, 0.7, 0.22, 0.7, 0.04)] },
  /** 後ろステップ: 前転より短く軽い（地面を蹴って離れる） */
  dodgeBack: { gain: 0.45, layers: [noise('highpass', 1800, 5200, 0.7, 0.16, 0.65, 0.03), tone('sine', 200, 120, 0.08, 0.18, 0.005, 0.12)] },
  /** 踏み込み（突き）: 鋭く一直線。高い所から落ちる細い風切り */
  swingLunge: { gain: 1, layers: [noise('bandpass', 2800, 900, 1.6, 0.14, 1, 0.015), tone('triangle', 520, 240, 0.1, 0.2)] },
  /** ダッシュ斬り（斬り上げ）: 下から上がる風切り */
  swingDash: { gain: 1, layers: [noise('bandpass', 700, 3800, 1.0, 0.22, 1, 0.05), tone('sine', 260, 520, 0.14, 0.2, 0.02)] },
  /** 下がりながらの払い: 短く軽い */
  swingRetreat: { gain: 0.9, layers: [noise('bandpass', 1800, 3600, 1.1, 0.15, 0.95, 0.02), tone('sine', 380, 250, 0.09, 0.16)] },
  /** 横薙ぎ: 長く広い風切り（回り込む） */
  swingSweep: { gain: 1, layers: [noise('bandpass', 600, 3000, 0.9, 0.3, 1, 0.1), noise('bandpass', 2600, 800, 1.2, 0.16, 0.5, 0.02, 0.1), tone('sine', 150, 90, 0.26, 0.22, 0.06)] },

  // ---- 大剣（ADR-021）: 片手剣より低く長い風切りと唸り。重い剣が空気を押す音 ----
  /** 1 段目: 低く太い風切り（袈裟） */
  gsSwing1: { gain: 0.95, layers: [noise('bandpass', 420, 2300, 0.9, 0.3, 1, 0.1), tone('sine', 95, 52, 0.3, 0.36, 0.08)] },
  /** 2 段目: 少し高く、返しの鋭さ */
  gsSwing2: { gain: 0.95, layers: [noise('bandpass', 700, 3100, 0.95, 0.26, 1, 0.07), tone('sine', 130, 70, 0.26, 0.34, 0.05)] },
  /** 踏み込み突き: 低い所から鋭く落ちる細く長い風切り */
  gsSwingLunge: { gain: 1, layers: [noise('bandpass', 2400, 700, 1.4, 0.22, 1, 0.03), tone('triangle', 280, 120, 0.2, 0.3, 0.01)] },
  /** 下がりながらの薙ぎ払い: 低く広い */
  gsSwingRetreat: { gain: 0.95, layers: [noise('bandpass', 500, 2500, 0.9, 0.27, 0.95, 0.06), tone('sine', 105, 62, 0.25, 0.3, 0.04)] },
  /** 大回転斬り: 長く回り込む風切り（行きと戻りの 2 層）と低い唸り */
  gsSwingSpin: {
    gain: 1,
    layers: [noise('bandpass', 380, 2900, 0.85, 0.42, 1, 0.12), noise('bandpass', 2900, 650, 1.1, 0.26, 0.55, 0.03, 0.2), tone('sine', 80, 46, 0.46, 0.4, 0.08)],
  },
  /** 跳び叩きつけ: 下から上がる風切りと、叩きつける直前の低い唸り */
  gsSwingDash: { gain: 1, layers: [noise('bandpass', 350, 2200, 0.9, 0.3, 1, 0.1), tone('sine', 210, 420, 0.18, 0.2, 0.04), tone('sine', 90, 48, 0.26, 0.34, 0.06, 0.1)] },
  /** 斬り上げ: 下から上がる風切り（片手剣のダッシュ斬りより低く長い） */
  gsSwingRise: { gain: 1, layers: [noise('bandpass', 600, 3200, 0.95, 0.26, 1, 0.07), tone('sine', 200, 380, 0.16, 0.2, 0.03)] },
  /** 溜め斬り: 長い風切りと、体の芯に響く低い唸り */
  gsSwingHeavy: { gain: 0.9, layers: [noise('bandpass', 330, 1900, 0.85, 0.44, 0.95, 0.16), tone('sine', 72, 38, 0.5, 0.5, 0.12), tone('sine', 140, 70, 0.3, 0.2, 0.1, 0.1)] },

  /** 地割り: 頭上から落ちる長く低い風切り（溜め斬りより長く、重い） */
  gsSwingSmash: { gain: 0.95, layers: [noise('bandpass', 260, 1700, 0.85, 0.5, 0.95, 0.2), tone('sine', 68, 34, 0.56, 0.52, 0.16), tone('sine', 150, 64, 0.34, 0.22, 0.12, 0.14)] },
  /** 叩き落とし: 右上から左前下へ落とす風切り（溜め斬りより短い） */
  gsSwingDrop: { gain: 0.95, layers: [noise('bandpass', 420, 2100, 0.9, 0.34, 1, 0.1), tone('sine', 84, 42, 0.38, 0.42, 0.08)] },
  /** 剣が地面を叩いた（地割り・叩き落とし）: 体の芯に響く低い衝撃、砕ける土のざらつき、遅れて小石が散る音 */
  groundSmash: {
    gain: 1,
    layers: [
      tone('sine', 88, 28, 0.62, 1, 0.004),
      noise('lowpass', 2600, 150, 0.9, 0.36, 0.95, 0.004),
      tone('square', 540, 150, 0.07, 0.2, 0.002),
      noise('bandpass', 2400, 800, 0.9, 0.34, 0.42, 0.012, 0.05),
      noise('highpass', 3600, 7200, 0.8, 0.26, 0.3, 0.02, 0.12),
    ],
  },

  // ---- 溜め（長押し） ----
  /** 構えに入った: 低く息を吸う */
  chargeStart: { gain: 0.55, layers: [noise('bandpass', 300, 900, 0.9, 0.22, 0.5, 0.08), tone('sine', 140, 210, 0.2, 0.3, 0.05)] },
  /** 段階が上がった合図（1 → 2 で音が高くなる） */
  chargeLevel1: { gain: 0.7, layers: [tone('triangle', 880, 1175, 0.12, 0.5), tone('sine', 1760, 1760, 0.1, 0.18, 0.005, 0.03)] },
  chargeLevel2: { gain: 0.8, layers: [tone('triangle', 1175, 1760, 0.14, 0.55), tone('triangle', 1760, 2349, 0.16, 0.4, 0.005, 0.07), noise('highpass', 4000, 8000, 0.7, 0.18, 0.35, 0.02)] },

  // ---- ガード・パリィ・装備（ADR-020） ----
  /** 構えに入る: 盾（剣）を前へ出す短い風切り */
  guardUp: { gain: 0.9, layers: [noise('bandpass', 500, 1700, 0.9, 0.13, 0.9, 0.03), tone('sine', 190, 280, 0.1, 0.4, 0.01)] },
  /** ガードで受け止めた: 金属の「ガン」。高い響きと低い衝撃 */
  guard: {
    gain: 1,
    layers: [noise('bandpass', 2600, 800, 1.1, 0.1, 0.8), tone('square', 1700, 850, 0.06, 0.22), tone('triangle', 640, 320, 0.15, 0.5), tone('sine', 150, 72, 0.17, 0.8)],
  },
  /** パリィ（弾いた）: 澄んだ「キィン」と強い衝撃。受け止めたときよりずっと高く長く響く */
  parry: {
    gain: 1,
    layers: [
      tone('triangle', 2300, 3000, 0.24, 0.45),
      tone('sine', 1150, 1700, 0.3, 0.34, 0.005, 0.012),
      noise('highpass', 3200, 9000, 0.8, 0.15, 0.65, 0.005),
      tone('square', 900, 420, 0.06, 0.25),
      tone('sine', 120, 60, 0.2, 0.7),
    ],
  },
  /** 大剣のパリィ（弾き飛ばした）: 「キィン」に、体の芯に響く低い衝撃と唸りを足した、パリィより重く長い音 */
  parryDown: {
    gain: 1,
    layers: [
      tone('triangle', 1900, 2700, 0.3, 0.42),
      tone('sine', 950, 1500, 0.36, 0.32, 0.005, 0.012),
      noise('highpass', 2800, 8500, 0.8, 0.2, 0.6, 0.005),
      tone('square', 760, 320, 0.07, 0.24),
      tone('sine', 92, 40, 0.42, 0.9),
      noise('lowpass', 1500, 180, 0.8, 0.3, 0.55, 0.01, 0.02),
    ],
  },
  /** 倒れた敵が地面に落ちる: 鈍い「ドサッ」 */
  knockdown: { gain: 0.9, layers: [tone('sine', 120, 38, 0.3, 0.9), noise('lowpass', 1000, 120, 0.8, 0.22, 0.55, 0.008)] },
  /** 装備を替えた: 2 音の金属の合図（上がっていく） */
  equip: { gain: 0.7, layers: [tone('triangle', 520, 780, 0.07, 0.5), tone('triangle', 780, 1040, 0.09, 0.45, 0.005, 0.07), noise('highpass', 3500, 7000, 0.7, 0.06, 0.25, 0.005)] },

  // ---- 命中 ----
  hit: { gain: 1, layers: [noise('highpass', 900, 600, 0.8, 0.07, 0.9), tone('sine', 230, 85, 0.1, 1), tone('square', 1500, 620, 0.035, 0.16)] },
  hitHeavy: { gain: 1, layers: [noise('lowpass', 3200, 280, 0.8, 0.24, 0.85), tone('sine', 160, 42, 0.28, 0.95), tone('square', 1100, 380, 0.05, 0.16)] },
  /** 敵を倒した: 命中の上に、下がっていく音と散る音 */
  kill: { gain: 0.9, layers: [tone('sine', 640, 110, 0.38, 0.55, 0.01, 0.02), noise('bandpass', 2400, 500, 0.9, 0.34, 0.5, 0.01, 0.02), tone('triangle', 960, 320, 0.26, 0.3, 0.01, 0.06)] },

  // ---- プレイヤーの被弾 ----
  hurt: { gain: 1, layers: [tone('sine', 190, 62, 0.26, 1), tone('sawtooth', 340, 140, 0.18, 0.3), noise('lowpass', 1800, 260, 0.8, 0.14, 0.7)] },

  // ---- 敵 ----
  /** 予備動作の合図（短い 2 音。聞いて避ける） */
  telegraph: { gain: 0.5, layers: [tone('triangle', 700, 880, 0.09, 0.5), tone('triangle', 880, 1080, 0.1, 0.45, 0.005, 0.1)] },
  enemySwing: { gain: 0.7, layers: [noise('bandpass', 800, 2400, 1.0, 0.2, 0.8, 0.04), tone('sine', 120, 70, 0.2, 0.3, 0.03)] },

  // ---- ロックオン・UI・進行 ----
  lock: { gain: 0.9, layers: [tone('square', 880, 1320, 0.06, 0.4), tone('triangle', 1760, 1760, 0.06, 0.3, 0.005, 0.045)] },
  switch: { gain: 1, layers: [tone('triangle', 1250, 1500, 0.05, 0.75)] },
  unlock: { gain: 1, layers: [tone('triangle', 900, 560, 0.08, 0.75)] },
  ui: { gain: 1, layers: [tone('triangle', 660, 990, 0.07, 0.8)] },
  wave: { gain: 0.6, layers: [noise('bandpass', 400, 2200, 0.8, 0.5, 0.5, 0.2), tone('sine', 300, 600, 0.45, 0.3, 0.12)] },
  victory: {
    gain: 0.6,
    layers: [
      tone('triangle', 523, 523, 0.34, 0.5, 0.01, 0),
      tone('triangle', 659, 659, 0.34, 0.5, 0.01, 0.13),
      tone('triangle', 784, 784, 0.34, 0.5, 0.01, 0.26),
      tone('triangle', 1047, 1047, 0.6, 0.55, 0.01, 0.4),
      tone('sine', 2093, 2093, 0.5, 0.18, 0.01, 0.4),
    ],
  },
  defeat: { gain: 0.65, layers: [tone('sine', 392, 196, 0.7, 0.6, 0.02), tone('sawtooth', 196, 98, 0.8, 0.16, 0.04, 0.05), noise('lowpass', 900, 120, 0.7, 0.5, 0.3, 0.05)] },
} as const satisfies Record<string, SfxDef>;

export type SfxName = keyof typeof SFX;

/** 同時に鳴らせる音の数の上限（iPad の負荷とクリップを避ける） */
export const MAX_VOICES = 24;
/** マスター音量（0..1） */
export const MASTER_GAIN = 0.8;
