import type { AuthoredAttack } from '../authoring';
import { COMBO1 } from './combo1';
import { COMBO2 } from './combo2';
import { COMBO3 } from './combo3';
import { DODGE_BACK, DODGE_CLIP } from './dodge';
import { HEAVY, HEAVY_CHARGE } from './heavy';
import { LUNGE } from './lunge';
import { DASH } from './dash';
import { RETREAT } from './retreat';
import { SWEEP } from './sweep';
import { SHIELD_GUARD, SHIELD_GUARD_HIT, SHIELD_PARRY, SWORD_GUARD, SWORD_GUARD_HIT } from './guard';
import { GS_CARRY, GS_DODGE, GS_DODGE_BACK, GS_STANCE } from './greatsword';
import { GS1, GS2 } from './gs-combo';
import { GS_DASH, GS_LUNGE, GS_RETREAT, GS_RISE, GS_SPIN } from './gs-moves';
import { GS_CHARGE, GS_HEAVY } from './gs-heavy';
import { GS_SMASH } from './gs-smash';
import { GS_DROP } from './gs-drop';
import { GS_HEAVY_RIP, GS_LUNGE_SWEEP, GS_RETREAT_LUNGE, GS_RISE_SLAM, GS_SPIN2 } from './gs-chain';
import { COMBO_HOP, COMBO_SPIN, COMBO_UPPER } from './combo-chain';
import { COMBO_SLAM, HOP_THRUST, LUNGE_SLASH, SWEEP_BACK } from './sword-chain';
import { FLURRY, FLURRY_7, FLURRY_9, QUAD3, QUAD4, QUAD5, QUAD6, WHIRL, WHIRL_35, WHIRL_45 } from './skill-sword';
import { HIRYU, HIRYU_4, HIRYU_7, KENZAN, KENZAN_4, KENZAN_5, OUZU, OUZU_3, OUZU_4 } from './skill-greatsword-ex';
import { CROSS, CROSS_2, CROSS_3, GALE, GALE_6, GALE_8, IAI, IAI_4, IAI_7 } from './skill-sword-ex';
import { GSK_ISSEN, GSK_ISSEN_BACK, GSK_ISSEN_LUNGE, GSK_RIP, GSK_SLAM, GSK_SLAM_LEAP, GSK_SWEEP1, GSK_SWEEP2 } from './skill-greatsword';
import { GS_GUARD, GS_GUARD_HIT, GS_PARRY } from './gs-guard';
import { FALL_CLIP, GS_FALL, GS_JUMP, GS_LAND, JUMP_CLIP, LAND_CLIP } from './jump';

