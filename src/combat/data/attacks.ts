/**
 * 攻撃のフレームデータ（ADR-004）。
 * 定義はアニメーション区間上の「秒」で書き、resolveAttack() が sim フレーム（60Hz）に変換する。
 * これにより再生速度（rate）を変えても発生・持続・硬直の対応が崩れない。
 */

import { rootZCurve, type AuthoredAttack } from '../../character/authoring';
import { COMBO1 } from '../../character/data/combo1';
import { COMBO2 } from '../../character/data/combo2';
import { COMBO3 } from '../../character/data/combo3';
import { DODGE_BACK, DODGE_CLIP } from '../../character/data/dodge';
import { HEAVY, HEAVY_CHARGE } from '../../character/data/heavy';
import { LUNGE } from '../../character/data/lunge';
import { DASH } from '../../character/data/dash';
import { RETREAT } from '../../character/data/retreat';
import { SWEEP } from '../../character/data/sweep';
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
  // 重撃（溜めを放つ）: 手付けの縦斬り（src/character/data/heavy.ts、0.62s）。溜め（CHARGES.sword の構え = 頭上）から始まり、右足を踏み込んで 0.18s に剣が体の前を水平に通る最高速（約 84m/s）、
  // 0.25s で前下に叩きつけて止まる。当たりは最高速の前後 0.15〜0.23s（5 フレーム）。右足が 0.18s に腰の 0.4 m 前へ飛び込んで着地し、ルートは 0.81m 進む（単発なので戻りの途中まで進んでよい）。
  // 溜めの段階で威力が上がる（CHARGES.sword.levelPower）。次段は無い（単発）。
  heavy: {
    id: 'heavy',
    segment: 'heavy',
    authored: HEAVY,
    segmentDuration: HEAVY.duration,
    activeStart: 0.15,
    activeEnd: 0.23,
    cancelAt: 999,
    trail: [0.1, 0.34],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'arc', range: 2.2, halfAngle: deg(55) },
    damage: 34,
    hitStop: 12,
    knockback: 2.2,
    fade: 0.04,
  },
  // 踏み込み突き（スティック前 + 攻撃）: 大きく踏み込んで体ごと突く。距離を詰める技。右足が 0.21s に腰の 0.45 m 前へ着地し、ルートは 1.3 m 進む。当たりは最高速（0.21s）の前後 0.17〜0.27s。
  lunge: {
    id: 'lunge',
    segment: 'lunge',
    authored: LUNGE,
    segmentDuration: LUNGE.duration,
    activeStart: 0.17,
    activeEnd: 0.27,
    cancelAt: 999,
    trail: [0.12, 0.34],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'line', length: 2.6, radius: 0.34 },
    damage: 14,
    hitStop: 7,
    knockback: 1.4,
    fade: 0.06,
  },
  // ダッシュ斬り（ロール直後）: 着地の低い姿勢から、右足を踏み込んで剣を右下から左上へ斜めにすくい上げる（逆袈裟の斬り上げ）。0.17s に剣が前を通る最高速。当たりは 0.14〜0.23s。ロールの着地の姿勢から続ける（continueFrom）。
  dash: {
    id: 'dash',
    segment: 'dash',
    authored: DASH,
    segmentDuration: DASH.duration,
    activeStart: 0.14,
    activeEnd: 0.23,
    cancelAt: 999,
    trail: [0.09, 0.32],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'arc', range: 2.2, halfAngle: deg(70) },
    damage: 16,
    hitStop: 8,
    knockback: 1.0,
    fade: 0.05,
  },
  // 下がりながらの払い（ロック中に後ろ + 攻撃）: 後ろへ 1.1 m 跳びながら右から左へ水平に払って敵を押し返す。0.16s に前を通る最高速。当たりは 0.135〜0.215s（跳び始め）。
  retreat: {
    id: 'retreat',
    segment: 'retreat',
    authored: RETREAT,
    segmentDuration: RETREAT.duration,
    activeStart: 0.135,
    activeEnd: 0.215,
    cancelAt: 999,
    trail: [0.1, 0.3],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'arc', range: 2.1, halfAngle: deg(85) },
    damage: 9,
    hitStop: 5,
    knockback: 1.8,
    fade: 0.06,
  },
  // 横薙ぎ（ロック中に横 + 攻撃）: 右へ大きくひねって溜め、左足を踏み込みながら体ごと右から左へ水平に薙ぐ。範囲が広い。0.23s に前を通る最高速。当たりは 0.19〜0.28s。
  sweep: {
    id: 'sweep',
    segment: 'sweep',
    authored: SWEEP,
    segmentDuration: SWEEP.duration,
    activeStart: 0.19,
    activeEnd: 0.28,
    cancelAt: 999,
    trail: [0.15, 0.38],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'arc', range: 2.2, halfAngle: deg(105) },
    damage: 13,
    hitStop: 6,
    knockback: 1.2,
    fade: 0.07,
  },
};

