import { ATTACKS, type AttackDef, type HitWindow } from './attacks';
import { FLURRY, FLURRY_COUNT, QUAD3, QUAD3_HOLD_T, QUAD4, QUAD4_HOLD_T, WHIRL, WHIRL_PASSES, WHIRL_STOP_T, flurryThrustT } from '../../character/data/skill-sword';
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

/** 攻撃 id から定義を探す（ふつうの攻撃 → 剣技専用の攻撃の順） */
export function findAttack(id: string): AttackDef | undefined {
  return ATTACKS[id] ?? SKILL_ATTACKS[id];
}
