import { describe, expect, it } from 'vitest';
import { CHARGES } from './attacks';
import { MOVE_ATTACKS } from './spell-attacks';
import { GUARDS, PARRY_EFFECTS } from './guard';
import { DEFAULT_LOADOUT, LOADOUTS, LOADOUT_ORDER, isLoadoutId, nextLoadout } from './loadouts';
import { AuthoredSampler, type AuthoredAttack } from '../../character/authoring';
import type { PoseInput } from '../../character/pose-solver';
import { AUTHORED_ATTACKS, GREATSWORD_VARIANT, SHIELD_VARIANT, SPEAR_VARIANT } from '../../character/data/authored';
import { SHIELD_GUARD, SHIELD_GUARD_HIT, SHIELD_PARRY, SWORD_GUARD, SWORD_GUARD_HIT } from '../../character/data/guard';
import { makeRig } from '../../character/test-rig';

describe('ロードアウト（素手が標準・盾は装備。ADR-020）', () => {
  it('標準は素手の片手剣。盾は装備で出す', () => {
    expect(DEFAULT_LOADOUT).toBe('sword');
    expect(LOADOUTS[DEFAULT_LOADOUT].offhand).toBe('none');
    expect(LOADOUTS['sword-shield'].offhand).toBe('shield');
  });

  it('並び順は重複がなく、すべて定義されていて、標準を含む。次の装備へ一巡する', () => {
    expect(new Set(LOADOUT_ORDER).size).toBe(LOADOUT_ORDER.length);
    for (const id of LOADOUT_ORDER) expect(LOADOUTS[id].id).toBe(id);
    expect(Object.keys(LOADOUTS).sort()).toEqual([...LOADOUT_ORDER].sort());
    expect(LOADOUT_ORDER).toContain(DEFAULT_LOADOUT);
    let id = DEFAULT_LOADOUT;
    const seen: string[] = [];
    for (let i = 0; i < LOADOUT_ORDER.length; i++) {
      seen.push(id);
      id = nextLoadout(id);
    }
    expect(id).toBe(DEFAULT_LOADOUT);
    expect(new Set(seen).size).toBe(LOADOUT_ORDER.length);
  });

  it('isLoadoutId は定義された id だけ true（保存値・URL の検査に使う）', () => {
    expect(isLoadoutId('sword')).toBe(true);
    expect(isLoadoutId('sword-shield')).toBe(true);
    expect(isLoadoutId('greatsword')).toBe(true);
    for (const v of ['', 'greatsword?', 'toString', '__proto__', null, undefined, 3]) expect(isLoadoutId(v)).toBe(false);
  });

  it('技のセット・溜め・ガードはすべて実在する（MOVE_ATTACKS / CHARGES / AUTHORED_ATTACKS）', () => {
    for (const l of Object.values(LOADOUTS)) {
      for (const [slot, id] of Object.entries(l.moveset)) expect(MOVE_ATTACKS[id], `${l.id}.${slot}`).toBeDefined();
      // 杖（ADR-048）は溜めもガードも持たない（null）。ほかは両方ある
      if (l.charge !== null) expect(CHARGES[l.charge], `${l.id}.charge`).toBeDefined();
      const g = l.guard;
      if (g === null) {
        expect(l.weapon, l.id).toBe('staff');
        continue;
      }
      expect(g, l.id).toBe(GUARDS[g.id]);
      for (const [slot, clip] of Object.entries(g.clips)) expect(AUTHORED_ATTACKS[clip.name], `${l.id}.guard.${slot}`).toBe(clip);
    }
  });

  it('盾の有無と、ガード・クリップの版・走る速さが対応している（大剣は両手持ちで盾は持たず、大剣版のクリップ・専用のガード・重さで遅い）', () => {
    for (const l of Object.values(LOADOUTS)) {
      if (l.weapon === 'staff') continue; // 杖は別の項（下）
      if (l.weapon === 'greatsword') {
        expect(l.offhand).toBe('none');
        expect(l.guard!.id).toBe('greatsword');
        expect(l.clipVariant).toBe(GREATSWORD_VARIANT);
        expect(l.runSpeedScale).toBeLessThan(1);
        expect(l.charge).toBe('greatsword');
      } else if (l.weapon === 'spear') {
        // 槍（ADR-049）: 両手持ち・右手が前。槍版のクリップ・専用のガード（盾なしでパリィ）。走る速さは大剣より軽い
        expect(l.offhand).toBe('none');
        expect(l.guard!.id).toBe('spear');
        expect(l.clipVariant).toBe(SPEAR_VARIANT);
        expect(l.runSpeedScale).toBeLessThan(1);
        expect(l.runSpeedScale).toBeGreaterThan(LOADOUTS.greatsword.runSpeedScale);
        expect(l.charge).toBe('spear');
      } else if (l.offhand === 'shield') {
        expect(l.guard!.id).toBe('shield');
        expect(l.clipVariant).toBe(SHIELD_VARIANT);
        expect(l.runSpeedScale).toBeLessThan(1); // 盾の重さ
      } else {
        expect(l.guard!.id).toBe('sword');
        expect(l.clipVariant).toBe('');
        expect(l.runSpeedScale).toBe(1);
      }
    }
  });
});

