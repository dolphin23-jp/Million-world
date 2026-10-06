import { describe, expect, it } from 'vitest';
import { SPELLS, SPELL_SKILL_ORDER, SPELL_TARGETING, BOLT_BURSTS, type SpellId } from './data/spells';
import { SKILLS, SKILL_LEVEL_MAX, SKILL_ORDER } from './data/skills';
import { SPELL_ATTACKS, SPELL_ATTACK_OF, MOVE_ATTACKS } from './data/spell-attacks';
import { findAttack } from './data/skill-attacks';
import { LOADOUTS } from './data/loadouts';
import { SkillBook, skillCooldown, skillPower } from './skills';
import { Growth } from './growth';
import { makeSave, parseSave } from './save';
import { BOLT1_HOLD_T, BOLT2_HOLD_T, ST_BOLT1, ST_BOLT2, ST_BOLT3 } from '../character/data/spell-casts';
import { STAFF_FROM_STANCE } from '../character/data/staff';
import { AUTHORED_ATTACKS } from '../character/data/authored';
import { buildMoveTree } from './move-tree';

/** 杖（ADR-048）のデータの整合: 魔法の表・スキル（並列ボタン）・詠唱の攻撃・手付けクリップ・セーブの互換 */

describe('魔法の表（SPELLS）とスキル', () => {
  it('並列に並べる魔法（SPELL_SKILL_ORDER）は 5〜7 種類。どれも杖のスキルで、表の id と一致し、ボタンの表記は 4 文字まで', () => {
    expect(SPELL_SKILL_ORDER.length).toBeGreaterThanOrEqual(5);
    expect(SPELL_SKILL_ORDER.length).toBeLessThanOrEqual(7);
    expect(new Set(SPELL_SKILL_ORDER).size).toBe(SPELL_SKILL_ORDER.length);
    for (const id of SPELL_SKILL_ORDER) {
      expect(SKILLS[id], id).toBeDefined();
      expect(SKILLS[id].family, id).toBe('staff');
      expect(SKILLS[id].short.length, id).toBeLessThanOrEqual(4);
      expect(SPELLS[id], id).toBeDefined();
      expect(SPELLS[id].id).toBe(id);
      expect(SPELLS[id].short.length).toBeLessThanOrEqual(4);
    }
    // 杖のスキルはすべて並列の魔法（取りこぼしがない）
    expect(SKILL_ORDER.filter((id) => SKILLS[id].family === 'staff')).toEqual([...SPELL_SKILL_ORDER]);
  });

  it('指示された魔法がそろっている: 落雷（ターゲットと周囲）・吹雪（扇）・火炎放射（直線）・爆発・再生・旋風（同心円）', () => {
    expect(SPELLS.thunder.kind).toBe('strike');
    expect('around' in SPELLS.thunder && SPELLS.thunder.around !== undefined).toBe(true);
    expect(SPELLS.blizzard.kind).toBe('cone');
    expect(SPELLS.flame.kind).toBe('beam');
    expect(SPELLS.explosion.kind).toBe('strike');
    expect(SPELLS.regen.kind).toBe('regen');
    expect(SPELLS.hurricane.kind).toBe('ring');
    const hur = SPELLS.hurricane;
    if (hur.kind !== 'ring') throw new Error('ring');
    expect(hur.radii.length).toBeGreaterThanOrEqual(2); // 同心円
    // 状態異常（麻痺・凍結）は後回し: データの置き場だけがあり、まだ効かない（SpellSystem は status を読まない）
    expect(SPELLS.thunder.status?.kind).toBe('paralyze');
    expect(SPELLS.blizzard.status?.kind).toBe('freeze');
  });

  it('スキルの steps は、詠唱の攻撃 1 つ（SPELL_ATTACKS）を指す。詠唱が放つ魔法は、そのスキルの魔法と一致する', () => {
    for (const id of SPELL_SKILL_ORDER) {
      const def = SKILLS[id];
      expect(def.steps.length, id).toBe(1);
      expect(def.steps[0]!.attack, id).toBe(SPELL_ATTACK_OF[id]);
      expect(findAttack(def.steps[0]!.attack), id).toBe(SPELL_ATTACKS[def.steps[0]!.attack]);
      expect(SPELL_ATTACKS[def.steps[0]!.attack]!.cast!.spell, id).toBe(id);
      expect(def.evolutions, id).toBeUndefined(); // 魔法には剣技のような動きの進化は無い
    }
  });

  it('クールダウン（CT）は魔法ごとに違い、MP は無い。レベルで威力は増え、CT は縮む（0 にはならない）', () => {
    const cds = SPELL_SKILL_ORDER.map((id) => SKILLS[id].cooldownFrames);
    expect(new Set(cds).size).toBeGreaterThanOrEqual(4);
    for (const id of SPELL_SKILL_ORDER) {
      const d = SKILLS[id];
      expect(d.cooldownFrames, id).toBeGreaterThan(300);
      for (let lv = 2; lv <= SKILL_LEVEL_MAX; lv++) {
        expect(skillPower(d, lv), id).toBeGreaterThan(skillPower(d, lv - 1));
        expect(skillCooldown(d, lv), id).toBeLessThan(skillCooldown(d, lv - 1));
      }
    }
    // 威力が大きく詠唱が長い爆発は、CT がいちばん長い魔法のひとつ。再生は持続が長いぶん CT も長い
    expect(SKILLS.explosion.cooldownFrames).toBeGreaterThanOrEqual(SKILLS.thunder.cooldownFrames);
    expect(SKILLS.regen.cooldownFrames).toBeGreaterThan(SPELLS.regen.kind === 'regen' ? SPELLS.regen.frames : 0);
  });

  it('魔法の数値の妥当性: 範囲・間隔・長さは正。持続魔法の放出は詠唱の持続（cast.channel）と一致する', () => {
    for (const s of Object.values(SPELLS)) {
      switch (s.kind) {
        case 'strike':
          expect(s.center.radius, s.id).toBeGreaterThan(0);
          expect(s.center.damage, s.id).toBeGreaterThan(0);
          expect(s.warnFrames, s.id).toBeGreaterThanOrEqual(0);
          expect(s.lockFrames, s.id).toBeLessThanOrEqual(s.warnFrames);
          expect(s.edgeFalloff, s.id).toBeGreaterThan(0);
          expect(s.edgeFalloff, s.id).toBeLessThanOrEqual(1);
          if (s.around) {
            expect(s.around.ringMin).toBeLessThan(s.around.ringMax);
            expect(s.around.count).toBeGreaterThan(0);
          }
          break;
        case 'cone':
          expect(s.range).toBeGreaterThan(0);
          expect(s.halfAngleDeg).toBeGreaterThan(0);
          expect(s.halfAngleDeg).toBeLessThanOrEqual(90);
          expect(s.tickFrames).toBeGreaterThan(0);
          expect(s.frames).toBeGreaterThanOrEqual(s.tickFrames);
          break;
        case 'beam': {
          expect(s.length).toBeGreaterThan(0);
          expect(s.width).toBeGreaterThan(0);
          expect(s.tickFrames).toBeGreaterThan(0);
          const ch = SPELL_ATTACKS[SPELL_ATTACK_OF.flame]!.cast!.channel!;
          expect(ch.seconds * 60).toBeCloseTo(s.frames, 6);
          expect(ch.turnRate).toBeCloseTo(s.turnRate, 9);
          break;
        }
        case 'ring':
          for (let i = 1; i < s.radii.length; i++) expect(s.radii[i]!).toBeGreaterThan(s.radii[i - 1]!);
          expect(s.thickness).toBeGreaterThan(0);
          expect(s.expandFrames).toBeGreaterThan(0);
          break;
        case 'regen':
          expect(s.hpPerSecond).toBeGreaterThan(0);
          expect(s.frames).toBeGreaterThanOrEqual(s.tickFrames);
          break;
        case 'bolt':
          expect(s.damage).toBeGreaterThan(0);
          break;
      }
    }
    expect(SPELL_TARGETING.maxRange).toBeGreaterThan(SPELL_TARGETING.muzzle);
    for (const id of ['bolt3'] as SpellId[]) expect(BOLT_BURSTS[id]).toBeDefined();
  });

  it('魔法のダメージの大小関係: 爆発 > 落雷の中心 > 魔弾（高火力）。火炎放射・吹雪は時間あたりのダメージで見る', () => {
    const e = SPELLS.explosion;
    const t = SPELLS.thunder;
    if (e.kind !== 'strike' || t.kind !== 'strike') throw new Error('strike');
    expect(e.center.damage).toBeGreaterThan(t.center.damage);
    expect(t.center.damage).toBeGreaterThan(SPELLS.bolt3.kind === 'bolt' ? SPELLS.bolt3.damage : 0);
    // 範囲も爆発がいちばん広い
    expect(e.center.radius).toBeGreaterThan(t.center.radius);
  });
});

