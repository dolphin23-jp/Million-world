import type { AuthoredAttack } from '../authoring';
import { COMBO1 } from './combo1';

/** 手付けアニメ（authoring.ts）で作る攻撃。HeroVisual が読込時に焼いて、名前でクリップとして登録する */
export const AUTHORED_ATTACKS: Record<string, AuthoredAttack> = {
  combo1: COMBO1,
};
