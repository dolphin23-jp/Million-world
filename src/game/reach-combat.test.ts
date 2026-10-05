import { describe, expect, it } from 'vitest';
import { NEVER_CRIT, resolveEnemyAttacks, resolvePlayerAttack, type AttackerView, type CombatTarget, type DefenderView } from './combat';
import { Enemy } from '../ai/enemy';
import { ENEMIES } from '../ai/data/enemies';
import { enemyDef } from '../ai/data/enemy-variants';
import { ATTACKS, resolveAttack } from '../combat/data/attacks';
import { HitTracker, type HitEvent } from '../combat/hit';
import type { DamageResult } from '../combat/health';
import { stepSwarm } from '../ai/swarm';

/**
 * 近接の縦の届き（M7-4b。ADR-044）: 登った縁の上のプレイヤーと、地面の小さな敵は、互いに届かない。
 * 背の高い敵・飛ぶ敵には届く。低い突進（猪）は、跳んでいる相手には当たらない。
 */

const result: DamageResult = { dealt: 1, killed: false };

/** 足の高さ y のプレイヤー（原点）。受けた命中を hits に集める。回避・ガードはしない */
function victimAt(y: number): { victim: DefenderView; hits: HitEvent[] } {
  const hits: HitEvent[] = [];
  const victim: DefenderView = {
    body: { id: 0, x: 0, z: 0, r: 0.38, invulnerable: false },
    y,
    takeHit: (ev) => {
      hits.push(ev);
      return result;
    },
  };
  return { victim, hits };
}

/** 攻撃が出ている敵を (0, z) に置く（攻撃の判定フレームまで進める）。プレイヤーの方（−Z）を向く */
function activeEnemy(type: keyof typeof ENEMIES, z: number): Enemy {
  const e = new Enemy({ ...ENEMIES[type], aggroRange: 99, spawnIdleFrames: 0 }, 1, 0, z);
  e.place(0, z, Math.PI);
  for (let i = 0; i < 200 && !e.attackActive; i++) e.step(1 / 60, 0, 0, true, true, 0);
  expect(e.attackActive).toBe(true);
  return e;
}

describe('敵の近接 → プレイヤー: 縦に届くか', () => {
  it('地面のプレイヤーには、子鬼の近接が当たる（従来どおり）', () => {
    const e = activeEnemy('imp', 1.2);
    const { victim, hits } = victimAt(0);
    resolveEnemyAttacks([e], victim, () => undefined);
    expect(hits).toHaveLength(1);
  });

  it('壇（2.2m）の上のプレイヤーには、子鬼の近接は届かない。降りてきて持続が残っていれば当たる（記録されない）', () => {
    const e = activeEnemy('imp', 1.2);
    const up = victimAt(2.2);
    resolveEnemyAttacks([e], up.victim, () => undefined);
    expect(up.hits).toHaveLength(0);
    expect(e.hitTracker.has(0)).toBe(false);
    const down = victimAt(0);
    resolveEnemyAttacks([e], down.victim, () => undefined);
    expect(down.hits).toHaveLength(1);
  });

  it('石の箱（1.5m）の上なら子鬼は届く。背の低い猪（1.15m）は届かない。背の高い岩鬼は壇（2.2m）にも届く', () => {
    const imp = activeEnemy('imp', 1.2);
    const onBox = victimAt(1.5);
    resolveEnemyAttacks([imp], onBox.victim, () => undefined);
    expect(onBox.hits).toHaveLength(1);

    const ogre = activeEnemy('ogre', 1.8);
    const ogreVictim = victimAt(2.2);
    resolveEnemyAttacks([ogre], ogreVictim.victim, () => undefined);
    expect(ogreVictim.hits).toHaveLength(1);
  });

  it('猪の突進は低い攻撃（reachTop）: 跳んでいて足が 0.6m より上なら当たらず、足が低ければ当たる。強化版でも同じ', () => {
    for (const def of [ENEMIES.boar, enemyDef('boar', 3)]) {
      expect(def.attack.reachTop).toBe(0.6);
      const e = new Enemy({ ...def, aggroRange: 99, spawnIdleFrames: 0 }, 1, 0, 3);
      e.place(0, 3, Math.PI);
      const air = victimAt(0.9);
      const ground = victimAt(0);
      // 突進の判定が出ているあいだ、同じ位置のプレイヤーに、跳んでいる場合と地面の場合を別々に当てる
      for (let i = 0; i < 300; i++) {
        e.step(1 / 60, 0, 0, true, true, 0);
        if (!e.attackActive) continue;
        resolveEnemyAttacks([e], air.victim, () => undefined);
        resolveEnemyAttacks([e], ground.victim, () => undefined);
      }
      const jumpHit = air.hits.length;
      const groundHit = ground.hits.length;
      expect(jumpHit).toBe(0);
      expect(groundHit).toBeGreaterThan(0);
    }
  });
});

