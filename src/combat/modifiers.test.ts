import { describe, expect, it } from 'vitest';
import { BASE_MODIFIERS, baseStats, computeModifiers, describeStat, type Modifiers } from './modifiers';
import { CRIT } from './data/crit';
import { STAT_BASE, STAT_EFFECTS, STAT_IDS, STAT_OVER_RATE, STAT_SOFT_CAP, effectivePoints, type StatId } from './data/stats';

const withStat = (id: StatId, points: number) => ({ ...baseStats(), [id]: STAT_BASE + points });

describe('Modifiers の集計', () => {
  it('初期のステータスでは何も変わらない', () => {
    expect(computeModifiers(baseStats())).toEqual(BASE_MODIFIERS);
  });
  it('STR: ダメージとノックバックが伸びる', () => {
    const m = computeModifiers(withStat('str', 10));
    expect(m.damage).toBeCloseTo(1 + 10 * STAT_EFFECTS.str.damage, 9);
    expect(m.knockback).toBeCloseTo(1 + 10 * STAT_EFFECTS.str.knockback, 9);
    expect(m.attackSpeed).toBe(1);
  });
  it('DEX: 攻撃が速くなり、パリィの受付が 10 点ごとに 1 フレーム伸びる', () => {
    expect(computeModifiers(withStat('dex', 9)).parryFrames).toBe(0);
    expect(computeModifiers(withStat('dex', 10)).parryFrames).toBe(1);
    expect(computeModifiers(withStat('dex', 20)).parryFrames).toBe(2);
    expect(computeModifiers(withStat('dex', 20)).attackSpeed).toBeCloseTo(1.1, 9);
  });
  it('AGI: 移動・回避の無敵（8 点で +1f）・ミスティカル（1 点 +3f）', () => {
    const m = computeModifiers(withStat('agi', 16));
    expect(m.moveSpeed).toBeCloseTo(1 + 16 * STAT_EFFECTS.agi.moveSpeed, 9);
    expect(m.dodgeInvuln).toBe(2);
    expect(m.mysticalFrames).toBe(48);
    expect(computeModifiers(withStat('agi', 7)).dodgeInvuln).toBe(0);
  });
  it('INT: クールダウンが縮み（下限あり）、スキルの威力と回復が伸びる', () => {
    const m = computeModifiers(withStat('int', 10));
    expect(m.skillCooldown).toBeCloseTo(1 - 10 * STAT_EFFECTS.int.skillCooldown, 9);
    expect(m.skillPower).toBeGreaterThan(1);
    expect(m.heal).toBeCloseTo(1.1, 9);
    expect(computeModifiers(withStat('int', 400)).skillCooldown).toBe(STAT_EFFECTS.int.skillCooldownFloor);
  });
  it('VIT: 最大体力が整数で増え、受けるダメージが減る（下限あり）', () => {
    const m = computeModifiers(withStat('vit', 7));
    expect(m.maxHp).toBe(14);
    expect(Number.isInteger(m.maxHp)).toBe(true);
    expect(m.damageTaken).toBeLessThan(1);
    expect(computeModifiers(withStat('vit', 900)).damageTaken).toBe(STAT_EFFECTS.vit.damageTakenFloor);
  });
  it('どのステータスも、振るほど有利に単調に動く（下限・上限まで）', () => {
    const better = (a: Modifiers, b: Modifiers) =>
      a.damage >= b.damage && a.attackSpeed >= b.attackSpeed && a.moveSpeed >= b.moveSpeed && a.skillPower >= b.skillPower && a.heal >= b.heal && a.maxHp >= b.maxHp && a.skillCooldown <= b.skillCooldown && a.damageTaken <= b.damageTaken && a.dodgeInvuln >= b.dodgeInvuln && a.mysticalFrames >= b.mysticalFrames && a.parryFrames >= b.parryFrames;
    for (const id of STAT_IDS) {
      let prev = computeModifiers(baseStats());
      for (let p = 1; p <= 90; p++) {
        const cur = computeModifiers(withStat(id, p));
        expect(better(cur, prev), `${id} +${p}`).toBe(true);
        prev = cur;
      }
    }
  });
  it('他のステータスに影響しない（STR を振っても INT の効果は変わらない）', () => {
    const m = computeModifiers(withStat('str', 20));
    expect(m.skillCooldown).toBe(1);
    expect(m.maxHp).toBe(0);
    expect(m.moveSpeed).toBe(1);
  });
});

