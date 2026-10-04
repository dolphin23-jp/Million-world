import { describe, expect, it } from 'vitest';
import { SKILLS, SKILL_LEVEL_MAX, SKILL_ORDER, type SkillId } from './data/skills';
import { SkillBook, skillCooldown, skillPower, skillSteps } from './skills';
import { ATTACKS, resolveAttack } from './data/attacks';

describe('スキルのデータの整合', () => {
  it('id・名前は重複せず、ボタンに出す短い表記は 4 文字まで', () => {
    expect(new Set(SKILL_ORDER).size).toBe(SKILL_ORDER.length);
    expect(Object.keys(SKILLS).sort()).toEqual([...SKILL_ORDER].sort());
    const names = SKILL_ORDER.map((id) => SKILLS[id].name);
    expect(new Set(names).size).toBe(names.length);
    for (const id of SKILL_ORDER) {
      expect(SKILLS[id].id).toBe(id);
      expect(SKILLS[id].short.length).toBeLessThanOrEqual(4);
    }
  });

  it('連なりの攻撃 id はすべて ATTACKS にあり、武器の系統と合っている（大剣の技は gs で始まる）', () => {
    for (const id of SKILL_ORDER) {
      const def = SKILLS[id];
      expect(def.steps.length).toBeGreaterThanOrEqual(2);
      for (const s of def.steps) {
        expect(ATTACKS[s.attack], `${id}: ${s.attack}`).toBeTruthy();
        expect(s.attack.startsWith('gs')).toBe(def.family === 'greatsword');
      }
    }
  });

  it('連なりの隣り合う 2 技は、前の技の next か branches の辺（姿勢のつなぎ目が自然であることの保証）', () => {
    for (const id of SKILL_ORDER) {
      const steps = SKILLS[id].steps;
      for (let i = 0; i + 1 < steps.length; i++) {
        const a = ATTACKS[steps[i]!.attack]!;
        const b = steps[i + 1]!.attack;
        const edges = [a.next, ...Object.values(a.branches ?? {})].filter((x): x is string => typeof x === 'string');
        expect(edges, `${id}: ${a.id} → ${b}`).toContain(b);
      }
    }
  });

  it('次の段へ移れる受付（cancelFrame）は、持続（当たりの判定）が終わったあと', () => {
    for (const id of SKILL_ORDER) {
      for (const s of SKILLS[id].steps) {
        const fr = resolveAttack(ATTACKS[s.attack]!);
        expect(fr.cancelFrame, `${id}: ${s.attack}`).toBeGreaterThanOrEqual(fr.startup + fr.active);
      }
    }
  });

  it('段の解放レベルは先頭が 1 で、後ろへ向けて単調に増える（レベルで連なりの末尾が伸びる）', () => {
    for (const id of SKILL_ORDER) {
      const steps = SKILLS[id].steps;
      expect(steps[0]!.minLevel ?? 1).toBe(1);
      let prev = 1;
      for (const s of steps) {
        const lv = s.minLevel ?? 1;
        expect(lv).toBeGreaterThanOrEqual(prev);
        expect(lv).toBeLessThanOrEqual(SKILL_LEVEL_MAX);
        prev = lv;
      }
    }
  });

  it('レベルが上がるほど威力は増え、クールダウンは短くなる（0 にはならない）', () => {
    for (const id of SKILL_ORDER) {
      const def = SKILLS[id];
      for (let lv = 2; lv <= SKILL_LEVEL_MAX; lv++) {
        expect(skillPower(def, lv)).toBeGreaterThan(skillPower(def, lv - 1));
        expect(skillCooldown(def, lv)).toBeLessThan(skillCooldown(def, lv - 1));
      }
      expect(skillCooldown(def, SKILL_LEVEL_MAX)).toBeGreaterThan(60);
    }
  });
});

describe('skillSteps: レベルで連なりが伸びる', () => {
  it('五月雨は Lv1 で 3 段、Lv3 で 4 段、Lv5 で 5 段', () => {
    const def = SKILLS.samidare;
    expect(skillSteps(def, 1).map((s) => s.attack)).toEqual(['combo1', 'combo2', 'combo3']);
    expect(skillSteps(def, 2).length).toBe(3);
    expect(skillSteps(def, 3).map((s) => s.attack)).toEqual(['combo1', 'combo2', 'combo3', 'comboUpper']);
    expect(skillSteps(def, 5).map((s) => s.attack)).toEqual(['combo1', 'combo2', 'combo3', 'comboUpper', 'comboSlam']);
  });

  it('段の威力 = スキルの威力 × 段の倍率', () => {
    const def = SKILLS.tsubame;
    const steps = skillSteps(def, 1);
    expect(steps[0]!.power).toBeCloseTo(def.power);
    expect(steps[2]!.power).toBeCloseTo(def.power * 1.1);
    const lv3 = skillSteps(def, 3);
    expect(lv3[0]!.power).toBeCloseTo(def.power + def.powerPerLevel * 2);
  });

  it('cooldown の倍率（INT など）が掛かる', () => {
    const def = SKILLS.senpu;
    expect(skillCooldown(def, 1, 0.5)).toBe(Math.round(def.cooldownFrames * 0.5));
  });
});