describe('プレイヤーの近接 → 敵: 縦に届くか', () => {
  const combo1 = ATTACKS.combo1!;
  const frames = resolveAttack(combo1);

  /** 攻撃が出ているプレイヤー（足の高さ y）。原点で +Z を向く */
  function attacker(y: number): AttackerView {
    return {
      attackActive: true,
      attack: combo1,
      attackPower: 1,
      body: { x: 0, z: 0, r: 0.38 },
      yaw: 0,
      hitTracker: new HitTracker(),
      y,
    };
  }
  const target = (type: keyof typeof ENEMIES, z: number): Enemy => {
    const e = new Enemy(ENEMIES[type], 9, 0, z);
    e.place(0, z, Math.PI);
    return e;
  };

  it('地面のプレイヤーの剣は、子鬼にも蝙蝠（飛ぶ）にも届く', () => {
    expect(frames.active).toBeGreaterThan(0);
    for (const type of ['imp', 'bat'] as const) {
      const e = target(type, 1.0);
      const a = attacker(0);
      const n = resolvePlayerAttack(a, [e as CombatTarget], () => undefined, NEVER_CRIT);
      expect(n, type).toBe(1);
    }
  });

  it('壇（2.2m）の上から、地面の子鬼には届かない。背の高い岩鬼・大将には届く。箱（1.5m）の上からは子鬼に届く', () => {
    const high = attacker(2.2);
    expect(resolvePlayerAttack(high, [target('imp', 1.0) as CombatTarget], () => undefined, NEVER_CRIT)).toBe(0);
    expect(resolvePlayerAttack(attacker(2.2), [target('ogre', 1.0) as CombatTarget], () => undefined, NEVER_CRIT)).toBe(1);
    expect(resolvePlayerAttack(attacker(2.2), [target('boss', 1.0) as CombatTarget], () => undefined, NEVER_CRIT)).toBe(1);
    expect(resolvePlayerAttack(attacker(1.5), [target('imp', 1.0) as CombatTarget], () => undefined, NEVER_CRIT)).toBe(1);
  });

  it('届かなかった敵は記録されず、足の高さが変われば同じ攻撃が当たる（降りたあと）', () => {
    const e = target('imp', 1.0);
    const a = attacker(2.2);
    expect(resolvePlayerAttack(a, [e as CombatTarget], () => undefined, NEVER_CRIT)).toBe(0);
    expect(a.hitTracker.has(e.id)).toBe(false);
    const landed = { ...a, y: 0 } as AttackerView;
    expect(resolvePlayerAttack(landed, [e as CombatTarget], () => undefined, NEVER_CRIT)).toBe(1);
  });
});

describe('Enemy: 届かない相手には予備動作に入らない', () => {
  /** 敵を目の前（攻撃の距離）に置いて、attack の始まり（windup）に入るかを調べる */
  function startsWindup(type: keyof typeof ENEMIES, z: number, targetY: number): boolean {
    const e = new Enemy({ ...ENEMIES[type], aggroRange: 99, spawnIdleFrames: 0 }, 1, 0, z);
    e.place(0, z, Math.PI);
    for (let i = 0; i < 120; i++) {
      stepSwarm([e], 1 / 60, 0, 0, true, 9, targetY);
      if (e.state === 'windup' || e.state === 'attack') return true;
    }
    return false;
  }

  it('地面のプレイヤーなら全員が構える（従来どおり）', () => {
    expect(startsWindup('imp', 1.4, 0)).toBe(true);
    expect(startsWindup('boar', 4, 0)).toBe(true);
    expect(startsWindup('lantern', 6, 0)).toBe(true);
    expect(startsWindup('ogre', 2.2, 0)).toBe(true);
  });

  it('壇（2.2m）の上のプレイヤーには、子鬼・猪・提灯は構えない。背の高い岩鬼・大将と、飛ぶ蝙蝠は構える', () => {
    expect(startsWindup('imp', 1.4, 2.2)).toBe(false);
    expect(startsWindup('boar', 4, 2.2)).toBe(false);
    expect(startsWindup('lantern', 6, 2.2)).toBe(false);
    expect(startsWindup('ogre', 2.2, 2.2)).toBe(true);
    expect(startsWindup('boss', 3.4, 2.2)).toBe(true);
    expect(startsWindup('bat', 3, 2.2)).toBe(true);
  });

  it('箱（1.5m）の上: 子鬼は構える。猪（背 1.15m）は届かない。提灯は足が弾の高さより上なので撃たない', () => {
    expect(startsWindup('imp', 1.4, 1.5)).toBe(true);
    expect(startsWindup('boar', 4, 1.5)).toBe(false);
    expect(startsWindup('lantern', 6, 1.5)).toBe(false);
  });

  it('届かない敵は、そのまま近づいて待つ（攻撃権を使わない）。プレイヤーが降りれば構える', () => {
    const e = new Enemy({ ...ENEMIES.imp, aggroRange: 99, spawnIdleFrames: 0 }, 1, 0, 6);
    e.place(0, 6, Math.PI);
    for (let i = 0; i < 400; i++) {
      stepSwarm([e], 1 / 60, 0, 0, true, 9, 2.2);
      e.body.z = Math.max(e.body.z, 0.9); // 体は重ならない（プレイヤーの半径と敵の半径）
    }
    expect(e.state).toBe('chase');
    expect(e.attacking).toBe(false);
    for (let i = 0; i < 120 && !e.attacking; i++) stepSwarm([e], 1 / 60, 0, 0, true, 9, 0);
    expect(e.attacking).toBe(true);
  });
});
