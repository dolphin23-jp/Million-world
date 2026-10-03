import type { Enemy } from './enemy';

/**
 * 複数の敵を 1 ステップ進める（攻撃権）。同時に予備動作〜攻撃に入れる敵の数を maxAttackers までに制限する。
 * 全員が一斉に殴りかかると避けようがないので、残りは攻撃の距離で構えて待ち、攻撃権が空いた敵から順に（配列の順に）入る。
 * 敵を 1 体進めるたびに数え直すので、同じステップに上限を超えて入ることはない。
 */
export function stepSwarm(enemies: readonly Enemy[], dt: number, targetX: number, targetZ: number, targetAlive: boolean, maxAttackers: number): void {
  let attackers = 0;
  for (const e of enemies) if (e.attacking) attackers++;
  for (const e of enemies) {
    const was = e.attacking;
    e.step(dt, targetX, targetZ, targetAlive, attackers < maxAttackers);
    if (!was && e.attacking) attackers++;
    else if (was && !e.attacking) attackers--;
  }
}
