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

export const ATTACKS: Record<string, AttackDef> = {
  // 1 段目: Right_Hand_Sword_Slash（区間 0.1〜1.35s）。剣先の速度（tools/scratch/game-tip.mjs で実測）では
  // 頭上へ振りかぶって前へ斬り下ろす一撃が主で、剣先は 区間内 0.35〜0.5s に体の前を通る（ピーク 0.39s）。
  // その後の振り上げ（0.55〜0.65s）は当たり判定なしの余韻なので、次段は斬り下ろしの直後から受け付ける。
  combo1: {
    id: 'combo1',
    segment: 'combo1',
    segmentDuration: 1.25,
    activeStart: 0.35,
    activeEnd: 0.53,
    cancelAt: 0.55,
    rate: 1.6,
    lunge: 0.6,
    next: 'combo2',
    damage: 10,
    hitStop: 4,
    knockback: 0.3,
  },
  // 2 段目: Left_Slash の 1 振り目（区間 0.2〜0.9s）。頭上へ構えてから、斬り下ろし → 右へ低く薙ぐ。
  // 剣先が体の前を通るのは 区間内 0.35〜0.58s（ピーク 0.38s）。2 振り目は 0.85s ごろから始まるので手前で切る。
  combo2: {
    id: 'combo2',
    segment: 'combo2',
    segmentDuration: 0.7,
    activeStart: 0.35,
    activeEnd: 0.58,
    cancelAt: 0.62,
    rate: 1.5,
    lunge: 0.5,
    next: 'combo3',
    damage: 12,
    hitStop: 5,
    knockback: 0.4,
    fade: 0.12,
  },
  // 3 段目: Thrust_Slash の突き（区間 0.35〜1.2s、clip を +90° 回して前へ突く向きに直してある）。
  // 剣先が前へ伸び切るのは 区間内 0.32〜0.46s（元クリップ 0.67〜0.81s）。突いたあとは構えを解いて元へ戻る。
  // 2 段目の終わり（剣が右下）から突きの構えまでの姿勢差が大きいので、フェードを長めにして剣先の瞬間移動を和らげる
  combo3: {
    id: 'combo3',
    segment: 'combo3',
    segmentDuration: 0.85,
    activeStart: 0.32,
    activeEnd: 0.47,
    cancelAt: 999,
    rate: 1.3,
    lunge: 0.7,
    damage: 18,
    hitStop: 8,
    knockback: 1.2,
    fade: 0.18,
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
