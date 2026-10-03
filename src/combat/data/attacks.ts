/**
 * 攻撃のフレームデータ（ADR-004）。
 * 定義はアニメーション区間上の「秒」で書き、resolveAttack() が sim フレーム（60Hz）に変換する。
 * これにより再生速度（rate）を変えても発生・持続・硬直の対応が崩れない。
 */

import { rootZCurve, type AuthoredAttack } from '../../character/authoring';
import { COMBO1 } from '../../character/data/combo1';
import { COMBO2 } from '../../character/data/combo2';
import { COMBO3 } from '../../character/data/combo3';
import { DODGE_CLIP } from '../../character/data/dodge';
import { HEAVY } from '../../character/data/heavy';
import type { HitboxDef } from '../hit';

const deg = (d: number) => (d * Math.PI) / 180;

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
  /** 剣筋（トレイル）を出す区間。区間先頭からの秒 [開始, 終了]。持続フレームの少し前から、振り抜きの終わりまで */
  trail: readonly [number, number];
  /** 再生速度 */
  rate: number;
  /** 持続中に前進する距離（m）。手付け（authored）の攻撃では使わない */
  lunge: number;
  /** 次段の攻撃 id。なければコンボ終端 */
  next?: string;
  /** この攻撃へ入るときのクロスフェード秒（省略時 0.08）。前の技との姿勢差が大きいほど長くする */
  fade?: number;
  /**
   * 当たる領域（攻撃者の XZ 位置・向きに付く。ADR-014）。持続フレーム（activeStart〜activeEnd）のあいだ毎フレーム評価する。
   * 数値は技の見た目に合わせる: 斬りは振りの弧（扇形）、突きは剣の伸びる線。届く距離は腕と剣の長さ（約 1.8m）＋ 踏み込み分
   */
  hitbox: HitboxDef;
  /** ダメージ・ヒットストップ長（sim フレーム）・ノックバック（m） */
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
  // 1 段目: 手付けの右袈裟斬り（src/character/data/combo1.ts、0.66s）。予備動作 0 → 0.17、斬り 0.17 → 0.31。
  // 剣先は 0.233s に体の前を通る最高速（約 89m/s = 1 フレーム 1.5m。tools/scratch/combo-diag.scratch.ts で実測）なので、当たりはその前後 0.20〜0.28s。
  // 前足（左）は 0.235 に腰の 0.36 m 前へ着地し（腰が 0.14 m 沈む）、ルートは 0.57m 進む（0.37s まで）。振り抜き（〜0.37s）の終わりから次段を受け付ける。
  combo1: {
    id: 'combo1',
    segment: 'combo1',
    authored: COMBO1,
    segmentDuration: COMBO1.duration,
    activeStart: 0.2,
    activeEnd: 0.28,
    cancelAt: 0.37,
    trail: [0.14, 0.38],
    rate: 1,
    lunge: 0,
    next: 'combo2',
    hitbox: { kind: 'arc', range: 2.0, halfAngle: deg(65) },
    damage: 10,
    hitStop: 4,
    knockback: 0.3,
  },
  // 2 段目: 手付けの右逆袈裟（src/character/data/combo2.ts、0.67s）。1 段目の受付時点（0.37s）の姿勢から続けて始まる（continueFrom）。
  // 右足が弧を描いて 0.16s に腰の 0.3 m 前へ着地し、剣先が体の前を通る最高速は 0.167s（約 67m/s）。当たりはその前後 0.14〜0.21s。
  // 振り抜き（〜0.34s）の終わりから次段を受け付ける。踏み込みはルート 0.58m（0.26s まで）。
  combo2: {
    id: 'combo2',
    segment: 'combo2',
    authored: COMBO2,
    segmentDuration: COMBO2.duration,
    activeStart: 0.14,
    activeEnd: 0.21,
    cancelAt: 0.34,
    trail: [0.09, 0.32],
    rate: 1,
    lunge: 0,
    next: 'combo3',
    hitbox: { kind: 'arc', range: 2.0, halfAngle: deg(65) },
    damage: 12,
    hitStop: 5,
    knockback: 0.4,
    fade: 0.05,
  },
  // 3 段目: 手付けの突き（src/character/data/combo3.ts、0.64s）。2 段目の受付時点（0.34s）の姿勢から続けて始まる。
  // 引き絞りは 0〜0.13s、突き出しは 0.13〜0.2s（剣先が体の前へ伸び切る）。右足は 0.17s に着地し、当たりは 0.15〜0.24s。
  // 踏み込みは幅 0.8m のランジでルート 0.6m（0.3s まで）。
  combo3: {
    id: 'combo3',
    segment: 'combo3',
    authored: COMBO3,
    segmentDuration: COMBO3.duration,
    activeStart: 0.15,
    activeEnd: 0.24,
    cancelAt: 999,
    trail: [0.1, 0.34],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'line', length: 2.2, radius: 0.3 },
    damage: 18,
    hitStop: 8,
    knockback: 1.2,
    fade: 0.05,
  },
  // 重撃: 手付けの縦斬り（src/character/data/heavy.ts、1.0s）。0.44s まで頂点で振りかぶり、0.51s に剣が体の前を水平に通る最高速（約 84m/s）、
  // 0.58s で前下に叩きつけて止まる。当たりは最高速の前後 0.47〜0.56s（6 フレーム）。右足が 0.5s に腰の 0.37 m 前へ飛び込んで着地し（幅 0.74m、腰が 0.17 m 沈む）、
  // ルートは 0.81m 進む（単発なので戻りの途中まで進んでよい）。
  // 発生が遅い代わりに威力が大きい。次段は無い（単発）。
  heavy: {
    id: 'heavy',
    segment: 'heavy',
    authored: HEAVY,
    segmentDuration: HEAVY.duration,
    activeStart: 0.47,
    activeEnd: 0.56,
    cancelAt: 999,
    trail: [0.41, 0.66],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'arc', range: 2.2, halfAngle: deg(55) },
    damage: 34,
    hitStop: 12,
    knockback: 2.2,
    fade: 0.12,
  },
};

/**
 * 回避（手付けのダッシュ、src/character/data/dodge.ts）。前進は DODGE_CLIP の rootZ のカーブに従う（攻撃の rootMotionOf と同じ）。
 * 0.04〜0.34s は前へ飛び出して（最高 10 m/s）両足が浮く瞬間を含むので、無敵はそこに合わせる。0.43s 以降は減速して立ち上がり始める。
 */
export const DODGE = {
  /** 手付けのクリップ */
  clip: DODGE_CLIP,
  /** 全体フレーム（クリップ 0.58 秒） */
  frames: Math.ceil(DODGE_CLIP.duration * 60),
  /** 無敵フレーム（開始からの範囲、両端含む） */
  invulnStart: 3,
  invulnEnd: 20,
  /** このフレーム以降は攻撃でキャンセル可能（立ち上がりの手前） */
  cancelFrame: 26,
} as const;

/** 回避の前進カーブ（開始からの秒 → ルートの前進量 m） */
export const dodgeRoot: (t: number) => number = rootZCurve(DODGE_CLIP);

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
