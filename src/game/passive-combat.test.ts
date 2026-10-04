import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { resolvePlayerAttack, type AttackerView, type CombatTarget } from './combat';
import { Enemy } from '../ai/enemy';
import { ENEMIES, type EnemyDef } from '../ai/data/enemies';
import { ATTACKS } from '../combat/data/attacks';
import { createEmptyIntent } from '../input/intent';
import { Growth } from '../combat/growth';
import { totalXpTo } from '../combat/data/growth';
import { KillBuff } from '../combat/buffs';
import { KILL_BUFF } from '../combat/data/passives';
import { BASE_MODIFIERS, computeModifiers, baseStats } from '../combat/modifiers';
import type { HitEvent } from '../combat/hit';
import type { DamageResult } from '../combat/health';

/**
 * パッシブ（ADR-037）が戦闘の数値に届くことの、本物の Player・当たり判定との結合テスト。
 * カメラ yaw = π のとき、スティックの上は +Z。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const DUMMY: EnemyDef = { ...ENEMIES.imp, hp: 999999, knockbackScale: 0 };

function swingAt(p: Player, z = 1.4): HitEvent {
  const e = new Enemy(DUMMY, 1, 0, z);
  e.place(0, z, Math.PI);
  let ev: HitEvent | null = null;
  p.step(DT, { ...createEmptyIntent(), attackPressed: true }, CAM_YAW);
  for (let i = 0; i < 60 && !ev; i++) {
    p.step(DT, createEmptyIntent(), CAM_YAW);
    e.step(DT, p.body.x, p.body.z, false);
    resolvePlayerAttack(p, [e] as CombatTarget[], (h) => (ev = h));
  }
  return ev!;
}

/** 弾かれて動けない敵に見立てた的（反撃の倍率つき） */
function riposteTarget(): CombatTarget {
  return {
    body: { id: 7, x: 0, z: 1.2, r: 0.5, invulnerable: false },
    takeHit: (ev): DamageResult => ({ dealt: ev.damage, killed: false }),
    riposte: { riposteDamageScale: 1.8, riposteKnockbackScale: 0.2 },
  };
}

const view = (over: Partial<AttackerView> = {}): AttackerView => ({
  attackActive: true,
  attack: { ...ATTACKS.combo1! },
  attackPower: 1,
  body: { x: 0, z: 0, r: 0.4 },
  yaw: 0,
  hitTracker: { reset() {}, has: () => false, add() {}, count: 0 } as unknown as AttackerView['hitTracker'],
  ...over,
});

describe('連撃の心得: 連携・剣技の 3 発目以降のダメージ', () => {
  it('Player の comboMul は、連携の履歴が 3 つ以上のときだけ Modifiers.comboDamage（それ以外は 1）', () => {
    const p = new Player();
    p.setModifiers({ ...BASE_MODIFIERS, comboDamage: 1.2 });
    expect(p.comboMul).toBe(1);
    p.chain.push('a', 'b');
    expect(p.comboMul).toBe(1);
    p.chain.push('c');
    expect(p.comboMul).toBe(1.2);
  });
  it('当たり判定は comboMul をダメージに掛ける（STR・会心などと掛け算）', () => {
    const got: HitEvent[] = [];
    resolvePlayerAttack(view({ comboMul: 1.2, damageMul: 1.1 }), [riposteTarget()].map((t) => ({ ...t, riposte: null })), (ev) => got.push(ev));
    expect(got[0]!.damage).toBe(Math.round(ATTACKS.combo1!.damage * 1.1 * 1.2));
  });
  it('1 発目（連携の履歴が 1 つ）では効かない: 本物の Player の最初の一撃は、パッシブがあっても通常のダメージ', () => {
    const p = new Player();
    p.setModifiers({ ...BASE_MODIFIERS, comboDamage: 1.5 });
    expect(swingAt(p).damage).toBe(ATTACKS.combo1!.damage);
  });
});

