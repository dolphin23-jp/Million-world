import { ATTACKS, type AttackDef, type HitWindow } from './attacks';
import { SPELL_ATTACKS } from './spell-attacks';
import {
  FLURRY,
  FLURRY5,
  FLURRY7,
  FLURRY9,
  FLURRY_7,
  FLURRY_9,
  QUAD3,
  QUAD3_HOLD_T,
  QUAD4,
  QUAD4_HOLD_T,
  QUAD5,
  QUAD5_HOLD_T,
  QUAD6,
  QUAD6_PASSES,
  WHIRL,
  WHIRL25,
  WHIRL35,
  WHIRL45,
  WHIRL_35,
  WHIRL_45,
  flurryTimes,
  whirlPasses,
  whirlTimes,
  type FlurrySpec,
  type WhirlSpec,
} from '../../character/data/skill-sword';
import type { AuthoredAttack } from '../../character/authoring';
import {
  GSK_ISSEN,
  GSK_ISSEN_BACK,
  GSK_ISSEN_BACK_HOLD_T,
  GSK_ISSEN_LUNGE,
  GSK_RIP,
  GSK_SLAM,
  GSK_SLAM_IMPACT_T,
  GSK_SLAM_LEAP,
  GSK_SLAM_LEAP_HOLD_T,
  GSK_SLAM_LEAP_IMPACT_T,
  GSK_SWEEP1,
  GSK_SWEEP1_HOLD_T,
  GSK_SWEEP2,
  GSK_SWEEP2_HOLD_T,
  ISSEN_DASH_FROM,
  ISSEN_HOLD_T,
  ISSEN_PASS_T,
} from '../../character/data/skill-greatsword';
import type { HitboxDef } from '../hit';
import { SKILL_ATTACKS_EX } from './skill-attacks-ex';

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

// 突き込み（四ツ葉の 5 つ目。Lv4 から）: 右足を踏み込んで真っ直ぐ突く。細く前へ長い線の当たり
SKILL_ATTACKS.skQuad5 = {
  id: 'skQuad5',
  segment: 'quad5',
  authored: QUAD5,
  segmentDuration: QUAD5.duration,
  activeStart: 0.15,
  activeEnd: 0.23,
  cancelAt: QUAD5_HOLD_T,
  trail: [0.12, 0.3],
  rate: 1.1,
  lunge: 0,
  hitbox: { kind: 'line', length: 3.4, radius: 0.42 },
  damage: 20,
  hitStop: 8,
  knockback: 2.2,
  fade: 0.05,
};
// 回し斬り（四ツ葉の 6 つ目。Lv7 から）: 1 回転して、前の半円に 1 回・後ろの半円に 1 回
const QUAD6_HALF: HitboxDef = { kind: 'arc', range: 2.3, halfAngle: deg(90) };
const QUAD6_WINDOWS = windows(
  QUAD6_PASSES.map((p) => p.t),
  0.05,
  0.05,
  (i) => (QUAD6_PASSES[i]!.rear ? { hitbox: QUAD6_HALF, yawOffset: Math.PI } : { hitbox: QUAD6_HALF }),
);
SKILL_ATTACKS.skQuad6 = {
  id: 'skQuad6',
  segment: 'quad6',
  authored: QUAD6,
  segmentDuration: QUAD6.duration,
  activeStart: QUAD6_WINDOWS[0]!.start,
  activeEnd: QUAD6_WINDOWS[QUAD6_WINDOWS.length - 1]!.end,
  cancelAt: 999,
  trail: [0.14, 0.4],
  rate: 1.1,
  lunge: 0,
  hitbox: QUAD6_HALF,
  windows: QUAD6_WINDOWS,
  dodgeCancelAt: QUAD6_WINDOWS[0]!.end + 0.03,
  damage: 14,
  hitStop: 6,
  knockback: 1.0,
  fade: 0.05,
};

