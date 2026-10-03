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
