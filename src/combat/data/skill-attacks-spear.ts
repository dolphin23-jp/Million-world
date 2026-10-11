import type { AttackDef, HitWindow } from './attacks';
import type { AuthoredAttack } from '../../character/authoring';
import {
  SPF12,
  SPF6,
  SPF9,
  SPK_BORE,
  SPK_BORE2,
  SPK_BORE2_HOLD_T,
  SPK_BORE3,
  SPK_BORE_HOLD_T,
  SPK_FLURRY,
  SPK_FLURRY_12,
  SPK_FLURRY_9,
  SPK_WHIRL,
  SPK_WHIRL_3,
  SPK_WHIRL_4,
  SPW2,
  SPW3,
  SPW4,
  spFlurryTimes,
  spWhirlQuarters,
  spWhirlStopT,
  type SpFlurrySpec,
  type SpWhirlSpec,
} from '../../character/data/skill-spear';
import type { HitboxDef } from '../hit';

const deg = (d: number) => (d * Math.PI) / 180;

/**
 * 槍技（ADR-049）の攻撃。skill-attacks.ts の SKILL_ATTACKS にまとめて入れる（findAttack は 1 つの表だけを見る）。
 * 数値は仮置き（実機で調整）。どの技も、ふつうの攻撃（ATTACKS）の不変条件の外にある（出が速い・全体が長い・多段）。
 * 穂先の利（AttackDef.tip）は持たない（槍技は多段・踏み込みで当て方が決まっている）。
 */
export const SKILL_ATTACKS_SPEAR: Record<string, AttackDef> = {};

// ---------------------------------------------------------------- 乱れ突き
// 細く前へ長い線の当たり。突きが伸び切る前後に窓。レベルで 6 → 9 → 12 連（12 連はとどめの突きが深く長い）
const FLURRY_BOX: HitboxDef = { kind: 'line', length: 2.5, radius: 0.3 };
const FLURRY_FINAL_BOX: HitboxDef = { kind: 'line', length: 3.2, radius: 0.4 };

