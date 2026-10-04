import type { AttackDef, HitWindow } from './attacks';
import type { AuthoredAttack } from '../../character/authoring';
import {
  CROSS,
  CROSS1,
  CROSS2,
  CROSS3,
  CROSS_2,
  CROSS_3,
  CROSS_BEAT,
  GALE,
  GALE4,
  GALE6,
  GALE8,
  GALE_6,
  GALE_8,
  IAI,
  IAI1,
  IAI4,
  IAI7,
  IAI_4,
  IAI_7,
  IAI_DRAW_T,
  crossTimes,
  galeTimes,
  iaiTimes,
  type CrossSpec,
  type GaleSpec,
  type IaiSpec,
} from '../../character/data/skill-sword-ex';
import {
  HIRYU,
  HIRYU1,
  HIRYU4,
  HIRYU7,
  HIRYU_4,
  HIRYU_7,
  HIRYU_JUMP_T,
  KENZAN,
  KENZAN3,
  KENZAN4,
  KENZAN5,
  KENZAN_4,
  KENZAN_5,
  KENZAN_T,
  OUZU,
  OUZU2,
  OUZU3,
  OUZU4,
  OUZU_3,
  OUZU_4,
  hiryuTimes,
  kenzanTimes,
  ouzuPasses,
  ouzuTimes,
  type HiryuSpec,
  type KenzanSpec,
  type OuzuSpec,
} from '../../character/data/skill-greatsword-ex';
import type { HitboxDef } from '../hit';

const deg = (d: number) => (d * Math.PI) / 180;

/**
 * 剣技の第 2 弾（ADR-038）の攻撃。skill-attacks.ts の SKILL_ATTACKS にまとめて入れる（findAttack は 1 つの表だけを見る）。
 * 数値は仮置き（実機で調整）。どの技も、ふつうの攻撃（ATTACKS）の不変条件の外にある（出が速い・全体が長い・多段）。
 */
export const SKILL_ATTACKS_EX: Record<string, AttackDef> = {};

// ---------------------------------------------------------------- 居合
const IAI_DRAW_BOX: HitboxDef = { kind: 'arc', range: 3.6, halfAngle: deg(85) };
const IAI_UP_BOX: HitboxDef = { kind: 'arc', range: 2.6, halfAngle: deg(80) };
const IAI_KESA_BOX: HitboxDef = { kind: 'arc', range: 2.5, halfAngle: deg(75) };
const IAI_THRUST_BOX: HitboxDef = { kind: 'line', length: 3.6, radius: 0.45 };

function iaiAttack(id: string, spec: IaiSpec, clip: AuthoredAttack): AttackDef {
  const T = iaiTimes(spec);
  const ws: HitWindow[] = [
    // 抜き打ち（長く広い 1 撃。重い）
    { start: IAI_DRAW_T - 0.05, end: IAI_DRAW_T + 0.07, hitbox: IAI_DRAW_BOX, group: 0 },
    // 返しの斬り上げ
    { start: T.upPass - 0.05, end: T.upPass + 0.06, hitbox: IAI_UP_BOX, damageScale: 0.6, knockbackScale: 0.7, hitStopScale: 0.7, group: 1 },
  ];
  if (spec.kesa) ws.push({ start: T.kesaPass - 0.05, end: T.kesaPass + 0.06, hitbox: IAI_KESA_BOX, damageScale: 0.65, knockbackScale: 0.7, hitStopScale: 0.7, group: 2 });
  if (spec.thrust) ws.push({ start: T.thrustPass - 0.05, end: T.thrustPass + 0.06, hitbox: IAI_THRUST_BOX, damageScale: 0.85, knockbackScale: 1.5, hitStopScale: 1.1, group: 3 });
  return {
    id,
    segment: spec.id,
    authored: clip,
    segmentDuration: clip.duration,
    activeStart: ws[0]!.start,
    activeEnd: ws[ws.length - 1]!.end,
    cancelAt: 999,
    trail: [0.46, T.holdEnd],
    rate: 1,
    lunge: 0,
    hitbox: IAI_DRAW_BOX,
    windows: ws,
    // 溜めの途中から、抜き打ちの少しあとまでスーパーアーマー（重い攻撃には割られる）
    armor: { from: 0.18, to: IAI_DRAW_T + 0.14, breakDamage: 22 },
    dodgeCancelAt: 0.3,
    damage: 40,
    hitStop: 12,
    knockback: 3.2,
    fade: 0.06,
  };
}
SKILL_ATTACKS_EX.skIai = iaiAttack('skIai', IAI1, IAI);
SKILL_ATTACKS_EX.skIai4 = iaiAttack('skIai4', IAI4, IAI_4);
SKILL_ATTACKS_EX.skIai7 = iaiAttack('skIai7', IAI7, IAI_7);

