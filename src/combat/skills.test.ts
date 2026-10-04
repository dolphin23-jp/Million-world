import { describe, expect, it } from 'vitest';
import { SKILLS, SKILL_LEVEL_MAX, SKILL_ORDER, type SkillDef, type SkillId } from './data/skills';
import { SkillBook, skillCooldown, skillPower, skillSteps } from './skills';
import { resolveAttack } from './data/attacks';
import { findAttack } from './data/skill-attacks';

const SWORD = SKILL_ORDER.filter((id) => SKILLS[id].family === 'sword');
const GREAT = SKILL_ORDER.filter((id) => SKILLS[id].family === 'greatsword');

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

  it('連なりの攻撃 id はすべて実在し（ATTACKS か SKILL_ATTACKS）、武器の系統と合っている（大剣の技は両手持ち）', () => {
    for (const id of SKILL_ORDER) {
      const def = SKILLS[id];
      expect(def.steps.length).toBeGreaterThanOrEqual(1);
      for (const s of def.steps) {
        const a = findAttack(s.attack);
        expect(a, `${id}: ${s.attack}`).toBeTruthy();
        expect(a!.authored, `${id}: ${s.attack} は手付け`).toBeTruthy();
        expect(a!.authored!.twoHanded !== undefined, `${id}: ${s.attack}`).toBe(def.family === 'greatsword');
      }
    }
  });

  it('連なりの隣り合う 2 つは、後ろの手付けが前の技の受付時点（cancelAt）の姿勢から続く（continueFrom）= 姿勢のつなぎ目が自然', () => {
    for (const id of SKILL_ORDER) {
      const steps = SKILLS[id].steps;
      for (let i = 0; i + 1 < steps.length; i++) {
        const a = findAttack(steps[i]!.attack)!;
        const b = findAttack(steps[i + 1]!.attack)!;
        const cf = b.authored!.continueFrom;
        expect(cf, `${id}: ${a.id} → ${b.id} の continueFrom`).toBeDefined();
        expect(cf!.attack, `${id}: ${a.id} → ${b.id}`).toBe(a.authored);
        expect(cf!.t, `${id}: ${a.id} → ${b.id} の受付の時刻`).toBeCloseTo(a.cancelAt, 6);
      }
    }
  });

  it('次の段へ移れる受付（cancelFrame）と回避のキャンセル（dodgeCancel）は、全体の中にあり、受付は持続（当たり）が終わったあと', () => {
    for (const id of SKILL_ORDER) {
      for (const s of SKILLS[id].steps) {
        const a = findAttack(s.attack)!;
        const fr = resolveAttack(a);
        expect(fr.cancelFrame, `${id}: ${s.attack}`).toBeGreaterThanOrEqual(fr.startup + fr.active);
        expect(fr.dodgeCancel, `${id}: ${s.attack}`).toBeLessThanOrEqual(fr.total);
        expect(fr.dodgeCancel, `${id}: ${s.attack}`).toBeGreaterThan(fr.startup);
      }
    }
  });

  it('多段の技の窓は時間順で重ならず、窓の範囲が activeStart〜activeEnd と一致し、クリップの長さの中にある', () => {
    for (const id of SKILL_ORDER) {
      for (const s of SKILLS[id].steps) {
        const a = findAttack(s.attack)!;
        if (!a.windows) continue;
        let prevEnd = -1;
        for (const w of a.windows) {
          expect(w.start, `${id}: ${s.attack}`).toBeGreaterThanOrEqual(prevEnd);
          expect(w.end, `${id}: ${s.attack}`).toBeGreaterThan(w.start);
          prevEnd = w.end;
        }
        expect(a.activeStart, `${id}: ${s.attack}`).toBeCloseTo(a.windows[0]!.start, 6);
        expect(a.activeEnd, `${id}: ${s.attack}`).toBeCloseTo(a.windows[a.windows.length - 1]!.end, 6);
        expect(a.activeEnd, `${id}: ${s.attack}`).toBeLessThanOrEqual(a.segmentDuration);
      }
    }
  });

  it('剣技は 3 つ以上の当たりがあるもの（連なりの段 + 窓の数）が少なくとも 1 本ある。段の解放レベルは先頭が 1 で、後ろへ向けて単調に増える', () => {
    const hits = (def: SkillDef): number => def.steps.reduce((n, s) => n + (findAttack(s.attack)!.windows?.length ?? 1), 0);
    expect(SKILL_ORDER.some((id) => hits(SKILLS[id]) >= 3)).toBe(true);
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
  /** 段の解放レベルの仕組みを確かめる合成のスキル */
  const synth: SkillDef = {
    id: SKILL_ORDER[0]!,
    name: 't',
    short: 't',
    detail: '',
    family: 'sword',
    steps: [{ attack: 'a' }, { attack: 'b' }, { attack: 'c', minLevel: 3 }, { attack: 'd', minLevel: 5, scale: 1.1 }],
    power: 1.2,
    powerPerLevel: 0.1,
    cooldownFrames: 600,
    cooldownPerLevel: 0.05,
  };

  it('Lv1 で 2 段、Lv3 で 3 段、Lv5 で 4 段', () => {
    expect(skillSteps(synth, 1).map((s) => s.attack)).toEqual(['a', 'b']);
    expect(skillSteps(synth, 2).length).toBe(2);
    expect(skillSteps(synth, 3).map((s) => s.attack)).toEqual(['a', 'b', 'c']);
    expect(skillSteps(synth, 5).map((s) => s.attack)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('段の威力 = スキルの威力 × 段の倍率', () => {
    const steps = skillSteps(synth, 5);
    expect(steps[0]!.power).toBeCloseTo(1.2 + 0.1 * 4);
    expect(steps[3]!.power).toBeCloseTo((1.2 + 0.1 * 4) * 1.1);
  });

  it('cooldown の倍率（INT など）が掛かる', () => {
    expect(skillCooldown(synth, 1, 0.5)).toBe(300);
    expect(skillCooldown(synth, 3)).toBe(Math.round(600 * 0.9));
  });
});

describe('SkillBook', () => {
  it('最初は全スキル Lv1。その系統で使えるものだけが並ぶ', () => {
    const b = new SkillBook();
    for (const id of SKILL_ORDER) expect(b.level(id)).toBe(1);
    expect(b.available('sword').map((d) => d.id)).toEqual(SWORD);
    expect(b.available('greatsword').map((d) => d.id)).toEqual(GREAT);
  });

  it('選んでいなければ系統の最初のスキル。select で替わり、系統ごとに別々に覚えている', () => {
    const b = new SkillBook();
    expect(b.selectedFor('sword')!.id).toBe(SWORD[0]);
    expect(b.select(SWORD[1]!)).toBe(true);
    expect(b.selectedFor('sword')!.id).toBe(SWORD[1]);
    expect(b.selectedFor('greatsword')!.id).toBe(GREAT[0]);
    b.select(GREAT[1]!);
    expect(b.selectedFor('sword')!.id).toBe(SWORD[1]);
    expect(b.selectedFor('greatsword')!.id).toBe(GREAT[1]);
  });

  it('レベル 0 のスキルは使えず、選べない。選んでいたものがレベル 0 になったら最初のものへ戻る', () => {
    const b = new SkillBook({ [SWORD[0]!]: 0 });
    expect(b.available('sword').map((d) => d.id)).not.toContain(SWORD[0]);
    expect(b.select(SWORD[0]!)).toBe(false);
    expect(b.selectedFor('sword')!.id).toBe(SWORD[1]);
    b.select(SWORD[2]!);
    b.setLevel(SWORD[2]!, 0);
    expect(b.selectedFor('sword')!.id).toBe(SWORD[1]);
    const none = new SkillBook(Object.fromEntries(GREAT.map((id) => [id, 0])));
    expect(none.selectedFor('greatsword')).toBeNull();
    expect(none.prepare('greatsword')).toBeNull();
    expect(none.cycle('greatsword')).toBeNull();
  });

  it('cycle: 使えるスキルを順に回る', () => {
    const b = new SkillBook();
    const seen: SkillId[] = [];
    for (let i = 0; i < SWORD.length + 2; i++) seen.push(b.cycle('sword', 1)!.id);
    const expected: SkillId[] = [];
    for (let i = 1; i <= SWORD.length + 2; i++) expected.push(SWORD[i % SWORD.length]!);
    expect(seen).toEqual(expected);
    expect(b.cycle('sword', -1)!.id).toBe(SWORD[(SWORD.length + 2 - 1) % SWORD.length]);
  });

  it('prepare は選んでいるスキルの連なりを返し、クールダウンには入らない。start でクールダウンに入り、step で明ける', () => {
    const b = new SkillBook();
    const first = SWORD[0]!;
    const run = b.prepare('sword')!;
    expect(run.skill).toBe(first);
    expect(run.steps.map((s) => s.attack)).toEqual(skillSteps(SKILLS[first], 1).map((s) => s.attack));
    expect(b.ready(first)).toBe(true);
    expect(b.prepare('sword')).not.toBeNull(); // 使っていない = まだ使える
    b.start(first);
    expect(b.ready(first)).toBe(false);
    expect(b.cooldownRatio(first)).toBe(1);
    expect(b.prepare('sword')).toBeNull();
    const cd = skillCooldown(SKILLS[first], 1);
    for (let i = 0; i < cd - 1; i++) b.step();
    expect(b.ready(first)).toBe(false);
    expect(b.cooldownRatio(first)).toBeGreaterThan(0);
    b.step();
    expect(b.ready(first)).toBe(true);
    expect(b.cooldownRatio(first)).toBe(0);
  });

  it('スキルごとに別々のクールダウン', () => {
    const b = new SkillBook();
    b.start(SWORD[0]!);
    expect(b.ready(SWORD[1]!)).toBe(true);
    b.select(SWORD[1]!);
    expect(b.prepare('sword')!.skill).toBe(SWORD[1]);
  });

  it('レベルが上がるとクールダウンが短くなる', () => {
    const id = SWORD[1]!;
    const b = new SkillBook({ [id]: SKILL_LEVEL_MAX });
    b.start(id);
    const lv5 = Math.round(SKILLS[id].cooldownFrames * (1 - SKILLS[id].cooldownPerLevel * (SKILL_LEVEL_MAX - 1)));
    for (let i = 0; i < lv5; i++) b.step();
    expect(b.ready(id)).toBe(true);
  });

  it('serial は一覧に効く変化（レベル・選択）だけで増え、クールダウンの減りでは増えない', () => {
    const b = new SkillBook();
    const id = SWORD[0]!;
    b.select(id); // 未選択（最初のもの）からの選び直しは増える
    const s1 = b.serial;
    b.select(id);
    expect(b.serial).toBe(s1);
    b.start(id);
    b.step();
    expect(b.serial).toBe(s1);
    b.setLevel(id, 3);
    expect(b.serial).toBeGreaterThan(s1);
  });

  it('reset はクールダウンだけ消し、レベルと選択は残す', () => {
    const b = new SkillBook();
    const id = SWORD[2]!;
    b.select(id);
    b.setLevel(id, 4);
    b.start(id);
    b.reset();
    expect(b.ready(id)).toBe(true);
    expect(b.level(id)).toBe(4);
    expect(b.selectedFor('sword')!.id).toBe(id);
  });
});
