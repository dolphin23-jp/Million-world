import { describe, expect, it } from 'vitest';
import { GUARDS } from './data/guard';
import { guardOutcome, guardedDamage } from './guard';

/**
 * ガード判定（純粋関数。ADR-020）。プレイヤーは原点で yaw の向き（+Z が 0、+X が +π/2）を向き、攻撃者は (ax, az) にいる。
 * dir = 攻撃者 → プレイヤーの単位ベクトル（HitEvent.dirX/dirZ）
 */
const DEG = Math.PI / 180;
function outcome(def: (typeof GUARDS)['shield'], frame: number, yawDeg: number, attackerDeg: number) {
  // 攻撃者は、世界の方位 attackerDeg（+Z が 0、+X が +90°）の向きの 2m 先にいる。dir はそこからプレイヤー（原点）へ
  const ax = Math.sin(attackerDeg * DEG) * 2;
  const az = Math.cos(attackerDeg * DEG) * 2;
  const len = Math.hypot(ax, az);
  return guardOutcome(def, frame, yawDeg * DEG, -ax / len, -az / len);
}

describe('guardOutcome', () => {
  const shield = GUARDS.shield;
  const sword = GUARDS.sword;

  it('盾: 構えに入ってから parryFrames のあいだはパリィ、そのあとはガード', () => {
    for (let f = 1; f <= shield.parryFrames; f++) expect(outcome(shield, f, 0, 0), `f${f}`).toBe('parry');
    expect(outcome(shield, shield.parryFrames + 1, 0, 0)).toBe('guard');
    expect(outcome(shield, 60, 0, 0)).toBe('guard');
  });

  it('構えに入った step（frame 1）からパリィが効き、frame 0 以前は効かない', () => {
    expect(outcome(shield, 1, 0, 0)).toBe('parry');
    expect(outcome(shield, 0, 0, 0)).toBe('guard');
  });

  it('素手の剣のガードにパリィはない（受付のあいだもガード）', () => {
    expect(sword.parryFrames).toBe(0);
    for (const f of [1, 5, 10, 11, 30]) expect(outcome(sword, f, 0, 0), `f${f}`).toBe('guard');
  });

  it('構えの正面から coneDeg 以内なら防げる。外（横・背後）からは防げない', () => {
    for (const def of [shield, sword]) {
      const c = def.coneDeg;
      expect(outcome(def, 30, 0, c - 1)).toBe('guard');
      expect(outcome(def, 30, 0, -(c - 1))).toBe('guard');
      expect(outcome(def, 30, 0, c + 1)).toBe('none');
      expect(outcome(def, 30, 0, -(c + 1))).toBe('none');
      expect(outcome(def, 30, 0, 90)).toBe('none');
      expect(outcome(def, 30, 0, 180)).toBe('none');
    }
  });

  it('パリィの受付中でも、正面の外からの攻撃は弾けない', () => {
    expect(outcome(shield, 3, 0, shield.coneDeg + 5)).toBe('none');
    expect(outcome(shield, 3, 0, 180)).toBe('none');
  });

  it('構えの向き（yaw）が基準: どの向きを向いていても、その正面から来る攻撃を防ぐ', () => {
    for (const yaw of [0, 90, 180, -90, 135]) {
      expect(outcome(shield, 20, yaw, yaw), `yaw ${yaw}`).toBe('guard');
      expect(outcome(shield, 20, yaw, yaw + 180), `yaw ${yaw} 背後`).toBe('none');
    }
  });

  it('盾のほうが広く防ぎ（cone）、素手の剣は狭い', () => {
    expect(shield.coneDeg).toBeGreaterThan(sword.coneDeg);
    expect(outcome(shield, 30, 0, 70)).toBe('guard');
    expect(outcome(sword, 30, 0, 70)).toBe('none');
  });
});

describe('guardedDamage', () => {
  it('軽減した残りが削りダメージとして通る（盾 85% / 剣 50%）', () => {
    expect(guardedDamage(12, GUARDS.shield)).toBe(2);
    expect(guardedDamage(12, GUARDS.sword)).toBe(6);
    expect(guardedDamage(40, GUARDS.shield)).toBe(6);
  });

  it('ダメージのある攻撃は、どれだけ軽減しても最低 1 は通る。ダメージ 0 は 0', () => {
    expect(guardedDamage(1, GUARDS.shield)).toBe(1);
    expect(guardedDamage(3, GUARDS.shield)).toBe(1);
    expect(guardedDamage(0, GUARDS.shield)).toBe(0);
    expect(guardedDamage(-5, GUARDS.shield)).toBe(0);
  });
});
