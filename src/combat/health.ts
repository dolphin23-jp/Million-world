/** HP。プレイヤーと敵で共通 */

export interface Health {
  hp: number;
  max: number;
}

export function createHealth(max: number): Health {
  return { hp: max, max };
}

export interface DamageResult {
  /** 実際に減った量（残り HP を超えて減らさない） */
  dealt: number;
  /** この攻撃で HP が 0 になった（すでに 0 だった場合は false） */
  killed: boolean;
}

export function applyDamage(h: Health, amount: number): DamageResult {
  if (h.hp <= 0 || amount <= 0) return { dealt: 0, killed: false };
  const dealt = Math.min(h.hp, amount);
  h.hp -= dealt;
  return { dealt, killed: h.hp <= 0 };
}

export function isDead(h: Health): boolean {
  return h.hp <= 0;
}
