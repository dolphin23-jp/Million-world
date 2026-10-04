/**
 * 召喚の出現位置（純粋関数。ADR-029）。ボスの号令で呼ぶ手下を、ボスの中心から radius m の円周に等間隔で並べる。
 * 先頭の向きは seed で決める（毎回同じ向きに出ないよう、Game は召喚の通し番号を seed にする）。アリーナの外に出る位置は、縁の内側へ寄せる。
 */

export interface SummonPoint {
  x: number;
  z: number;
}

/** out に count 個の位置を書く（out は呼び出し側が用意した配列。足りなければ増やす） */
export function summonPoints(cx: number, cz: number, count: number, radius: number, seed: number, arenaRadius: number, out: SummonPoint[]): number {
  const base = seed * 2.399963; // 黄金角（seed が変わるたびに向きがばらける）
  const limit = arenaRadius - 1;
  for (let i = 0; i < count; i++) {
    const a = base + (i * Math.PI * 2) / count;
    let x = cx + Math.sin(a) * radius;
    let z = cz + Math.cos(a) * radius;
    const d = Math.hypot(x, z);
    if (d > limit) {
      x *= limit / d;
      z *= limit / d;
    }
    if (!out[i]) out[i] = { x: 0, z: 0 };
    out[i]!.x = x;
    out[i]!.z = z;
  }
  return count;
}
