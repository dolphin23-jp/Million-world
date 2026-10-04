import { ATTACKS, type AttackDef, type HitWindow } from './attacks';
import { FLURRY, FLURRY_COUNT, QUAD3, QUAD3_HOLD_T, QUAD4, QUAD4_HOLD_T, WHIRL, WHIRL_PASSES, WHIRL_STOP_T, flurryThrustT } from '../../character/data/skill-sword';
import { GSK_ISSEN, GSK_SLAM, GSK_SLAM_IMPACT_T, GSK_SWEEP1, GSK_SWEEP1_HOLD_T, GSK_SWEEP2, GSK_SWEEP2_HOLD_T, ISSEN_DASH_FROM, ISSEN_PASS_T } from '../../character/data/skill-greatsword';
import type { HitboxDef } from '../hit';

const deg = (d: number) => (d * Math.PI) / 180;

/**
 * 剣技専用の攻撃（ADR-031）。ふつうの攻撃（ATTACKS = 操作で出る技）とは別の表にする: 剣技の攻撃は発生が速い・全体が長い・多段ヒットなど、
 * ATTACKS 全体にかけている「発生 ≥ 8f・全体 ≤ 60f」などの検査の外にある。クリップは AUTHORED_ATTACKS に同じように登録する（盾版・大剣版の検査の対象）。
 * 剣技の連なりの段（SkillStepDef.attack）は、ATTACKS か ここ のどちらかの id を指す（findAttack が探す）。
 */
export const SKILL_ATTACKS: Record<string, AttackDef> = {};

/** 既存の攻撃を、剣技の連なりの 1 段として速めて使う（次段・分岐は剣技の連なりが決めるので持たない） */
function reuse(base: AttackDef, id: string, rate: number): AttackDef {
  const { next: _next, branches: _branches, ...rest } = base;
  return { ...rest, id, rate };
}

/** 窓を等間隔・同じ形で並べる */
function windows(times: readonly number[], pre: number, post: number, extra: Partial<HitWindow> | ((i: number) => Partial<HitWindow>)): HitWindow[] {
  return times.map((t, i) => ({ start: t - pre, end: t + post, ...(typeof extra === 'function' ? extra(i) : extra) }));
}

// ---------------------------------------------------------------- 片手剣
// 四連斬（四ツ葉）: 右袈裟 → 右逆袈裟（既存の combo1 / combo2 を速めて）→ 左袈裟 → 左逆袈裟（新しい動き）
SKILL_ATTACKS.skQuad1 = reuse(ATTACKS.combo1!, 'skQuad1', 1.2);
SKILL_ATTACKS.skQuad2 = reuse(ATTACKS.combo2!, 'skQuad2', 1.2);
SKILL_ATTACKS.skQuad3 = {
  id: 'skQuad3',
  segment: 'quad3',
  authored: QUAD3,
  segmentDuration: QUAD3.duration,
  activeStart: 0.13,
  activeEnd: 0.2,
  cancelAt: QUAD3_HOLD_T,
  trail: [0.09, 0.27],
  rate: 1.15,
  lunge: 0,
  hitbox: { kind: 'arc', range: 2.1, halfAngle: deg(65) },
  damage: 12,
  hitStop: 5,
  knockback: 0.5,
  fade: 0.05,
};
SKILL_ATTACKS.skQuad4 = {
  id: 'skQuad4',
  segment: 'quad4',
  authored: QUAD4,
  segmentDuration: QUAD4.duration,
  activeStart: 0.1,
  activeEnd: 0.17,
  cancelAt: QUAD4_HOLD_T,
  trail: [0.06, 0.24],
  rate: 1.15,
  lunge: 0,
  hitbox: { kind: 'arc', range: 2.2, halfAngle: deg(70) },
  damage: 16,
  hitStop: 8,
  knockback: 1.8,
  fade: 0.05,
};

// 高速突き 5 連（五月雨突き）: 細く前へ長い線の当たり。5 回の窓（突きが伸び切る前後）
const FLURRY_BOX: HitboxDef = { kind: 'line', length: 3.1, radius: 0.32 };
const FLURRY_WINDOWS = windows(Array.from({ length: FLURRY_COUNT }, (_, n) => flurryThrustT(n)), 0.015, 0.04, { hitbox: FLURRY_BOX });
SKILL_ATTACKS.skFlurry = {
  id: 'skFlurry',
  segment: 'flurry',
  authored: FLURRY,
  segmentDuration: FLURRY.duration,
  activeStart: FLURRY_WINDOWS[0]!.start,
  activeEnd: FLURRY_WINDOWS[FLURRY_COUNT - 1]!.end,
  cancelAt: 999,
  trail: [0.08, 0.7],
  rate: 1,
  lunge: 0,
  hitbox: FLURRY_BOX,
  windows: FLURRY_WINDOWS,
  // 最初の突きのあとから、回避・ガードで途中でやめられる
  dodgeCancelAt: FLURRY_WINDOWS[0]!.end + 0.02,
  damage: 7,
  hitStop: 3,
  knockback: 0.3,
  fade: 0.06,
};

