/**
 * 攻撃のフレームデータ（ADR-004）。単位はすべて sim フレーム（60Hz）。
 * M0 ではプレースホルダーの振りモーションがこの値を参照する。M2 でヒットボックス等を追加する。
 */

export interface AttackDef {
  id: string;
  /** 発生: 入力からヒット判定が出るまで */
  startup: number;
  /** 持続: ヒット判定が出ている間 */
  active: number;
  /** 硬直: 判定終了から次の行動が自由になるまで */
  recovery: number;
  /** この攻撃開始から何フレーム目で次段へのキャンセル入力が受け付けられるか */
  cancelFrame: number;
  /** 持続中に前進する距離（m） */
  lunge: number;
  /** 次段の攻撃 id。なければコンボ終端 */
  next?: string;
  /** プレースホルダー用: 剣先の向きキーフレーム（キャラ基準 x右 y上 z前）。windup → mid → end */
  swing: { windup: [number, number, number]; mid: [number, number, number]; end: [number, number, number] };
}

export const ATTACKS: Record<string, AttackDef> = {
  slash1: {
    id: 'slash1',
    startup: 6,
    active: 6,
    recovery: 14,
    cancelFrame: 13,
    lunge: 0.7,
    next: 'slash2',
    swing: { windup: [0.9, 0.25, -0.35], mid: [0.25, 0.15, 1.0], end: [-0.9, 0.05, 0.45] },
  },
  slash2: {
    id: 'slash2',
    startup: 5,
    active: 6,
    recovery: 16,
    cancelFrame: 12,
    lunge: 0.6,
    next: 'slash3',
    swing: { windup: [-0.85, 0.35, 0.25], mid: [0.1, 0.2, 1.0], end: [0.9, -0.05, 0.3] },
  },
  slash3: {
    id: 'slash3',
    startup: 9,
    active: 7,
    recovery: 24,
    cancelFrame: 999, // 終端。コンボは繋がらない
    lunge: 1.1,
    swing: { windup: [0.3, 1.0, -0.35], mid: [0.2, 0.55, 0.85], end: [0.05, -0.55, 0.85] },
  },
};

export function attackTotalFrames(a: AttackDef): number {
  return a.startup + a.active + a.recovery;
}

export const DODGE = {
  /** 全体フレーム */
  frames: 20,
  /** 無敵フレーム（開始からの範囲、両端含む）。M2 でヒット判定に使う */
  invulnStart: 2,
  invulnEnd: 13,
  /** 初速（m/s）。ease-out で減衰 */
  speed: 11,
  /** この フレーム以降は攻撃でキャンセル可能 */
  cancelFrame: 13,
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