/** 手付けアニメ（authoring.ts）で作る攻撃と回避。HeroVisual が読込時に焼いて、名前でクリップとして登録する */
export const AUTHORED_ATTACKS: Record<string, AuthoredAttack> = {
  combo1: COMBO1,
  combo2: COMBO2,
  combo3: COMBO3,
  comboHop: COMBO_HOP,
  comboSpin: COMBO_SPIN,
  comboUpper: COMBO_UPPER,
  comboSlam: COMBO_SLAM,
  hopThrust: HOP_THRUST,
  lungeSlash: LUNGE_SLASH,
  sweepBack: SWEEP_BACK,
  // 剣技の専用モーション（ADR-031。攻撃は SKILL_ATTACKS）
  quad3: QUAD3,
  quad4: QUAD4,
  flurry: FLURRY,
  whirl: WHIRL,
  whirl35: WHIRL_35,
  whirl45: WHIRL_45,
  flurry7: FLURRY_7,
  flurry9: FLURRY_9,
  quad5: QUAD5,
  quad6: QUAD6,
  iai: IAI,
  iai4: IAI_4,
  iai7: IAI_7,
  cross: CROSS,
  cross2: CROSS_2,
  cross3: CROSS_3,
  gale: GALE,
  gale6: GALE_6,
  gale8: GALE_8,
  ouzu: OUZU,
  ouzu3: OUZU_3,
  ouzu4: OUZU_4,
  kenzan: KENZAN,
  kenzan4: KENZAN_4,
  kenzan5: KENZAN_5,
  hiryu: HIRYU,
  hiryu4: HIRYU_4,
  hiryu7: HIRYU_7,
  gskSweep1: GSK_SWEEP1,
  gskSweep2: GSK_SWEEP2,
  gskSlam: GSK_SLAM,
  gskIssen: GSK_ISSEN,
  gskSlamLeap: GSK_SLAM_LEAP,
  gskRip: GSK_RIP,
  gskIssenBack: GSK_ISSEN_BACK,
  gskIssenLunge: GSK_ISSEN_LUNGE,
  heavyCharge: HEAVY_CHARGE,
  lunge: LUNGE,
  dash: DASH,
  retreat: RETREAT,
  sweep: SWEEP,
  heavy: HEAVY,
  dodge: DODGE_CLIP,
  dodgeBack: DODGE_BACK,
  // ジャンプ（M7-2。跳び上がり → 落下 → 着地。大剣は '@greatsword' の版）
  jump: JUMP_CLIP,
  fall: FALL_CLIP,
  land: LAND_CLIP,
  'jump@greatsword': GS_JUMP,
  'fall@greatsword': GS_FALL,
  'land@greatsword': GS_LAND,
  guardShield: SHIELD_GUARD,
  guardShieldHit: SHIELD_GUARD_HIT,
  guardShieldParry: SHIELD_PARRY,
  guardSword: SWORD_GUARD,
  guardSwordHit: SWORD_GUARD_HIT,
  // 大剣（両手持ち。src/character/data/greatsword.ts ほか）
  gsStance: GS_STANCE,
  gsCarry: GS_CARRY,
  'dodge@greatsword': GS_DODGE,
  'dodgeBack@greatsword': GS_DODGE_BACK,
  gs1: GS1,
  gs2: GS2,
  gsLunge: GS_LUNGE,
  gsRetreat: GS_RETREAT,
  gsSpin: GS_SPIN,
  gsDash: GS_DASH,
  gsRise: GS_RISE,
  gsCharge: GS_CHARGE,
  gsHeavy: GS_HEAVY,
  gsSmash: GS_SMASH,
  gsDrop: GS_DROP,
  gsSpin2: GS_SPIN2,
  gsLungeSweep: GS_LUNGE_SWEEP,
  gsRetreatLunge: GS_RETREAT_LUNGE,
  gsRiseSlam: GS_RISE_SLAM,
  gsHeavyRip: GS_HEAVY_RIP,
  guardGreatsword: GS_GUARD,
  guardGreatswordHit: GS_GUARD_HIT,
  guardGreatswordParry: GS_PARRY,
};

/** 盾版のクリップ名の接尾辞。盾を持つときは、左腕を盾の持ち位置に固定して焼き直したクリップ（名前 + この接尾辞）を再生する（ADR-020） */
export const SHIELD_VARIANT = '@shield';

/** 大剣版のクリップ名の接尾辞。大剣を持つときは、ロール（'dodge@greatsword'）・待機・走りがこの接尾辞つきの版で探される（なければそのまま） */
export const GREATSWORD_VARIANT = '@greatsword';

/** 左腕を自分で決めるクリップ（ガードの構え・受け）。盾版は作らない */
const GUARD_CLIP_NAMES: ReadonlySet<string> = new Set(['guardShield', 'guardShieldHit', 'guardShieldParry', 'guardSword', 'guardSwordHit']);

/** 盾版（左腕固定）を焼くクリップか。ガードのクリップと、両手持ちの大剣のクリップ（盾は持てない）には作らない */
export function hasShieldVariant(name: string): boolean {
  return !GUARD_CLIP_NAMES.has(name) && AUTHORED_ATTACKS[name]?.twoHanded === undefined;
}