// 回転斬り 2 周半（竜巻）: 前・後ろ・前・後ろ・前の 5 回の窓（前の半円に 3 回、後ろの半円に 2 回）。回っているあいだはスーパーアーマー
const WHIRL_HALF: HitboxDef = { kind: 'arc', range: 2.3, halfAngle: deg(80) };
const WHIRL_WINDOWS = windows(
  WHIRL_PASSES.map((p) => p.t),
  0.05,
  0.05,
  (i) => (WHIRL_PASSES[i]!.rear ? { hitbox: WHIRL_HALF, yawOffset: Math.PI } : { hitbox: WHIRL_HALF }),
);
SKILL_ATTACKS.skWhirl = {
  id: 'skWhirl',
  segment: 'whirl',
  authored: WHIRL,
  segmentDuration: WHIRL.duration,
  activeStart: WHIRL_WINDOWS[0]!.start,
  activeEnd: WHIRL_WINDOWS[WHIRL_WINDOWS.length - 1]!.end,
  cancelAt: 999,
  trail: [0.2, WHIRL_STOP_T],
  rate: 1,
  lunge: 0,
  hitbox: WHIRL_HALF,
  windows: WHIRL_WINDOWS,
  // 回り始めてからずっとスーパーアーマー（岩鬼・ボスの重い攻撃には割られる）
  armor: { from: 0.12, to: WHIRL_STOP_T, breakDamage: 28 },
  dodgeCancelAt: WHIRL_WINDOWS[0]!.end + 0.03,
  damage: 9,
  hitStop: 4,
  knockback: 0.9,
  fade: 0.08,
};

// ---------------------------------------------------------------- 大剣
// 崩山: 右からの払い → 左からの払い → 叩きつけ（衝撃波）。払いは途中で敵の攻撃に割られる（スーパーアーマーなし）。叩きつけは振りかぶりから地面を叩くまでスーパーアーマー
SKILL_ATTACKS.skGsSweep1 = {
  id: 'skGsSweep1',
  segment: 'gskSweep1',
  authored: GSK_SWEEP1,
  segmentDuration: GSK_SWEEP1.duration,
  activeStart: 0.24,
  activeEnd: 0.34,
  cancelAt: GSK_SWEEP1_HOLD_T,
  trail: [0.17, 0.42],
  rate: 1.1,
  lunge: 0,
  hitbox: { kind: 'arc', range: 3.0, halfAngle: deg(100) },
  damage: 22,
  hitStop: 8,
  knockback: 1.2,
  fade: 0.05,
};
SKILL_ATTACKS.skGsSweep2 = {
  id: 'skGsSweep2',
  segment: 'gskSweep2',
  authored: GSK_SWEEP2,
  segmentDuration: GSK_SWEEP2.duration,
  activeStart: 0.2,
  activeEnd: 0.3,
  cancelAt: GSK_SWEEP2_HOLD_T,
  trail: [0.13, 0.38],
  rate: 1.1,
  lunge: 0,
  hitbox: { kind: 'arc', range: 3.0, halfAngle: deg(100) },
  damage: 24,
  hitStop: 8,
  knockback: 1.2,
  fade: 0.05,
};
// 叩きつけ: 直接の斬り（前の扇）のあと、地面を叩いた点を中心に衝撃波（円）が広がる。2 つの窓は同じ当たりの記録を共有する（1 体に 1 回）
const SLAM_STRIKE: HitboxDef = { kind: 'arc', range: 3.4, halfAngle: deg(100) };
const SLAM_SHOCK: HitboxDef = { kind: 'circle', offset: 1.8, radius: 3.3 };
SKILL_ATTACKS.skGsSlam = {
  id: 'skGsSlam',
  segment: 'gskSlam',
  authored: GSK_SLAM,
  segmentDuration: GSK_SLAM.duration,
  activeStart: GSK_SLAM_IMPACT_T - 0.06,
  activeEnd: GSK_SLAM_IMPACT_T + 0.17,
  cancelAt: 999,
  trail: [0.2, 0.5],
  rate: 1,
  lunge: 0,
  impact: { t: GSK_SLAM_IMPACT_T, dist: 1.8, power: 1.4 },
  hitbox: SLAM_STRIKE,
  windows: [
    { start: GSK_SLAM_IMPACT_T - 0.06, end: GSK_SLAM_IMPACT_T + 0.03, hitbox: SLAM_STRIKE, group: 0 },
    { start: GSK_SLAM_IMPACT_T + 0.03, end: GSK_SLAM_IMPACT_T + 0.17, hitbox: SLAM_SHOCK, damageScale: 0.6, knockbackScale: 1.3, hitStopScale: 0.7, group: 0 },
  ],
  armor: { from: 0.1, to: GSK_SLAM_IMPACT_T + 0.12, breakDamage: 30 },
  dodgeCancelAt: GSK_SLAM_IMPACT_T + 0.17,
  damage: 44,
  hitStop: 13,
  knockback: 3.0,
  fade: 0.05,
};

// 一閃: 溜め（スーパーアーマー。重い攻撃には割られる）→ 一瞬のダッシュ → 水平の斬り 1 回（前へ長く・広い扇）。溜めの途中でも回避でやめられる
SKILL_ATTACKS.skGsIssen = {
  id: 'skGsIssen',
  segment: 'gskIssen',
  authored: GSK_ISSEN,
  segmentDuration: GSK_ISSEN.duration,
  activeStart: ISSEN_PASS_T - 0.05,
  activeEnd: ISSEN_PASS_T + 0.07,
  cancelAt: 999,
  trail: [ISSEN_DASH_FROM + 0.03, 0.8],
  rate: 1,
  lunge: 0,
  hitbox: { kind: 'arc', range: 3.4, halfAngle: deg(95) },
  armor: { from: 0.26, to: ISSEN_PASS_T + 0.15, breakDamage: 22 },
  dodgeCancelAt: 0.3,
  damage: 46,
  hitStop: 14,
  knockback: 3.6,
  fade: 0.06,
};

/** 攻撃 id から定義を探す（ふつうの攻撃 → 剣技専用の攻撃の順） */
export function findAttack(id: string): AttackDef | undefined {
  return ATTACKS[id] ?? SKILL_ATTACKS[id];
}
