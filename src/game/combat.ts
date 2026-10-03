import type { AttackDef } from '../combat/data/attacks';
import type { DamageResult } from '../combat/health';
import { collectHits, makeHitEvent, type HitEvent, type HitOrigin, type HitTracker, type Hurtbox } from '../combat/hit';
import type { Circle } from '../world/collision';

/**
 * プレイヤーの攻撃を敵へ当てる（ADR-014）。持続フレームのあいだ毎 sim ステップ呼ぶ。
 * 当たった対象に takeHit を呼び、onHit で演出（ヒットストップ・フラッシュ・シェイク・ダメージ数字）を起こす側へ知らせる。
 */

export const PLAYER_ID = 0;

/** 攻撃側として読む Player の部分（テストで本物の Player を使えるよう、必要な口だけを型にする） */
export interface AttackerView {
  readonly attackActive: boolean;
  readonly attack: AttackDef | null;
  readonly body: Circle;
  readonly yaw: number;
  readonly hitTracker: HitTracker;
}

export interface CombatTarget {
  readonly body: Hurtbox;
  takeHit(ev: HitEvent): DamageResult;
}

const _origin: HitOrigin = { x: 0, z: 0, yaw: 0 };
const _boxes: Hurtbox[] = [];
const _hit: Hurtbox[] = [];

/** 新しく当たった数を返す */
export function resolvePlayerAttack<T extends CombatTarget>(
  attacker: AttackerView,
  targets: readonly T[],
  onHit: (ev: HitEvent, target: T, result: DamageResult) => void,
): number {
  const atk = attacker.attack;
  if (!atk || !attacker.attackActive) return 0;
  _origin.x = attacker.body.x;
  _origin.z = attacker.body.z;
  _origin.yaw = attacker.yaw;
  _boxes.length = 0;
  _hit.length = 0;
  for (const t of targets) _boxes.push(t.body);
  const n = collectHits(_origin, atk.hitbox, _boxes, attacker.hitTracker, _hit);
  for (const box of _hit) {
    const target = targets.find((t) => t.body === box);
    if (!target) continue;
    const ev = makeHitEvent(PLAYER_ID, _origin, box, atk);
    const result = target.takeHit(ev);
    onHit(ev, target, result);
  }
  return n;
}