// 高速突き（五月雨突き）: 細く前へ長い線の当たり。突きが伸び切る前後に窓。レベルで 5 → 7 → 9 連（9 連はとどめの突きが深く長い）
const FLURRY_BOX: HitboxDef = { kind: 'line', length: 3.1, radius: 0.32 };
const FLURRY_FINAL_BOX: HitboxDef = { kind: 'line', length: 3.8, radius: 0.4 };
function flurryAttack(id: string, spec: FlurrySpec, clip: AuthoredAttack, damage: number): AttackDef {
  const times = flurryTimes(spec);
  const ws = windows(times, 0.015, 0.04, (i) =>
    spec.finisher && i === times.length - 1 ? { hitbox: FLURRY_FINAL_BOX, damageScale: 2.2, knockbackScale: 4, hitStopScale: 2.4 } : { hitbox: FLURRY_BOX },
  );
  return {
    id,
    segment: spec.id,
    authored: clip,
    segmentDuration: clip.duration,
    activeStart: ws[0]!.start,
    activeEnd: ws[ws.length - 1]!.end,
    cancelAt: 999,
    trail: [0.08, times[times.length - 1]! + 0.1],
    rate: 1,
    lunge: 0,
    hitbox: FLURRY_BOX,
    windows: ws,
    // 最初の突きのあとから、回避・ガードで途中でやめられる
    dodgeCancelAt: ws[0]!.end + 0.02,
    damage,
    hitStop: 3,
    knockback: 0.3,
    fade: 0.06,
  };
}
SKILL_ATTACKS.skFlurry = flurryAttack('skFlurry', FLURRY5, FLURRY, 7);
SKILL_ATTACKS.skFlurry7 = flurryAttack('skFlurry7', FLURRY7, FLURRY_7, 7);
SKILL_ATTACKS.skFlurry9 = flurryAttack('skFlurry9', FLURRY9, FLURRY_9, 7);

// 回転斬り（竜巻）: 前・後ろ・前・後ろ…の窓（2 周半で前の半円に 3 回・後ろに 2 回）。回っているあいだはスーパーアーマー。レベルで 2.5 → 3.5 → 4.5 周
const WHIRL_HALF: HitboxDef = { kind: 'arc', range: 2.3, halfAngle: deg(80) };
function whirlAttack(id: string, spec: WhirlSpec, clip: AuthoredAttack, damage: number): AttackDef {
  const passes = whirlPasses(spec);
  const ws = windows(
    passes.map((p) => p.t),
    0.05,
    0.05,
    (i) => (passes[i]!.rear ? { hitbox: WHIRL_HALF, yawOffset: Math.PI } : { hitbox: WHIRL_HALF }),
  );
  const stopT = whirlTimes(spec).stopT;
  return {
    id,
    segment: spec.id,
    authored: clip,
    segmentDuration: clip.duration,
    activeStart: ws[0]!.start,
    activeEnd: ws[ws.length - 1]!.end,
    cancelAt: 999,
    trail: [0.2, stopT],
    rate: 1,
    lunge: 0,
    hitbox: WHIRL_HALF,
    windows: ws,
    // 回り始めてからずっとスーパーアーマー（岩鬼・ボスの重い攻撃には割られる）
    armor: { from: 0.12, to: stopT, breakDamage: 28 },
    dodgeCancelAt: ws[0]!.end + 0.03,
    damage,
    hitStop: 4,
    knockback: 0.9,
    fade: 0.08,
  };
}
SKILL_ATTACKS.skWhirl = whirlAttack('skWhirl', WHIRL25, WHIRL, 9);
SKILL_ATTACKS.skWhirl35 = whirlAttack('skWhirl35', WHIRL35, WHIRL_35, 8);
SKILL_ATTACKS.skWhirl45 = whirlAttack('skWhirl45', WHIRL45, WHIRL_45, 7);

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
  // 振り抜いた姿勢を保つあいだ、次段（返し斬り。Lv4 から）が続く
  cancelAt: ISSEN_HOLD_T,
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

