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
};