describe('SkillBook', () => {
  it('最初は全スキル Lv1。その系統で使えるものだけが並ぶ', () => {
    const b = new SkillBook();
    for (const id of SKILL_ORDER) expect(b.level(id)).toBe(1);
    expect(b.available('sword').map((d) => d.id)).toEqual(['tsubame', 'samidare', 'senpu', 'shippu']);
    expect(b.available('greatsword').map((d) => d.id)).toEqual(['dangan', 'ouzu', 'houzan', 'shoryu']);
  });

  it('選んでいなければ系統の最初のスキル。select で替わり、系統ごとに別々に覚えている', () => {
    const b = new SkillBook();
    expect(b.selectedFor('sword')!.id).toBe('tsubame');
    expect(b.select('senpu')).toBe(true);
    expect(b.selectedFor('sword')!.id).toBe('senpu');
    expect(b.selectedFor('greatsword')!.id).toBe('dangan');
    b.select('houzan');
    expect(b.selectedFor('sword')!.id).toBe('senpu');
    expect(b.selectedFor('greatsword')!.id).toBe('houzan');
  });

  it('レベル 0 のスキルは使えず、選べない。選んでいたものがレベル 0 になったら最初のものへ戻る', () => {
    const b = new SkillBook({ tsubame: 0 });
    expect(b.available('sword').map((d) => d.id)).not.toContain('tsubame');
    expect(b.select('tsubame')).toBe(false);
    expect(b.selectedFor('sword')!.id).toBe('samidare');
    b.select('senpu');
    b.setLevel('senpu', 0);
    expect(b.selectedFor('sword')!.id).toBe('samidare');
    const none = new SkillBook({ dangan: 0, ouzu: 0, houzan: 0, shoryu: 0 });
    expect(none.selectedFor('greatsword')).toBeNull();
    expect(none.prepare('greatsword')).toBeNull();
    expect(none.cycle('greatsword')).toBeNull();
  });

  it('cycle: 使えるスキルを順に回る', () => {
    const b = new SkillBook();
    const seen: SkillId[] = [];
    for (let i = 0; i < 5; i++) seen.push(b.cycle('sword', 1)!.id);
    expect(seen).toEqual(['samidare', 'senpu', 'shippu', 'tsubame', 'samidare']);
    expect(b.cycle('sword', -1)!.id).toBe('tsubame');
  });

  it('prepare は選んでいるスキルの連なりを返し、クールダウンには入らない。start でクールダウンに入り、step で明ける', () => {
    const b = new SkillBook();
    const run = b.prepare('sword')!;
    expect(run.skill).toBe('tsubame');
    expect(run.steps.map((s) => s.attack)).toEqual(['combo1', 'comboHop', 'hopThrust']);
    expect(b.ready('tsubame')).toBe(true);
    expect(b.prepare('sword')).not.toBeNull(); // 使っていない = まだ使える
    b.start('tsubame');
    expect(b.ready('tsubame')).toBe(false);
    expect(b.cooldownRatio('tsubame')).toBe(1);
    expect(b.prepare('sword')).toBeNull();
    const cd = skillCooldown(SKILLS.tsubame, 1);
    for (let i = 0; i < cd - 1; i++) b.step();
    expect(b.ready('tsubame')).toBe(false);
    expect(b.cooldownRatio('tsubame')).toBeGreaterThan(0);
    b.step();
    expect(b.ready('tsubame')).toBe(true);
    expect(b.cooldownRatio('tsubame')).toBe(0);
  });

  it('スキルごとに別々のクールダウン', () => {
    const b = new SkillBook();
    b.start('tsubame');
    expect(b.ready('samidare')).toBe(true);
    b.select('samidare');
    expect(b.prepare('sword')!.skill).toBe('samidare');
  });

  it('レベルが上がるとクールダウンが短くなる', () => {
    const b = new SkillBook({ shippu: SKILL_LEVEL_MAX });
    b.start('shippu');
    const lv5 = Math.round(SKILLS.shippu.cooldownFrames * (1 - SKILLS.shippu.cooldownPerLevel * (SKILL_LEVEL_MAX - 1)));
    for (let i = 0; i < lv5; i++) b.step();
    expect(b.ready('shippu')).toBe(true);
  });

  it('serial は一覧に効く変化（レベル・選択）だけで増え、クールダウンの減りでは増えない', () => {
    const b = new SkillBook();
    const s0 = b.serial;
    b.select('tsubame'); // すでにこれ（未選択で最初のもの）…選び直しは増える
    const s1 = b.serial;
    b.select('tsubame');
    expect(b.serial).toBe(s1);
    b.start('tsubame');
    b.step();
    expect(b.serial).toBe(s1);
    b.setLevel('tsubame', 3);
    expect(b.serial).toBeGreaterThan(s1);
    expect(s1).toBeGreaterThanOrEqual(s0);
  });

  it('reset はクールダウンだけ消し、レベルと選択は残す', () => {
    const b = new SkillBook();
    b.select('senpu');
    b.setLevel('senpu', 4);
    b.start('senpu');
    b.reset();
    expect(b.ready('senpu')).toBe(true);
    expect(b.level('senpu')).toBe(4);
    expect(b.selectedFor('sword')!.id).toBe('senpu');
  });
});