function flurryAttack(id: string, spec: SpFlurrySpec, clip: AuthoredAttack, damage: number): AttackDef {
  const times = spFlurryTimes(spec);
  const ws: HitWindow[] = times.map((t, i) => ({
    start: t - 0.015,
    end: t + 0.04,
    ...(spec.finisher && i === times.length - 1 ? { hitbox: FLURRY_FINAL_BOX, damageScale: 2.2, knockbackScale: 4, hitStopScale: 2.4 } : { hitbox: FLURRY_BOX }),
  }));
  return {
    id,
    segment: spec.id,
    authored: clip,
    segmentDuration: clip.duration,
    activeStart: ws[0]!.start,
    activeEnd: ws[ws.length - 1]!.end,
    cancelAt: 999,
    trail: [0.1, times[times.length - 1]! + 0.1],
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
SKILL_ATTACKS_SPEAR.skSpFlurry = flurryAttack('skSpFlurry', SPF6, SPK_FLURRY, 6);
SKILL_ATTACKS_SPEAR.skSpFlurry9 = flurryAttack('skSpFlurry9', SPF9, SPK_FLURRY_9, 6);
SKILL_ATTACKS_SPEAR.skSpFlurry12 = flurryAttack('skSpFlurry12', SPF12, SPK_FLURRY_12, 6);

// ---------------------------------------------------------------- 風車
// 水平の円を何周も描く。穂先が前・左・後ろ・右の四半分を通るたびに、その四半分の扇に窓（周ごとに 4 つ。同じ周の窓は同じ組で、同じ敵に重ねて当てない）。回っているあいだはスーパーアーマー
function whirlAttack(id: string, spec: SpWhirlSpec, clip: AuthoredAttack, damage: number): AttackDef {
  const quarters = spWhirlQuarters(spec);
  const stopT = spWhirlStopT(spec);
  const last = quarters.length - 1;
  const ws: HitWindow[] = quarters.map((q, i) => {
    // 巻き込みの方位から右へ q.center 度回った方向（右へひねる = ワールドの向きは左回りの逆。yaw は減る向き）。巻き込みは左へ 60° ひねっているので、基準は +60°
    const box: HitboxDef = { kind: 'arc', range: 2.4, halfAngle: deg(50) };
    const finisher = i === last;
    return {
      start: q.start,
      end: q.end,
      hitbox: box,
      yawOffset: deg(60 - q.center),
      group: q.turn,
      ...(finisher ? { damageScale: 1.8, knockbackScale: 3, hitStopScale: 2 } : {}),
    };
  });
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
    hitbox: ws[0]!.hitbox!,
    windows: ws,
    armor: { from: 0.12, to: stopT, breakDamage: 28 },
    dodgeCancelAt: ws[0]!.end + 0.03,
    damage,
    hitStop: 3,
    knockback: 0.7,
    fade: 0.08,
  };
}
SKILL_ATTACKS_SPEAR.skSpWhirl = whirlAttack('skSpWhirl', SPW2, SPK_WHIRL, 8);
SKILL_ATTACKS_SPEAR.skSpWhirl3 = whirlAttack('skSpWhirl3', SPW3, SPK_WHIRL_3, 8);
SKILL_ATTACKS_SPEAR.skSpWhirl4 = whirlAttack('skSpWhirl4', SPW4, SPK_WHIRL_4, 8);

// ---------------------------------------------------------------- 穿ち
// 深く引き絞って（スーパーアーマー）一気に踏み込んで貫く（1 つ目）→ 続けて突く（2 つ目。Lv4）→ とどめの深い突き（3 つ目。Lv7）。踏み込みの全域が当たる（線が踏み込みに連れて動く）
SKILL_ATTACKS_SPEAR.skSpBore = {
  id: 'skSpBore',
  segment: 'spkBore',
  authored: SPK_BORE,
  segmentDuration: SPK_BORE.duration,
  activeStart: 0.3,
  activeEnd: 0.46,
  cancelAt: SPK_BORE_HOLD_T,
  trail: [0.24, 0.52],
  rate: 1,
  lunge: 0,
  hitbox: { kind: 'line', length: 2.6, radius: 0.4 },
  // 引き絞りから踏み込みの終わりまで、スーパーアーマー（重い攻撃には割られる）
  armor: { from: 0.05, to: 0.5, breakDamage: 26 },
  dodgeCancelAt: 0.28,
  damage: 22,
  hitStop: 9,
  knockback: 2.8,
  fade: 0.06,
};
SKILL_ATTACKS_SPEAR.skSpBore2 = {
  id: 'skSpBore2',
  segment: 'spkBore2',
  authored: SPK_BORE2,
  segmentDuration: SPK_BORE2.duration,
  activeStart: 0.14,
  activeEnd: 0.28,
  cancelAt: SPK_BORE2_HOLD_T,
  trail: [0.08, 0.3],
  rate: 1,
  lunge: 0,
  hitbox: { kind: 'line', length: 2.6, radius: 0.4 },
  dodgeCancelAt: 0.3,
  damage: 20,
  hitStop: 8,
  knockback: 2.4,
  fade: 0.05,
};
SKILL_ATTACKS_SPEAR.skSpBore3 = {
  id: 'skSpBore3',
  segment: 'spkBore3',
  authored: SPK_BORE3,
  segmentDuration: SPK_BORE3.duration,
  activeStart: 0.2,
  activeEnd: 0.36,
  cancelAt: 999,
  trail: [0.12, 0.42],
  rate: 1,
  lunge: 0,
  hitbox: { kind: 'line', length: 3.2, radius: 0.5 },
  // 沈み込みから突き切るまでスーパーアーマー
  armor: { from: 0.04, to: 0.4, breakDamage: 28 },
  dodgeCancelAt: 0.38,
  damage: 36,
  hitStop: 12,
  knockback: 3.6,
  fade: 0.05,
};