/**
 * 溜め（攻撃の長押し。ADR-018）: 1 段目を CHARGE_HOLD_FRAMES 押し続けると、1 段目の予備動作の途中の姿勢から構えのクリップ（頭上へ振りかぶる）へ移り、そこで止まる。
 * 離すと next（重撃）を放つ。構えが整ってからの保持の長さで段階が上がり、威力が上がる。
 */
export interface ChargeDef {
  id: string;
  /** 構えへ入る手付けのクリップ。終端の姿勢で止まる */
  clip: AuthoredAttack;
  /** クリップのフレーム数（この間は離しても構えを続け、整ってから放つ） */
  frames: number;
  /** 構えが整ってから、この保持フレーム数以上で段階 1, 2, … になる */
  levels: readonly number[];
  /** 段階ごとの威力の倍率（長さ = levels.length + 1。ダメージ・ノックバック・ヒットストップに掛かる） */
  levelPower: readonly number[];
  /** 構えのまま保てる最大のフレーム数（超えたら自動で放つ） */
  maxHoldFrames: number;
  /** 放つ攻撃の id（ATTACKS のキー） */
  next: string;
  /** 構えに入ってからこのフレーム以降は、回避でキャンセルできる */
  dodgeCancelFrame: number;
}

export const CHARGES: Record<string, ChargeDef> = {
  sword: {
    id: 'sword',
    clip: HEAVY_CHARGE,
    frames: Math.ceil(HEAVY_CHARGE.duration * 60),
    levels: [24, 54],
    levelPower: [1, 1.25, 1.6],
    maxHoldFrames: 100,
    next: 'heavy',
    dodgeCancelFrame: 8,
  },
};

/** 回避の種類。ロール（入力方向へ向きを変えて前転）と、後ろステップ（向きを保って後ろへ跳ぶ） */
export type DodgeKind = 'roll' | 'back';

export interface DodgeDef {
  id: DodgeKind;
  /** 手付けのクリップ（src/character/data/dodge.ts） */
  clip: AuthoredAttack;
  /** 全体フレーム */
  frames: number;
  /** 無敵フレーム（開始からの範囲、両端含む） */
  invulnStart: number;
  invulnEnd: number;
  /** このフレーム以降は攻撃でキャンセル可能 */
  cancelFrame: number;
  /** ルートの前進カーブ（開始からの秒 → m。負は後ろ）。Player.stepDodge が毎ステップの差分で動く */
  root: (t: number) => number;
}

/**
 * 回避（手付け。src/character/data/dodge.ts）。前進は各クリップの rootZ のカーブに従う（攻撃の rootMotionOf と同じ）。
 *  - ロール: 0.08〜0.40s に体を丸めて転がり（約 2.1m）、0.43s に足から着地する。無敵は 3〜22f（蹴り出しから着地の寸前まで）
 *  - 後ろステップ: 0.07〜0.30s に後ろへ 2.0m 跳ぶ（空中は 0.12〜0.27s）。無敵は 2〜16f
 */
export const DODGES: Record<DodgeKind, DodgeDef> = {
  roll: {
    id: 'roll',
    clip: DODGE_CLIP,
    frames: Math.ceil(DODGE_CLIP.duration * 60),
    invulnStart: 3,
    invulnEnd: 22,
    cancelFrame: 26,
    root: rootZCurve(DODGE_CLIP),
  },
  back: {
    id: 'back',
    clip: DODGE_BACK,
    frames: Math.ceil(DODGE_BACK.duration * 60),
    invulnStart: 2,
    invulnEnd: 16,
    cancelFrame: 22,
    root: rootZCurve(DODGE_BACK),
  },
};

/** どちらの回避を出すかの規則。ロック中に、対象から離れる向き（正面の真後ろ ± backCone）へスティックを倒していれば後ろステップ */
export const DODGE_RULES = {
  /** 度 */
  backConeDeg: 50,
} as const;

/** ロール（代表）。クリップ・無敵・キャンセルの検査と、既存の参照用 */
export const DODGE = DODGES.roll;

/** ロールの前進カーブ（開始からの秒 → ルートの前進量 m） */
export const dodgeRoot: (t: number) => number = DODGES.roll.root;

/** プレイヤーの被弾（敵の攻撃を受けたとき） */
export const HIT_STUN = {
  /** ひるみフレーム（アニメ区間 0.6 秒 / rate 1.5 = 0.4 秒）。この間は何もできない */
  frames: 24,
  /** ノックバックをかけるフレーム数（距離は敵の攻撃データ） */
  knockbackFrames: 10,
  /** 被弾から無敵になるフレーム（ひるみの 24f を含む。起き上がってから少し動ける） */
  invulnFrames: 56,
} as const;

export const PLAYER_STATS = {
  maxHp: 100,
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