describe('追い打ち: 弾かれた敵・体勢を崩した敵への攻撃（反撃）のダメージ', () => {
  it('反撃のとき、反撃の倍率にさらに riposteMul が掛かる。反撃でなければ効かない', () => {
    const got: HitEvent[] = [];
    resolvePlayerAttack(view({ riposteMul: 1.18 }), [riposteTarget()], (ev) => got.push(ev));
    expect(got[0]!.damage).toBe(Math.round(ATTACKS.combo1!.damage * 1.8 * 1.18));
    const plain: HitEvent[] = [];
    resolvePlayerAttack(view({ riposteMul: 1.18 }), [{ ...riposteTarget(), riposte: null }], (ev) => plain.push(ev));
    expect(plain[0]!.damage).toBe(ATTACKS.combo1!.damage);
  });
  it('Player の riposteMul は Modifiers.riposteDamage', () => {
    const p = new Player();
    expect(p.riposteMul).toBe(1);
    p.setModifiers({ ...BASE_MODIFIERS, riposteDamage: 1.18 });
    expect(p.riposteMul).toBe(1.18);
  });
});

describe('闘気: 敵を倒すと一定時間、攻撃力が上がる', () => {
  it('buffBonus は damageMul に足される（Modifiers.damage + 闘気）。0 なら変わらない', () => {
    const p = new Player();
    p.setModifiers({ ...BASE_MODIFIERS, damage: 1.1 });
    expect(p.damageMul).toBeCloseTo(1.1, 9);
    p.buffBonus = 0.1;
    expect(p.damageMul).toBeCloseTo(1.2, 9);
    expect(swingAt(p).damage).toBe(Math.round(ATTACKS.combo1!.damage * 1.2));
  });
  it('KillBuff.bonus を buffBonus に渡す流れ: 3 回倒す（1 回 +2%）と +6%。時間が尽きたら 0 に戻る', () => {
    const p = new Player();
    const b = new KillBuff();
    const perStack = 0.02;
    for (let i = 0; i < 3; i++) b.onKill();
    p.buffBonus = b.bonus(perStack);
    expect(p.damageMul).toBeCloseTo(1.06, 9);
    for (let i = 0; i < KILL_BUFF.frames; i++) b.step();
    p.buffBonus = b.bonus(perStack);
    expect(p.damageMul).toBeCloseTo(1, 9);
  });
});

describe('系統つきのパッシブ: 装備している武器で効きが変わる（本物の Growth + Player）', () => {
  it('剣術習熟は片手剣のダメージだけ。大剣に持ち替えると効かず、剛力習熟が効く', () => {
    const g = new Growth();
    g.addXp(totalXpTo(11));
    for (let i = 0; i < 5; i++) g.addPassive('swordMastery');
    for (let i = 0; i < 5; i++) g.addPassive('greatMastery');
    const p = new Player();
    p.equip('sword');
    p.setModifiers(g.modifiersFor(p.loadout.weapon));
    expect(p.damageMul).toBeCloseTo(1.2, 9);
    expect(p.knockbackMul).toBeCloseTo(1, 9);
    p.equip('greatsword');
    p.setModifiers(g.modifiersFor(p.loadout.weapon));
    expect(p.damageMul).toBeCloseTo(1.2, 9);
    expect(p.knockbackMul).toBeCloseTo(1.15, 9);
    // 盾付きの片手剣も剣の系統
    p.equip('sword-shield');
    expect(p.loadout.weapon).toBe('sword');
  });
});

describe('パッシブが Player の数値に届く', () => {
  it('見切り・受け流し・身軽・鉄壁・会心の心得が Player の mods から読まれる', () => {
    const m = computeModifiers(baseStats(), { evasion: 3, parryArt: 2, agile: 5, ironwall: 5, critChance: 5 }, 'sword');
    const p = new Player();
    p.setModifiers(m);
    expect(p.critRate).toBeCloseTo(0.05 + 0.1, 9);
    expect(p.mods.parryFrames).toBe(2);
    expect(p.mods.dodgeInvuln).toBe(3);
    expect(p.mods.moveSpeed).toBeCloseTo(1.1, 9);
    // 鉄壁 −15%: 20 のダメージを受けると 17
    const before = p.health.hp;
    p.takeHit({ attackerId: 1, targetId: 0, damage: 20, knockback: 0, hitStop: 0, dirX: 0, dirZ: -1, x: 0, z: 0 });
    expect(before - p.health.hp).toBe(Math.round(20 * 0.85));
  });
});
