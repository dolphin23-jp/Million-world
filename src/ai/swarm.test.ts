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