describe('ガードの数値', () => {
  it('パリィがあるのは盾と大剣だけ（素手の剣にはない）。盾のほうが防ぐ割合が大きく、押されにくい', () => {
    expect(GUARDS.shield.parryFrames).toBeGreaterThan(0);
    expect(GUARDS.greatsword.parryFrames).toBeGreaterThan(0);
    expect(GUARDS.sword.parryFrames).toBe(0);
    expect(GUARDS.shield.clips.parry).toBeDefined();
    expect(GUARDS.greatsword.clips.parry).toBeDefined();
    expect(GUARDS.sword.clips.parry).toBeUndefined();
    expect(GUARDS.shield.damageReduction).toBeGreaterThan(GUARDS.sword.damageReduction);
    expect(GUARDS.shield.knockbackScale).toBeLessThan(GUARDS.sword.knockbackScale);
  });

  it('大剣のパリィは盾よりシビア（受付が短い。受け止めるだけの軽減も小さく、構え直しも遅い）で、弾かれた敵は倒れる（盾は体勢を崩す）', () => {
    expect(GUARDS.greatsword.parryFrames).toBeLessThan(GUARDS.shield.parryFrames);
    expect(GUARDS.greatsword.parryFrames).toBeGreaterThanOrEqual(4); // 指で狙える下限（0.07 秒）
    expect(GUARDS.greatsword.damageReduction).toBeLessThan(GUARDS.shield.damageReduction);
    expect(GUARDS.greatsword.damageReduction).toBeGreaterThan(GUARDS.sword.damageReduction);
    expect(GUARDS.greatsword.lockFrames).toBeGreaterThan(GUARDS.shield.lockFrames);
    expect(GUARDS.greatsword.parryEffect).toBe('down');
    expect(GUARDS.shield.parryEffect).toBe('stagger');
  });

  it('値の範囲: 軽減は 0..1 未満（防ぎきらない）、キャンセルは最短の構えより早い、パリィの受付は構えの動きの中', () => {
    for (const g of Object.values(GUARDS)) {
      expect(g.damageReduction, g.id).toBeGreaterThan(0);
      expect(g.damageReduction, g.id).toBeLessThan(1);
      expect(g.coneDeg, g.id).toBeGreaterThan(0);
      expect(g.coneDeg, g.id).toBeLessThanOrEqual(90);
      expect(g.cancelFrame, g.id).toBeLessThanOrEqual(g.minHoldFrames);
      expect(g.hitStunFrames, g.id).toBeGreaterThan(0);
      expect(g.lockFrames, g.id).toBeGreaterThan(0);
      expect(g.parryFrames, g.id).toBeLessThanOrEqual(Math.ceil(g.clips.enter.duration * 60) + 4);
    }
  });

  it('パリィで体勢を崩す時間は、1 段目から 2 段目まで続けて当てられる長さ。反撃はダメージが増え、ノックバックは減る', () => {
    const fx = PARRY_EFFECTS.stagger;
    expect(fx.frames).toBeGreaterThanOrEqual(45);
    expect(fx.riposteFrames).toBeLessThanOrEqual(fx.frames);
    expect(fx.riposteDamageScale).toBeGreaterThan(1);
    expect(fx.riposteKnockbackScale).toBeLessThan(1);
    expect(fx.riposteKnockbackScale).toBeGreaterThan(0);
  });

  it('弾かれた敵の効果（PARRY_EFFECTS）は、どれも反撃の受付が動けない時間の中にあり、倍率は妥当。構えは存在する効果を指す', () => {
    for (const fx of Object.values(PARRY_EFFECTS)) {
      expect(fx.riposteFrames, fx.id).toBeGreaterThan(0);
      expect(fx.riposteFrames, fx.id).toBeLessThanOrEqual(fx.frames);
      expect(fx.riposteDamageScale, fx.id).toBeGreaterThan(1);
      expect(fx.riposteKnockbackScale, fx.id).toBeGreaterThan(0);
      expect(fx.riposteKnockbackScale, fx.id).toBeLessThan(1);
      expect(fx.enemyKnockback, fx.id).toBeGreaterThan(0);
      expect(fx.hitStop, fx.id).toBeGreaterThan(0);
      expect(fx.recoverCooldownFrames, fx.id).toBeGreaterThan(0);
    }
    for (const g of Object.values(GUARDS)) expect(PARRY_EFFECTS[g.parryEffect], g.id).toBeDefined();
  });

  it('盾のパリィは体勢を崩す（stagger）、大剣のパリィは弾き飛ばして倒す（down）。倒れるほうが長く・遠く・反撃の倍率も大きい', () => {
    expect(GUARDS.shield.parryEffect).toBe('stagger');
    const s = PARRY_EFFECTS.stagger;
    const d = PARRY_EFFECTS.down;
    expect(d.frames).toBeGreaterThan(s.frames);
    expect(d.enemyKnockback).toBeGreaterThan(s.enemyKnockback);
    expect(d.riposteDamageScale).toBeGreaterThan(s.riposteDamageScale);
    expect(d.hitStop).toBeGreaterThan(s.hitStop);
  });
});