// ---------------------------------------------------------------- 十字斬り
// 縦の斬り下ろし（狭く深い）→ 横の薙ぎ（広い）→ 交点に突き立て（衝撃の円。重い）。Lv4 で 2 回、Lv7 で 3 回の十字
const CROSS_CHOP_BOX: HitboxDef = { kind: 'arc', range: 2.7, halfAngle: deg(70) };
const CROSS_SWEEP_BOX: HitboxDef = { kind: 'arc', range: 3.0, halfAngle: deg(100) };
const CROSS_BURST_BOX: HitboxDef = { kind: 'circle', offset: 1.7, radius: 2.5 };

function crossAttack(id: string, spec: CrossSpec, clip: AuthoredAttack): AttackDef {
  const T = crossTimes(spec);
  const B = CROSS_BEAT;
  const ws: HitWindow[] = [];
  const impacts = T.base.map((b) => ({ t: b + B.plunge, dist: 1.7, power: 1.0 }));
  T.base.forEach((b, n) => {
    ws.push(
      { start: b + B.chop - 0.04, end: b + B.chop + 0.05, hitbox: CROSS_CHOP_BOX, group: n * 3 },
      { start: b + B.sweep - 0.05, end: b + B.sweep + 0.06, hitbox: CROSS_SWEEP_BOX, damageScale: 0.9, knockbackScale: 0.8, hitStopScale: 0.8, group: n * 3 + 1 },
      { start: b + B.plunge - 0.04, end: b + B.plunge + 0.1, hitbox: CROSS_BURST_BOX, damageScale: 1.5, knockbackScale: 1.6, hitStopScale: 1.5, group: n * 3 + 2 },
    );
  });
  return {
    id,
    segment: spec.id,
    authored: clip,
    segmentDuration: clip.duration,
    activeStart: ws[0]!.start,
    activeEnd: ws[ws.length - 1]!.end,
    cancelAt: 999,
    trail: [T.base[0]! + 0.02, T.holdEnd],
    rate: 1,
    lunge: 0,
    impact: impacts[0]!,
    ...(impacts.length > 1 ? { echoes: impacts.slice(1) } : {}),
    hitbox: CROSS_CHOP_BOX,
    windows: ws,
    dodgeCancelAt: T.base[0]! + B.chop + 0.08,
    damage: 15,
    hitStop: 7,
    knockback: 1.2,
    fade: 0.06,
  };
}
SKILL_ATTACKS_EX.skCross = crossAttack('skCross', CROSS1, CROSS);
SKILL_ATTACKS_EX.skCross2 = crossAttack('skCross2', CROSS2, CROSS_2);
SKILL_ATTACKS_EX.skCross3 = crossAttack('skCross3', CROSS3, CROSS_3);

// ---------------------------------------------------------------- 疾風連斬
// 駆けながら横薙ぎを左右交互に切り返す。軽い連続の斬りで、最後の 1 太刀だけ重く飛ばす。アーマーなし
const GALE_BOX: HitboxDef = { kind: 'arc', range: 2.7, halfAngle: deg(85) };