describe('逓減（振った点が上限を超えた分は半分の効き）', () => {
  it('上限までは 1 点 = 1、超えた分は STAT_OVER_RATE 倍', () => {
    expect(effectivePoints(0)).toBe(0);
    expect(effectivePoints(STAT_SOFT_CAP)).toBe(STAT_SOFT_CAP);
    expect(effectivePoints(STAT_SOFT_CAP + 10)).toBe(STAT_SOFT_CAP + 10 * STAT_OVER_RATE);
    expect(effectivePoints(-3)).toBe(0);
  });
  it('超えたあとの 1 点は、超える前の 1 点より効きが小さい', () => {
    const a = computeModifiers(withStat('str', STAT_SOFT_CAP)).damage - computeModifiers(withStat('str', STAT_SOFT_CAP - 1)).damage;
    const b = computeModifiers(withStat('str', STAT_SOFT_CAP + 1)).damage - computeModifiers(withStat('str', STAT_SOFT_CAP)).damage;
    expect(b).toBeLessThan(a);
    expect(b).toBeGreaterThan(0);
  });
  it('ほかのステータスのぶんは数えない（1 つに集中した最大でも、現実的な範囲）', () => {
    // Lv30 で全部 STR に振ると 87 点 → 効きに使う点 58.5。ダメージは +58.5%
    expect(computeModifiers(withStat('str', 87)).damage).toBeCloseTo(1 + 0.01 * (30 + 57 * 0.5), 9);
  });
});

describe('会心（DEX。ADR-035）', () => {
  it('初期は会心率 5%・会心ダメージ ×1.5。DEX 1 点ごとに会心率 +0.5%・会心ダメージ +0.015', () => {
    const base = computeModifiers(baseStats());
    expect(base.critRate).toBe(CRIT.baseRate);
    expect(base.critDamage).toBe(CRIT.baseDamage);
    const m = computeModifiers(withStat('dex', 20));
    expect(m.critRate).toBeCloseTo(0.05 + 0.005 * 20, 9);
    expect(m.critDamage).toBeCloseTo(1.5 + 0.015 * 20, 9);
  });
  it('DEX 以外のステータスは会心に効かない', () => {
    for (const id of STAT_IDS) {
      if (id === 'dex') continue;
      const m = computeModifiers(withStat(id, 30));
      expect(m.critRate, id).toBe(CRIT.baseRate);
      expect(m.critDamage, id).toBe(CRIT.baseDamage);
    }
  });
  it('単調に伸び、上限（会心率 maxRate）を超えない。逓減も効く', () => {
    let prev = computeModifiers(withStat('dex', 0));
    for (let pts = 1; pts <= 200; pts++) {
      const m = computeModifiers(withStat('dex', pts));
      expect(m.critRate).toBeGreaterThanOrEqual(prev.critRate);
      expect(m.critDamage).toBeGreaterThan(prev.critDamage);
      expect(m.critRate).toBeLessThanOrEqual(CRIT.maxRate);
      prev = m;
    }
    // 30 点を超えた分は効き半分
    const a = computeModifiers(withStat('dex', 31)).critDamage - computeModifiers(withStat('dex', 30)).critDamage;
    const b = computeModifiers(withStat('dex', 30)).critDamage - computeModifiers(withStat('dex', 29)).critDamage;
    expect(a).toBeCloseTo(b / 2, 9);
  });
});

describe('画面の説明', () => {
  it('ステータスごとの効果の文章に、集計した数値が入る', () => {
    const m = computeModifiers({ ...baseStats(), str: STAT_BASE + 12, dex: STAT_BASE + 20, vit: STAT_BASE + 10 });
    expect(describeStat('str', m)).toContain('+12%');
    expect(describeStat('dex', m)).toContain('+10%');
    expect(describeStat('dex', m)).toContain('+2f');
    expect(describeStat('dex', m)).toContain('会心率 15.0%');
    expect(describeStat('dex', m)).toContain('会心ダメージ ×1.80');
    expect(describeStat('vit', m)).toContain('+20');
    expect(describeStat('vit', m)).toContain('−3%');
    for (const id of STAT_IDS) expect(describeStat(id, BASE_MODIFIERS).length).toBeGreaterThan(5);
  });
});
