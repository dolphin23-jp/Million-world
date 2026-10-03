/**
 * 攻撃のフレームデータ（ADR-004）。
 * 定義はアニメーション区間上の「秒」で書き、resolveAttack() が sim フレーム（60Hz）に変換する。
 * これにより再生速度（rate）を変えても発生・持続・硬直の対応が崩れない。
 */

export interface AttackDef {
  id: string;
  /** 使うアニメーション区間名（src/character/data/hero.ts の segments） */
  segment: string;
  /** 区間の長さ（秒）。resolve 時にアニメーター側の実測で上書きしてもよい */
  segmentDuration: number;
  /** 区間先頭からの秒: ヒット判定の開始・終了、次段キャンセル受付の開始 */
  activeStart: number;
  activeEnd: number;
  cancelAt: number;
  /** 再生速度 */
  rate: number;
  /** 持続中に前進する距離（m） */
  lunge: number;
  /** 次段の攻撃 id。なければコンボ終端 */
  next?: string;
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

export const ATTACKS: Record<string, AttackDef> = {
  // Triple_Combo_Attack の 1 段目: 振りかぶって斬り下ろし（右手ピーク 0.78s）
  combo1: {
    id: 'combo1',
    segment: 'combo1',
    segmentDuration: 1.0,
    activeStart: 0.68,
    activeEnd: 0.86,
    cancelAt: 0.84,
    rate: 1.9,
    lunge: 0.6,
    next: 'combo2',
    damage: 10,
    hitStop: 4,
    knockback: 0.3,
  },
  // 2 段目: 振り上げからの横薙ぎ（ピーク 1.60s → 区間内 0.60s）
  combo2: {
    id: 'combo2',
    segment: 'combo2',
    segmentDuration: 0.8,
    activeStart: 0.48,
    activeEnd: 0.72,
    cancelAt: 0.7,
    rate: 1.7,
    lunge: 0.5,
    next: 'combo3',
    damage: 12,
    hitStop: 5,
    knockback: 0.4,
  },
  // 3 段目: 回転からの大振り（ピーク 2.30s → 区間内 0.50s）
  combo3: {
    id: 'combo3',
    segment: 'combo3',
    segmentDuration: 0.9,
    activeStart: 0.4,
    activeEnd: 0.62,
    cancelAt: 999,
    rate: 1.6,
    lunge: 0.9,
    damage: 18,
    hitStop: 8,
    knockback: 1.2,
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
  runSpeed: 5.2,
  /** 加速度（m/s^2） */
  accel: 40,
  /** 減速度（m/s^2） */
  decel: 48,
  /** 旋回速度（rad/s） */
  turnSpeed: 14,
  /** キャラの衝突半径（m） */
  radius: 0.38,
} as const;