describe('ガードのクリップ（手付け）', () => {
  const rig = makeRig();
  const sample = (def: AuthoredAttack, t: number): PoseInput => {
    const s = new AuthoredSampler(rig, def);
    return s.sample(t, s.newInput());
  };
  const near = (a: PoseInput, b: PoseInput) => {
    for (const k of ['hips', 'chest', 'head'] as const) {
      for (const f of ['yaw', 'pitch', 'roll'] as const) expect(a[k][f], `${k}.${f}`).toBeCloseTo(b[k][f], 6);
    }
    expect(a.hips.x).toBeCloseTo(b.hips.x, 6);
    expect(a.hips.y).toBeCloseTo(b.hips.y, 6);
    expect(a.hips.z).toBeCloseTo(b.hips.z, 6);
    for (const k of ['grip', 'left'] as const) {
      expect(a[k].az, `${k}.az`).toBeCloseTo(b[k].az, 6);
      expect(a[k].el, `${k}.el`).toBeCloseTo(b[k].el, 6);
      expect(a[k].r, `${k}.r`).toBeCloseTo(b[k].r, 6);
    }
    expect(a.blade.distanceTo(b.blade)).toBeLessThan(1e-5);
    expect(a.face.distanceTo(b.face)).toBeLessThan(1e-5);
    expect(a.pole.distanceTo(b.pole)).toBeLessThan(1e-5);
    expect(a.leftPole.distanceTo(b.leftPole)).toBeLessThan(1e-5);
    for (const f of ['footL', 'footR'] as const) {
      expect(a[f].z, `${f}.z`).toBeCloseTo(b[f].z, 6);
      expect(a[f].lift, `${f}.lift`).toBeCloseTo(b[f].lift, 6);
    }
  };

  it('受け・パリィは構えの終端から始まり、同じ構えの姿勢に戻って終わる（構えを保ったまま動きを重ねられる）', () => {
    const pairs: [AuthoredAttack, AuthoredAttack][] = [
      [SHIELD_GUARD, SHIELD_GUARD_HIT],
      [SHIELD_GUARD, SHIELD_PARRY],
      [SWORD_GUARD, SWORD_GUARD_HIT],
    ];
    for (const [enter, other] of pairs) {
      expect(other.continueFrom?.attack, other.name).toBe(enter);
      expect(other.continueFrom?.t, other.name).toBeCloseTo(enter.duration, 9);
      // 始まりも終わりも、構えの終端の姿勢
      near(sample(other, 0), sample(enter, enter.duration));
      near(sample(other, other.duration), sample(enter, enter.duration));
    }
  });

  it('構えの動きは足を動かすのは入るときだけ（ルートは進まない）。受け・パリィでは足が動かない', () => {
    for (const def of [SHIELD_GUARD, SHIELD_GUARD_HIT, SHIELD_PARRY, SWORD_GUARD, SWORD_GUARD_HIT]) {
      const s = new AuthoredSampler(rig, def);
      for (let t = 0; t <= def.duration + 1e-9; t += 1 / 60) expect(s.rootZ(t), def.name).toBe(0);
    }
    for (const def of [SHIELD_GUARD_HIT, SHIELD_PARRY, SWORD_GUARD_HIT]) {
      const a = sample(def, 0);
      for (const t of [0.03, 0.06, 0.1, def.duration]) {
        const p = sample(def, t);
        expect(p.footL.z, `${def.name} t=${t}`).toBeCloseTo(a.footL.z, 6);
        expect(p.footR.z, `${def.name} t=${t}`).toBeCloseTo(a.footR.z, 6);
      }
    }
  });
});