function galeAttack(id: string, spec: GaleSpec, clip: AuthoredAttack): AttackDef {
  const times = galeTimes(spec);
  const ws: HitWindow[] = times.map((t, i) => ({
    start: t - 0.05,
    end: t + 0.05,
    hitbox: GALE_BOX,
    group: i,
    ...(i === times.length - 1 ? { damageScale: 1.5, knockbackScale: 3, hitStopScale: 1.8 } : {}),
  }));
  return {
    id,
    segment: spec.id,
    authored: clip,
    segmentDuration: clip.duration,
    activeStart: ws[0]!.start,
    activeEnd: ws[ws.length - 1]!.end,
    cancelAt: 999,
    trail: [times[0]! - 0.05, times[times.length - 1]! + 0.12],
    rate: 1,
    lunge: 0,
    hitbox: GALE_BOX,
    windows: ws,
    dodgeCancelAt: ws[0]!.end + 0.02,
    damage: 11,
    hitStop: 4,
    knockback: 0.6,
    fade: 0.06,
  };
}
SKILL_ATTACKS_EX.skGale = galeAttack('skGale', GALE4, GALE);
SKILL_ATTACKS_EX.skGale6 = galeAttack('skGale6', GALE6, GALE_6);
SKILL_ATTACKS_EX.skGale8 = galeAttack('skGale8', GALE8, GALE_8);

// ================================================================= 大剣
// ---------------------------------------------------------------- 大渦
// 全方位の大回転: 剣が体の前・後ろを通るたびに、その側の半円を薙ぐ（前・後・前・後…）。回っているあいだずっとスーパーアーマー（竜巻より強い）
const OUZU_HALF: HitboxDef = { kind: 'arc', range: 3.4, halfAngle: deg(95) };

function ouzuAttack(id: string, spec: OuzuSpec, clip: AuthoredAttack): AttackDef {
  const passes = ouzuPasses(spec);
  const w = ouzuTimes(spec);
  const ws: HitWindow[] = passes.map((p, i) => ({
    start: p.t - 0.05,
    end: p.t + 0.06,
    hitbox: OUZU_HALF,
    ...(p.rear ? { yawOffset: Math.PI } : {}),
    group: i,
    // 最後の 1 回は、回し切る勢いで強く飛ばす
    ...(i === passes.length - 1 ? { damageScale: 1.4, knockbackScale: 2.2, hitStopScale: 1.6 } : {}),
  }));
  return {
    id,
    segment: spec.id,
    authored: clip,
    segmentDuration: clip.duration,
    activeStart: ws[0]!.start,
    activeEnd: ws[ws.length - 1]!.end,
    cancelAt: 999,
    trail: [0.3, w.stopT],
    rate: 1,
    lunge: 0,
    hitbox: OUZU_HALF,
    windows: ws,
    // 回り始めから止まるまで（重い攻撃には割られる。竜巻の 28 より強い）
    armor: { from: 0.2, to: w.stopT, breakDamage: 34 },
    dodgeCancelAt: ws[0]!.end + 0.04,
    damage: 16,
    hitStop: 6,
    knockback: 1.5,
    fade: 0.08,
  };
}
SKILL_ATTACKS_EX.skOuzu = ouzuAttack('skOuzu', OUZU2, OUZU);
SKILL_ATTACKS_EX.skOuzu3 = ouzuAttack('skOuzu3', OUZU3, OUZU_3);
SKILL_ATTACKS_EX.skOuzu4 = ouzuAttack('skOuzu4', OUZU4, OUZU_4);

// ---------------------------------------------------------------- 剣山
// 突き立て: 直接の斬り（前の扇）→ 突き立てた点を中心に、内から外へ衝撃の輪が広がる（輪ごとに別の組 = 同じ敵に何度も当たる）。突き立てているあいだアーマー
const KENZAN_STRIKE: HitboxDef = { kind: 'arc', range: 3.3, halfAngle: deg(75) };
const KENZAN_RING_OFFSET = 1.5;
const kenzanRing = (k: number): HitboxDef => ({ kind: 'circle', offset: KENZAN_RING_OFFSET, radius: 2.6 + 1.1 * k });