// ---- 進化（ADR-034）----
// 飛翔崩山（崩山 Lv4 から。叩きつけがこれに替わる）: 跳び込んで叩きつけ、衝撃波が 2 重（内側の輪 → 遅れて外側の大きな輪。外側は別の組 = もう一度当たる）。地面の演出も 2 回
const LEAP_IMPACT_T = GSK_SLAM_LEAP_IMPACT_T;
const LEAP_STRIKE: HitboxDef = { kind: 'arc', range: 3.6, halfAngle: deg(110) };
const LEAP_SHOCK1: HitboxDef = { kind: 'circle', offset: 2.0, radius: 3.4 };
const LEAP_SHOCK2: HitboxDef = { kind: 'circle', offset: 2.0, radius: 5.4 };
SKILL_ATTACKS.skGsSlamLeap = {
  id: 'skGsSlamLeap',
  segment: 'gskSlamLeap',
  authored: GSK_SLAM_LEAP,
  segmentDuration: GSK_SLAM_LEAP.duration,
  activeStart: LEAP_IMPACT_T - 0.07,
  activeEnd: LEAP_IMPACT_T + 0.3,
  // 保つ姿勢のあいだ、次段（地裂。Lv7 から）が続く
  cancelAt: GSK_SLAM_LEAP_HOLD_T,
  trail: [0.2, LEAP_IMPACT_T + 0.08],
  rate: 1,
  lunge: 0,
  impact: { t: LEAP_IMPACT_T, dist: 2.0, power: 1.5 },
  echoes: [{ t: LEAP_IMPACT_T + 0.18, dist: 2.0, power: 1.7 }],
  hitbox: LEAP_STRIKE,
  windows: [
    { start: LEAP_IMPACT_T - 0.07, end: LEAP_IMPACT_T + 0.03, hitbox: LEAP_STRIKE, group: 0 },
    { start: LEAP_IMPACT_T + 0.03, end: LEAP_IMPACT_T + 0.15, hitbox: LEAP_SHOCK1, damageScale: 0.6, knockbackScale: 1.3, hitStopScale: 0.7, group: 0 },
    { start: LEAP_IMPACT_T + 0.15, end: LEAP_IMPACT_T + 0.3, hitbox: LEAP_SHOCK2, damageScale: 0.45, knockbackScale: 1.6, hitStopScale: 0.6, group: 1 },
  ],
  // 跳び上がってから、地面を叩く少しあとまでスーパーアーマー（飛翔崩山のほうが強い）
  armor: { from: 0.12, to: LEAP_IMPACT_T + 0.15, breakDamage: 34 },
  dodgeCancelAt: LEAP_IMPACT_T + 0.3,
  damage: 50,
  hitStop: 14,
  knockback: 3.2,
  fade: 0.05,
};
// 地裂（崩山 Lv7 から）: 叩きつけた剣で地面をえぐって斬り上げ、前方へ長い衝撃を走らせる（長い線の当たり）
SKILL_ATTACKS.skGsRip = {
  id: 'skGsRip',
  segment: 'gskRip',
  authored: GSK_RIP,
  segmentDuration: GSK_RIP.duration,
  activeStart: 0.16,
  activeEnd: 0.3,
  cancelAt: 999,
  trail: [0.1, 0.38],
  rate: 1.05,
  lunge: 0,
  impact: { t: 0.2, dist: 2.6, power: 0.8 },
  hitbox: { kind: 'line', length: 4.8, radius: 0.75 },
  dodgeCancelAt: 0.3,
  damage: 36,
  hitStop: 10,
  knockback: 3.0,
  fade: 0.05,
};
// 返し斬り（一閃 Lv4 から）: 斬り抜けた剣を引き込み、振り返りざまに右へ薙ぎ戻す
SKILL_ATTACKS.skGsIssen2 = {
  id: 'skGsIssen2',
  segment: 'gskIssenBack',
  authored: GSK_ISSEN_BACK,
  segmentDuration: GSK_ISSEN_BACK.duration,
  activeStart: 0.2,
  activeEnd: 0.3,
  cancelAt: GSK_ISSEN_BACK_HOLD_T,
  trail: [0.13, 0.38],
  rate: 1.1,
  lunge: 0,
  hitbox: { kind: 'arc', range: 3.2, halfAngle: deg(100) },
  armor: { from: 0.04, to: 0.32, breakDamage: 22 },
  dodgeCancelAt: 0.3,
  damage: 30,
  hitStop: 10,
  knockback: 2.4,
  fade: 0.05,
};
// 突き抜け（一閃 Lv7 から）: 牛の構えから体ごと飛び込んで貫く。長く重い締めの 1 撃（長い線の当たり）
SKILL_ATTACKS.skGsIssenLunge = {
  id: 'skGsIssenLunge',
  segment: 'gskIssenLunge',
  authored: GSK_ISSEN_LUNGE,
  segmentDuration: GSK_ISSEN_LUNGE.duration,
  activeStart: 0.23,
  activeEnd: 0.31,
  cancelAt: 999,
  trail: [0.18, 0.42],
  rate: 1,
  lunge: 0,
  hitbox: { kind: 'line', length: 4.0, radius: 0.5 },
  dodgeCancelAt: 0.31,
  damage: 40,
  hitStop: 12,
  knockback: 3.4,
  fade: 0.05,
};

// 剣技の第 2 弾（ADR-038）
Object.assign(SKILL_ATTACKS, SKILL_ATTACKS_EX);

/** 攻撃 id から定義を探す（ふつうの攻撃 → 剣技専用の攻撃 → 杖の詠唱の順） */
export function findAttack(id: string): AttackDef | undefined {
  return ATTACKS[id] ?? SKILL_ATTACKS[id] ?? SPELL_ATTACKS[id];
}