describe('詠唱の攻撃（SPELL_ATTACKS）と手付けクリップ', () => {
  it('どの詠唱も AttackDef.cast を持ち、当たり判定は持たない（ダメージ 0）。クリップは登録された手付け（AUTHORED_ATTACKS）で、杖の版の焼き込みを持たない', () => {
    for (const a of Object.values(SPELL_ATTACKS)) {
      expect(a.cast, a.id).toBeDefined();
      expect(a.damage, a.id).toBe(0);
      expect(a.authored, a.id).toBeDefined();
      expect(AUTHORED_ATTACKS[a.authored!.name], a.id).toBe(a.authored);
      expect(a.authored!.noShield, a.id).toBe(true);
      expect(a.cast!.at, a.id).toBeCloseTo(a.activeStart, 9);
      expect(a.cast!.at, a.id).toBeLessThan(a.segmentDuration);
    }
    expect(Object.keys(MOVE_ATTACKS)).toEqual(expect.arrayContaining(Object.keys(SPELL_ATTACKS)));
  });

  it('魔弾の連打は 1 ルート（stBolt1 → stBolt2 → stBolt3）で分岐が無い。後ろの詠唱は前の詠唱の受付の姿勢から続く（continueFrom）', () => {
    expect(SPELL_ATTACKS.stBolt1!.next).toBe('stBolt2');
    expect(SPELL_ATTACKS.stBolt2!.next).toBe('stBolt3');
    expect(SPELL_ATTACKS.stBolt3!.next).toBeUndefined();
    for (const a of ['stBolt1', 'stBolt2', 'stBolt3']) expect(SPELL_ATTACKS[a]!.branches, a).toBeUndefined();
    expect(ST_BOLT2.continueFrom).toEqual({ attack: ST_BOLT1, t: BOLT1_HOLD_T });
    expect(ST_BOLT3.continueFrom).toEqual({ attack: ST_BOLT2, t: BOLT2_HOLD_T });
    expect(SPELL_ATTACKS.stBolt1!.cancelAt).toBeCloseTo(BOLT1_HOLD_T, 9);
    expect(SPELL_ATTACKS.stBolt2!.cancelAt).toBeCloseTo(BOLT2_HOLD_T, 9);
    // 受付は、魔法を放ったあと
    expect(SPELL_ATTACKS.stBolt1!.cancelAt).toBeGreaterThan(SPELL_ATTACKS.stBolt1!.cast!.at);
    expect(SPELL_ATTACKS.stBolt2!.cancelAt).toBeGreaterThan(SPELL_ATTACKS.stBolt2!.cast!.at);
  });

  it('魔法の詠唱は、構えから始まる（continueFrom = 構えの静止）。魔弾の 1 段目も同じ', () => {
    for (const id of ['stBolt1', ...SPELL_SKILL_ORDER.map((s) => SPELL_ATTACK_OF[s])]) {
      expect(SPELL_ATTACKS[id]!.authored!.continueFrom, id).toEqual(STAFF_FROM_STANCE);
    }
  });

  it('杖の技のセットは MOVE_ATTACKS（技表・操作ガイドが読む表）にあり、技表は 1 ルートの木になる', () => {
    const l = LOADOUTS.staff;
    for (const id of Object.values(l.moveset)) expect(MOVE_ATTACKS[id], id).toBeDefined();
    const tree = buildMoveTree(l.moveset, l.charge);
    expect(tree.length).toBeGreaterThan(0);
  });
});

