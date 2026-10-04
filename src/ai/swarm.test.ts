import { describe, expect, it } from 'vitest';
import { Enemy } from './enemy';
import { ENEMIES } from './data/enemies';
import { stepSwarm } from './swarm';

const DT = 1 / 60;

/** プレイヤー（原点）を、攻撃の距離のすぐ外側から囲む n 体 */
function ring(n: number): Enemy[] {
  const out: Enemy[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = ENEMIES.imp.attack.range - 0.15;
    const e = new Enemy(ENEMIES.imp, i + 1, Math.sin(a) * r, Math.cos(a) * r);
    e.place(Math.sin(a) * r, Math.cos(a) * r, a + Math.PI);
    out.push(e);
  }
  return out;
}

describe('stepSwarm（攻撃権）', () => {
  it('同時に予備動作〜攻撃にいる敵は、どのステップでも maxAttackers を超えない', () => {
    for (const max of [1, 2]) {
      const es = ring(4);
      let peak = 0;
      for (let i = 0; i < 1200; i++) {
        stepSwarm(es, DT, 0, 0, true, max);
        peak = Math.max(peak, es.filter((e) => e.attacking).length);
      }
      expect(peak).toBe(max); // 上限まで使い、超えない
    }
  });

  it('攻撃権が空けば、待っていた敵が順に攻撃する（全員がいつかは攻撃する）', () => {
    const es = ring(3);
    const attacked = new Set<number>();
    for (let i = 0; i < 2400; i++) {
      stepSwarm(es, DT, 0, 0, true, 1);
      for (const e of es) if (e.attacking) attacked.add(e.id);
    }
    expect(attacked.size).toBe(3);
  });

  it('攻撃権のない敵は、攻撃の距離に入っていても予備動作に入らず、追跡のまま構える', () => {
    const es = ring(2);
    // 出現直後の待ちを過ぎるまで進めて、先に入った 1 体だけが攻撃していること
    for (let i = 0; i < ENEMIES.imp.spawnIdleFrames + 5; i++) stepSwarm(es, DT, 0, 0, true, 1);
    expect(es.filter((e) => e.attacking)).toHaveLength(1);
    expect(es.filter((e) => e.state === 'chase')).toHaveLength(1);
  });

  it('攻撃中の敵が倒されると攻撃権が空く（次のステップから別の敵が入れる）', () => {
    const es = ring(2);
    for (let i = 0; i < ENEMIES.imp.spawnIdleFrames + 5; i++) stepSwarm(es, DT, 0, 0, true, 1);
    const attacker = es.find((e) => e.attacking)!;
    attacker.takeHit({ attackerId: 0, targetId: attacker.id, damage: 999, knockback: 0, hitStop: 0, dirX: 0, dirZ: 1, x: 0, z: 0 });
    stepSwarm(es, DT, 0, 0, true, 1);
    expect(es.filter((e) => e.attacking).map((e) => e.id)).not.toContain(attacker.id);
    expect(es.filter((e) => e.attacking)).toHaveLength(1);
  });

  it('プレイヤーが倒れたら全員が待機に戻る', () => {
    const es = ring(3);
    for (let i = 0; i < ENEMIES.imp.spawnIdleFrames + 10; i++) stepSwarm(es, DT, 0, 0, true, 2);
    for (let i = 0; i < 10; i++) stepSwarm(es, DT, 0, 0, false, 2);
    expect(es.every((e) => e.state === 'idle')).toBe(true);
  });
});

describe('攻撃権の重み（群れ。ADR-028）', () => {
  const bats = (n: number, r = 3.4): Enemy[] => {
    const out: Enemy[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const e = new Enemy(ENEMIES.bat, i + 1, Math.sin(a) * r, Math.cos(a) * r);
      e.place(Math.sin(a) * r, Math.cos(a) * r, a + Math.PI);
      out.push(e);
    }
    return out;
  };
  const used = (es: readonly Enemy[]): number => es.reduce((n, e) => n + (e.attacking ? e.attackWeight : 0), 0);

  it('重み 0.6 の小蝙蝠は、予算 2 の中で同時に 3 体まで（重みの合計は予算を超えない）', () => {
    const es = bats(6);
    let peak = 0;
    let peakWeight = 0;
    for (let i = 0; i < 1500; i++) {
      stepSwarm(es, DT, 0, 0, true, 2);
      peak = Math.max(peak, es.filter((e) => e.attacking).length);
      peakWeight = Math.max(peakWeight, used(es));
    }
    expect(peak).toBe(3);
    expect(peakWeight).toBeLessThanOrEqual(2 + 1e-9);
  });

  it('子鬼（重み 1）と小蝙蝠が混ざっても、重みの合計が予算を超えない。全員がいつかは攻撃する', () => {
    const imp = new Enemy(ENEMIES.imp, 10, 0, 1.7);
    imp.place(0, 1.7, Math.PI);
    const es = [imp, ...bats(4)];
    const attacked = new Set<number>();
    let peakWeight = 0;
    for (let i = 0; i < 3000; i++) {
      stepSwarm(es, DT, 0, 0, true, 2);
      peakWeight = Math.max(peakWeight, used(es));
      for (const e of es) if (e.attacking) attacked.add(e.id);
    }
    expect(peakWeight).toBeLessThanOrEqual(2 + 1e-9);
    expect(attacked.size).toBe(5);
  });

  it('予算ぴったりまで使える（重み 1 の敵は 2 体、浮動小数点の誤差で 1 体に減らない）', () => {
    const es = ring(4);
    let peak = 0;
    for (let i = 0; i < 600; i++) {
      stepSwarm(es, DT, 0, 0, true, 2);
      peak = Math.max(peak, es.filter((e) => e.attacking).length);
    }
    expect(peak).toBe(2);
  });

  it('攻撃権が無くても（予算 0）、小蝙蝠は輪（3m）を保ってプレイヤーの周りを回る。向きは id で決まり、逆向きに回る組がいる', () => {
    const es = bats(4);
    const angle = (e: Enemy): number => Math.atan2(e.body.x, e.body.z);
    const start = es.map(angle);
    let minD = 99;
    let maxD = 0;
    for (let i = 0; i < 240; i++) {
      stepSwarm(es, DT, 0, 0, true, 0);
      for (const e of es) {
        const d = Math.hypot(e.body.x, e.body.z);
        if (i > 60) {
          minD = Math.min(minD, d);
          maxD = Math.max(maxD, d);
        }
      }
    }
    expect(es.some((e) => e.attacking)).toBe(false);
    // 輪（stopDistance 3m）のまわりに保つ
    expect(minD).toBeGreaterThan(2.5);
    expect(maxD).toBeLessThan(3.6);
    // 回った（1 秒あたり 2.4m / 3m ≒ 0.8 rad）。向きは id の偶奇で逆になる
    const turned = es.map((e, i) => {
      let d = angle(e) - start[i]!;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      return d;
    });
    expect(Math.min(...turned.map(Math.abs))).toBeGreaterThan(0.5);
    expect(turned.some((t) => t > 0)).toBe(true);
    expect(turned.some((t) => t < 0)).toBe(true);
  });
});