function kenzanAttack(id: string, spec: KenzanSpec, clip: AuthoredAttack): AttackDef {
  const T = kenzanTimes(spec);
  const stake = KENZAN_T.stake;
  const ws: HitWindow[] = [{ start: stake - 0.06, end: stake + 0.03, hitbox: KENZAN_STRIKE, group: 0 }];
  T.rings.forEach((t, k) => ws.push({ start: t, end: t + 0.12, hitbox: kenzanRing(k), damageScale: 0.7, knockbackScale: 1.0 + 0.2 * k, hitStopScale: 0.7, group: k + 1 }));
  const impacts = T.rings.map((t, k) => ({ t: k === 0 ? stake : t, dist: KENZAN_RING_OFFSET, power: 1.3 + 0.08 * k }));
  return {
    id,
    segment: spec.id,
    authored: clip,
    segmentDuration: clip.duration,
    activeStart: ws[0]!.start,
    activeEnd: ws[ws.length - 1]!.end,
    cancelAt: 999,
    trail: [0.2, stake + 0.1],
    rate: 1,
    lunge: 0,
    impact: impacts[0]!,
    ...(impacts.length > 1 ? { echoes: impacts.slice(1) } : {}),
    hitbox: KENZAN_STRIKE,
    windows: ws,
    // 振りかぶりから、最後の輪が消えるまで（突き立てているあいだ）スーパーアーマー
    armor: { from: 0.16, to: T.ringsEnd, breakDamage: 28 },
    dodgeCancelAt: stake + 0.2,
    damage: 38,
    hitStop: 12,
    knockback: 2.4,
    fade: 0.06,
  };
}
SKILL_ATTACKS_EX.skKenzan = kenzanAttack('skKenzan', KENZAN3, KENZAN);
SKILL_ATTACKS_EX.skKenzan4 = kenzanAttack('skKenzan4', KENZAN4, KENZAN_4);
SKILL_ATTACKS_EX.skKenzan5 = kenzanAttack('skKenzan5', KENZAN5, KENZAN_5);

// ---------------------------------------------------------------- 飛竜落とし
// 高く跳んで回りながら降り、着地で叩きつけ → 衝撃の輪。降りるまで当たりなし。降りてくる間はスーパーアーマー
const HIRYU_STRIKE: HitboxDef = { kind: 'arc', range: 3.6, halfAngle: deg(110) };
const HIRYU_RING_OFFSET = 2.0;
const hiryuRing = (k: number): HitboxDef => ({ kind: 'circle', offset: HIRYU_RING_OFFSET, radius: 3.8 + 1.4 * k });

function hiryuAttack(id: string, spec: HiryuSpec, clip: AuthoredAttack): AttackDef {
  const T = hiryuTimes(spec);
  const ws: HitWindow[] = [{ start: T.land - 0.06, end: T.land + 0.03, hitbox: HIRYU_STRIKE, group: 0 }];
  T.rings.forEach((t, k) =>
    ws.push({ start: t, end: t + 0.12, hitbox: hiryuRing(k), damageScale: k === 0 ? 0.6 : 0.5, knockbackScale: 1.3 + 0.2 * k, hitStopScale: 0.7, group: k + 1 }),
  );
  const impacts = T.rings.map((t, k) => ({ t: k === 0 ? T.land : t, dist: HIRYU_RING_OFFSET, power: 1.5 + 0.1 * k }));
  return {
    id,
    segment: spec.id,
    authored: clip,
    segmentDuration: clip.duration,
    activeStart: ws[0]!.start,
    activeEnd: ws[ws.length - 1]!.end,
    cancelAt: 999,
    trail: [HIRYU_JUMP_T + spec.air * 0.45, T.land + 0.08],
    rate: 1,
    lunge: 0,
    impact: impacts[0]!,
    ...(impacts.length > 1 ? { echoes: impacts.slice(1) } : {}),
    hitbox: HIRYU_STRIKE,
    windows: ws,
    // 跳び上がってから、着地の少しあとまで（重い攻撃には割られる）
    armor: { from: HIRYU_JUMP_T + 0.04, to: T.land + 0.15, breakDamage: 32 },
    dodgeCancelAt: T.land + 0.2,
    damage: 46,
    hitStop: 14,
    knockback: 3.0,
    fade: 0.06,
  };
}
SKILL_ATTACKS_EX.skHiryu = hiryuAttack('skHiryu', HIRYU1, HIRYU);
SKILL_ATTACKS_EX.skHiryu4 = hiryuAttack('skHiryu4', HIRYU4, HIRYU_4);
SKILL_ATTACKS_EX.skHiryu7 = hiryuAttack('skHiryu7', HIRYU7, HIRYU_7);