describe('SkillBook: 魔法を id で使う（並列ボタン）', () => {
  it('prepareById は選択を介さず、指定した魔法の連なりを作る。クールダウン中・未習得は null。作っただけではクールダウンに入らない', () => {
    const b = new SkillBook();
    const run = b.prepareById('blizzard')!;
    expect(run.skill).toBe('blizzard');
    expect(run.steps.map((s) => s.attack)).toEqual(['spBlizzard']);
    expect(b.ready('blizzard')).toBe(true);
    b.start('blizzard');
    expect(b.prepareById('blizzard')).toBeNull();
    expect(b.prepareById('thunder')).not.toBeNull(); // 別の魔法は使える（CT は魔法ごと）
    const z = new SkillBook({ regen: 0 });
    expect(z.prepareById('regen')).toBeNull();
  });

  it('威力の倍率（INT）は連なりの威力に掛かる。レベルが上がると威力が増える', () => {
    const b = new SkillBook();
    const base = b.prepareById('explosion')!.steps[0]!.power;
    expect(b.prepareById('explosion', 1.2)!.steps[0]!.power).toBeCloseTo(base * 1.2, 9);
    b.setLevel('explosion', 6);
    expect(b.prepareById('explosion')!.steps[0]!.power).toBeGreaterThan(base);
  });

  it('クールダウンの残り（cooldownLeft）と割合（cooldownRatio）は、start から 1 フレームずつ減る', () => {
    const b = new SkillBook();
    b.start('thunder');
    const total = skillCooldown(SKILLS.thunder, 1);
    expect(b.cooldownLeft('thunder')).toBe(total);
    expect(b.cooldownRatio('thunder')).toBe(1);
    for (let i = 0; i < 60; i++) b.step();
    expect(b.cooldownLeft('thunder')).toBe(total - 60);
    expect(b.cooldownRatio('thunder')).toBeCloseTo((total - 60) / total, 9);
  });

  it('杖の系統では、スキルボタン用の選択は使わない（available は並べた魔法の全部）。剣・大剣の選択と混ざらない', () => {
    const b = new SkillBook();
    expect(b.available('staff').map((d) => d.id)).toEqual([...SPELL_SKILL_ORDER]);
    expect(b.available('sword').every((d) => d.family === 'sword')).toBe(true);
  });
});

describe('セーブの互換（魔法のレベルは既存のセーブに無くても Lv1 で始まる）', () => {
  it('杖の導入前のセーブ（スキルが 11 個だけ）を読むと、魔法は Lv1。魔法のレベルも保存・復元できる', () => {
    const old = { version: 3, level: 5, xp: 10, statPoints: 2, skillPoints: 1, stats: {}, skills: { yotsuba: 3 }, passives: {}, selected: {} };
    const d = parseSave(old);
    expect(d).not.toBeNull();
    for (const id of SPELL_SKILL_ORDER) expect(d!.skills[id], id).toBe(1);
    expect(d!.skills.yotsuba).toBe(3);
    const g = new Growth(d!);
    expect(g.skillLevel('thunder')).toBe(1);
    g.addXp(100000);
    g.addSkill('thunder');
    const saved = parseSave(JSON.parse(JSON.stringify(makeSave(g, {}))))!;
    expect(saved.skills.thunder).toBe(2);
  });
});
