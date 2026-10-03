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

/** 手付けアニメ（authoring.ts）で作る攻撃と回避。HeroVisual が読込時に焼いて、名前でクリップとして登録する */
export const AUTHORED_ATTACKS: Record<string, AuthoredAttack> = {
  combo1: COMBO1,
  combo2: COMBO2,
  combo3: COMBO3,
  heavyCharge: HEAVY_CHARGE,
  lunge: LUNGE,
  dash: DASH,
  retreat: RETREAT,
  sweep: SWEEP,
  heavy: HEAVY,
  dodge: DODGE_CLIP,
  dodgeBack: DODGE_BACK,
  guardShield: SHIELD_GUARD,
  guardShieldHit: SHIELD_GUARD_HIT,
  guardShieldParry: SHIELD_PARRY,
  guardSword: SWORD_GUARD,
  guardSwordHit: SWORD_GUARD_HIT,
};

/** 盾版のクリップ名の接尾辞。盾を持つときは、左腕を盾の持ち位置に固定して焼き直したクリップ（名前 + この接尾辞）を再生する（ADR-020） */
export const SHIELD_VARIANT = '@shield';

/** 左腕を自分で決めるクリップ（ガードの構え・受け）。盾版は作らない */
const GUARD_CLIP_NAMES: ReadonlySet<string> = new Set(['guardShield', 'guardShieldHit', 'guardShieldParry', 'guardSword', 'guardSwordHit']);

/** 盾版（左腕固定）を焼くクリップか */
export function hasShieldVariant(name: string): boolean {
  return !GUARD_CLIP_NAMES.has(name);
}
