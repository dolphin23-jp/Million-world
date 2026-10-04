import type { Enemy } from './enemy';

/**
 * 複数の敵を 1 ステップ進める（攻撃権）。同時に予備動作〜攻撃に入れる敵を、重み（Enemy.attackWeight。既定 1）の合計が maxAttackers（予算）以下になるまでに制限する。
 * 全員が一斉に殴りかかると避けようがないので、残りは攻撃の距離で構えて待ち、攻撃権が空いた敵から順に（配列の順に）入る。
 * 群れの小さな敵（重み 0.5 など）は、予算の中で数体が同時に襲える（ADR-028）。
 * 敵を 1 体進めるたびに数え直すので、同じステップに予算を超えて入ることはない。
 */
export function stepSwarm(enemies: readonly Enemy[], dt: number, targetX: number, targetZ: number, targetAlive: boolean, maxAttackers: number): void {
  let used = 0;
  for (const e of enemies) if (e.attacking) used += e.attackWeight;
  for (const e of enemies) {
    const was = e.attacking;
    // 浮動小数点の誤差（0.5 を 4 つ足して 2 など）で予算ぴったりが弾かれないよう、わずかに余裕を持たせる
    e.step(dt, targetX, targetZ, targetAlive, used + e.attackWeight <= maxAttackers + 1e-9);
    if (!was && e.attacking) used += e.attackWeight;
    else if (was && !e.attacking) used -= e.attackWeight;
  }
}
