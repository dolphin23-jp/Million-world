import { ATTACKS, type AttackDef } from './attacks';

/**
 * 剣技専用の攻撃（ADR-031）。ふつうの攻撃（ATTACKS = 操作で出る技）とは別の表にする: 剣技の攻撃は発生が速い・全体が長い・多段ヒットなど、
 * ATTACKS 全体にかけている「発生 ≥ 8f・全体 ≤ 60f」などの検査の外にある。クリップは AUTHORED_ATTACKS に同じように登録する（盾版・大剣版の検査の対象）。
 * 剣技の連なりの段（SkillStepDef.attack）は、ATTACKS か ここ のどちらかの id を指す（findAttack が探す）。
 */
export const SKILL_ATTACKS: Record<string, AttackDef> = {};

/** 攻撃 id から定義を探す（ふつうの攻撃 → 剣技専用の攻撃の順） */
export function findAttack(id: string): AttackDef | undefined {
  return ATTACKS[id] ?? SKILL_ATTACKS[id];
}
