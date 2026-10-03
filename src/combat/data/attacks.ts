/**
 * 攻撃のフレームデータ（ADR-004）。
 * 定義はアニメーション区間上の「秒」で書き、resolveAttack() が sim フレーム（60Hz）に変換する。
 * これにより再生速度（rate）を変えても発生・持続・硬直の対応が崩れない。
 */

import { rootZCurve, type AuthoredAttack } from '../../character/authoring';
import { COMBO1 } from '../../character/data/combo1';
import { COMBO2 } from '../../character/data/combo2';
import { COMBO3 } from '../../character/data/combo3';

export interface AttackDef {
  id: string;
  /** 使うアニメーション区間名（src/character/data/hero.ts の segments）。手付けの攻撃ではクリップ名（authored.name） */
  segment: string;
  /** 手付けアニメ（ADR-012）。あれば前進は lunge ではなく、この rootZ のカーブに従う */
  authored?: AuthoredAttack;
  /** 区間の長さ（秒）。resolve 時にアニメーター側の実測で上書きしてもよい */
  segmentDuration: number;
  /** 区間先頭からの秒: ヒット判定の開始・終了、次段キャンセル受付の開始 */
  activeStart: number;
  activeEnd: number;
  cancelAt: number;
  /** 再生速度 */
  rate: number;
  /** 持続中に前進する距離（m）。手付け（authored）の攻撃では使わない */
  lunge: number;
  /** 次段の攻撃 id。なければコンボ終端 */
  next?: string;
  /** この攻撃へ入るときのクロスフェード秒（省略時 0.08）。前の技との姿勢差が大きいほど長くする */
  fade?: number;
  /** M2 で使う: ダメージ・ヒットストップ長（フレーム）・ノックバック（m） */
  damage: number;
  hitStop: number;
  knockback: number;
}

export interface AttackFrames {
  startup: number;
  active: number;
  recovery: number;
  cancelFrame: number;
  total: number;
}

export function resolveAttack(a: AttackDef): AttackFrames {
  const toFrames = (sec: number) => Math.max(0, Math.round((sec * 60) / a.rate));
  const startup = toFrames(a.activeStart);
  const activeEndF = Math.max(startup + 1, toFrames(a.activeEnd));
  const total = Math.max(activeEndF + 1, toFrames(a.segmentDuration));
  return {
    startup,
    active: activeEndF - startup,
    recovery: total - activeEndF,
    cancelFrame: Math.min(total, Math.max(activeEndF, toFrames(a.cancelAt))),
    total,
  };
}

/** 手付けの攻撃の前進カーブ（開始からの秒 → ルートの前進量 m）。初回に作って使い回す */
const rootCurves = new Map<string, (t: number) => number>();
export function rootMotionOf(a: AttackDef): ((t: number) => number) | null {
  if (!a.authored) return null;
  let c = rootCurves.get(a.id);
  if (!c) rootCurves.set(a.id, (c = rootZCurve(a.authored)));
  return c;
}

export const ATTACKS: Record<string, AttackDef> = {
  // 1 段目: 手付けの右袈裟斬り（src/character/data/combo1.ts、0.6s）。予備動作 0 → 0.17、斬り 0.17 → 0.31。
  // 剣先は 0.245s に体の前を通る最高速（約 85m/s = 1 フレーム 1.4m。tools/scratch/combo-diag.scratch.ts で実測）なので、当たりはその前後 0.21〜0.29s。
  // 振り抜き（〜0.37s）の終わりから次段を受け付ける。踏み込みは rootZ（0.3m）。
  combo1: {
    id: 'combo1',
    segment: 'combo1',
    authored: COMBO1,
    segmentDuration: COMBO1.duration,
    activeStart: 0.21,
    activeEnd: 0.29,
    cancelAt: 0.37,
    rate: 1,
    lunge: 0,
    next: 'combo2',
    damage: 10,
    hitStop: 4,
    knockback: 0.3,
  },
  // 2 段目: 手付けの右逆袈裟（src/character/data/combo2.ts、0.52s）。1 段目の受付時点（0.37s）の姿勢から続けて始まる（continueFrom）。
  // 剣先が体の前を通る最高速は 0.15s。当たりはその前後 0.13〜0.2s。振り抜き（〜0.32s）の終わりから次段を受け付ける。踏み込みは rootZ（0.24m）。
  combo2: {
    id: 'combo2',
    segment: 'combo2',
    authored: COMBO2,
    segmentDuration: COMBO2.duration,
    activeStart: 0.13,
    activeEnd: 0.2,
    cancelAt: 0.32,
    rate: 1,
    lunge: 0,
    next: 'combo3',
    damage: 12,
    hitStop: 5,
    knockback: 0.4,
    fade: 0.05,
  },
  // 3 段目: 手付けの突き（src/character/data/combo3.ts、0.62s）。2 段目の受付時点（0.32s）の姿勢から続けて始まる。
  // 引き絞りは 0〜0.13s、突き出しは 0.13〜0.2s（剣先が体の前へ伸び切る）。当たりは 0.15〜0.24s。踏み込みは rootZ（0.3m）。
  combo3: {
    id: 'combo3',
    segment: 'combo3',
    authored: COMBO3,
    segmentDuration: COMBO3.duration,
    activeStart: 0.15,
    activeEnd: 0.24,
    cancelAt: 999,
    rate: 1,
    lunge: 0,
    damage: 18,
    hitStop: 8,
    knockback: 1.2,
    fade: 0.05,
  },
};

export const DODGE = {
  /** 全体フレーム（アニメ区間 1.1 秒 / rate 2.2 = 0.5 秒） */
  frames: 30,
  /** 無敵フレーム（開始からの範囲、両端含む） */
  invulnStart: 3,
  invulnEnd: 18,
  /** 初速（m/s）。ease-out で減衰 */
  speed: 9.5,
  /** このフレーム以降は攻撃でキャンセル可能 */
  cancelFrame: 20,
} as const;

export const HIT_STUN = {
  /** ひるみフレーム（アニメ区間 0.6 秒 / rate 1.5 = 0.4 秒） */
  frames: 24,
} as const;

export const MOVE = {
  runSpeed: 4.8,
  /** 加速度（m/s^2） */
  accel: 40,
  /** 減速度（m/s^2） */
  decel: 48,
  /** 旋回速度（rad/s） */
  turnSpeed: 14,
  /** キャラの衝突半径（m） */
  radius: 0.38,
} as const;
